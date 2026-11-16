// A fixed-channel relay. Catalog publication still requires a working source.
export const SOURCES = Object.freeze([
  {id: 'viginet-https', url: 'https://e1.viginet.vectormax.com:5210/quickstart/114-934-21/index.m3u8', prefix: '/quickstart/114-934-21/'},
  {id: 'viginet-http', url: 'http://e1.viginet.vectormax.com:5210/quickstart/114-934-21/index.m3u8', prefix: '/quickstart/114-934-21/'},
  {id: 'public-astra', url: 'http://181.78.8.199:8000/play/a0fr/index.m3u8', prefix: '/play/a0fr/'}
]);

const TIMEOUT_MS = 6000;
const MAX_PLAYLIST_BYTES = 131072;
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-SNAPTVNOW-Bridge': 'meridiano-v1'};
const failure = (reason, status) => Object.assign(Error(reason), {status});

export function allowedResource(source, value) {
  try {
    if (/[\\\u0000-\u0020]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) return false;
    const url = new URL(value), root = new URL(source.url);
    return !url.username && !url.password && !url.hash && url.origin === root.origin &&
      url.pathname.startsWith(source.prefix) && !url.pathname.split('/').includes('..');
  } catch { return false; }
}

async function upstream(source, value, request, fetcher) {
  let url = value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  const requestHeaders = new Headers({'Accept-Encoding': 'identity'});
  for (const name of ['Range', 'If-Range']) if (request.headers.has(name)) requestHeaders.set(name, request.headers.get(name));
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (!allowedResource(source, url)) throw failure('source_scope', 502);
      const response = await fetcher(url, {method: request.method, headers: requestHeaders, redirect: 'manual', signal});
      if (![301, 302, 303, 307, 308].includes(response.status)) return {response, url};
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw failure('source_redirect', 502);
      url = new URL(location, url).href;
    }
    throw failure('source_redirect', 502);
  } finally {
    // Only opening the response has this deadline. Video bodies keep streaming.
    clearTimeout(timer);
  }
}

async function readBytes(response, maximum, prefix = false) {
  const reader = response.body?.getReader();
  if (!reader) throw failure('empty_source', 502);
  const chunks = [];
  let size = 0, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(failure('source_timeout', 504)), TIMEOUT_MS);
  });
  try {
    for (;;) {
      const {done, value} = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!prefix && size + value.byteLength > maximum) throw failure('playlist_size', 502);
      const chunk = value.subarray(0, maximum - size);
      chunks.push(chunk);
      size += chunk.byteLength;
      if (prefix && size === maximum) break;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function playlist(source, url, request, fetcher) {
  const opened = await upstream(source, url, request, fetcher);
  if (!opened.response.ok) {
    const status = opened.response.status;
    await opened.response.body?.cancel();
    throw failure('source_http', status);
  }
  const text = new TextDecoder().decode(await readBytes(opened.response, MAX_PLAYLIST_BYTES));
  if (!text.startsWith('#EXTM3U') || !text.includes('#EXT-X-')) throw failure('invalid_playlist', 502);
  return {url: opened.url, text};
}

function mediaPrefix(bytes) {
  for (let offset = 0; offset < Math.min(188, bytes.length - 376); offset++) {
    if (bytes[offset] === 71 && bytes[offset + 188] === 71 && bytes[offset + 376] === 71) return true;
  }
  return ['ftyp', 'styp', 'moof', 'moov'].includes(String.fromCharCode(...bytes.subarray(4, 8)));
}

export async function probeSource(source, request, fetcher = fetch) {
  const started = Date.now();
  const probeRequest = new Request('https://private/meridiano-probe', {signal: request.signal});
  try {
    const root = await playlist(source, source.url, probeRequest, fetcher);
    let current = root;
    for (let depth = 0; depth < 2 && current.text.includes('#EXT-X-STREAM-INF'); depth++) {
      const child = current.text.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
      if (!child) throw failure('empty_playlist', 502);
      current = await playlist(source, new URL(child.trim(), current.url).href, probeRequest, fetcher);
    }
    if (/#EXT-X-KEY:.*METHOD=(?!NONE)[A-Z0-9-]+/.test(current.text)) throw failure('encrypted_source', 502);
    const segments = current.text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
    if (!segments.length || !current.text.includes('#EXTINF:')) throw failure('empty_playlist', 502);
    const url = new URL((segments.at(-2) || segments[0]).trim(), current.url).href;
    const opened = await upstream(source, url, probeRequest, fetcher);
    if (!opened.response.ok) {
      const status = opened.response.status;
      await opened.response.body?.cancel();
      throw failure('source_http', status);
    }
    const bytes = await readBytes(opened.response, 4096, true);
    if (!mediaPrefix(bytes)) throw failure('invalid_media', 502);
    return {ready: true, source: source.id, ms: Date.now() - started, sampleBytes: bytes.length, root};
  } catch (error) {
    const reasons = new Set(['source_scope', 'source_redirect', 'empty_source', 'source_timeout', 'playlist_size', 'source_http', 'invalid_playlist', 'empty_playlist', 'encrypted_source', 'invalid_media']);
    return {ready: false, source: source.id, ms: Date.now() - started,
      reason: reasons.has(error.message) ? error.message : error.name === 'AbortError' ? 'source_timeout' : 'source_unreachable',
      httpStatus: Number.isInteger(error.status) ? error.status : null};
  }
}

export function rewritePlaylist(source, descriptor, origin) {
  const rewrite = value => {
    const target = new URL(value, descriptor.url).href;
    if (!allowedResource(source, target)) throw failure('source_scope', 502);
    const url = new URL('/resource', origin);
    url.searchParams.set('source', source.id);
    url.searchParams.set('url', target);
    return url.href;
  };
  return descriptor.text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (!line.startsWith('#')) return rewrite(line.trim());
    return line.replace(/URI="([^"\r\n]+)"/g, (_, uri) => 'URI="' + rewrite(uri) + '"');
  }).join('\n');
}

export async function handleBridge(request, fetcher = fetch) {
  const url = new URL(request.url);
  const json = (value, status = 200) => Response.json(value, {status, headers});
  if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'method_not_allowed'}, 405);
  if (url.pathname === '/health' || url.pathname === '/live.m3u8') {
    // A failed origin never produces an empty playlist or a fabricated channel.
    const probes = await Promise.all(SOURCES.map(source => probeSource(source, request, fetcher)));
    const selected = probes.find(probe => probe.ready);
    if (url.pathname === '/health') {
      return json({service: 'snaptvnow-meridiano-bridge', ready: !!selected, state: selected ? 'media_received' : 'awaiting_source',
        checkedAt: Date.now(), sources: probes.map(({root, ...result}) => result)});
    }
    if (!selected) return json({error: 'meridiano_source_unavailable'}, 503);
    const source = SOURCES.find(item => item.id === selected.source);
    try {
      return new Response(request.method === 'HEAD' ? null : rewritePlaylist(source, selected.root, url.origin),
        {headers: {...headers, 'Content-Type': 'application/vnd.apple.mpegurl'}});
    } catch { return json({error: 'source_scope'}, 502); }
  }
  if (url.pathname !== '/resource') return json({error: 'not_found'}, 404);
  const source = SOURCES.find(item => item.id === url.searchParams.get('source'));
  const target = url.searchParams.get('url');
  if (!source || !target || target.length > 4096 || !allowedResource(source, target)) return json({error: 'source_scope'}, 403);
  try {
    const opened = await upstream(source, target, request, fetcher);
    const contentType = opened.response.headers.get('content-type') || '';
    const out = new Headers(headers);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      if (opened.response.headers.has(name)) out.set(name, opened.response.headers.get(name));
    }
    if (opened.response.ok && request.method === 'GET' && (/mpegurl/i.test(contentType) || new URL(opened.url).pathname.endsWith('.m3u8'))) {
      const text = new TextDecoder().decode(await readBytes(opened.response, MAX_PLAYLIST_BYTES));
      if (!text.startsWith('#EXTM3U')) return json({error: 'invalid_playlist'}, 502);
      out.delete('content-length');
      out.set('content-type', 'application/vnd.apple.mpegurl');
      return new Response(rewritePlaylist(source, {url: opened.url, text}, url.origin), {headers: out});
    }
    return new Response(opened.response.body, {status: opened.response.status, headers: out});
  } catch { return json({error: 'source_unavailable'}, 502); }
}

export default {fetch: request => handleBridge(request)};

import {randomBytes, timingSafeEqual} from 'node:crypto';
import {handleBridge, allowedResource} from '../worker.mjs';

export const METADATA_URL = 'https://www.dailymotion.com/player/metadata/video/x9sxu9y';
const INTERNAL = 'https://meridiano-relay.internal';
const JSON_HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
const fail = state => Object.assign(new Error(state), {state});

async function readJson(response) {
  if (!response.ok) { await response.body?.cancel(); throw fail('upstream_unavailable'); }
  const reader = response.body.getReader();
  let text = '', bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 131072) throw fail('upstream_response_too_large');
      text += decoder.decode(value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createVpnRelay({token, edgeOrigin, fetcher = fetch, now = Date.now}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw Error('A private 32-byte relay token is required');
  const edge = new URL(edgeOrigin);
  if (edge.protocol !== 'https:' || edge.username || edge.password || edge.search || edge.hash || edge.pathname !== '/') throw Error('HTTPS edge origin required');
  const expected = Buffer.from('Bearer ' + token);
  const resources = new Map(), identifiers = new Map();
  let source, sourceUntil = 0, countryUntil = 0;
  const json = (value, status = 200) => Response.json(value, {status, headers: JSON_HEADERS});

  async function vpnReady(signal) {
    const health = await fetcher('http://127.0.0.1:9999/', {signal: AbortSignal.any([signal, AbortSignal.timeout(2000)])});
    await health.body?.cancel();
    if (!health.ok) { countryUntil = 0; throw fail('vpn_disconnected'); }
    if (countryUntil > now()) return;
    const geo = await readJson(await fetcher(new URL('/vpn-country', edge).href, {
      headers: {Authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
    }));
    if (geo.country !== 'VE') throw fail('venezuelan_exit_unverified');
    countryUntil = now() + 30000;
  }

  async function officialSource(signal) {
    if (source && sourceUntil > now()) return source;
    const metadata = await readJson(await fetcher(METADATA_URL, {
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
    }));
    if (metadata.error) throw fail(metadata.error.code === 'DM007' ? 'official_geo_blocked' : 'official_unavailable');
    const entries = Object.values(metadata.qualities || {}).flat();
    const hls = entries.find(item => /mpegurl/i.test(item.type || ''));
    const next = {id: 'official-dailymotion', url: hls?.url, prefix: '/'};
    if (!hls || !allowedResource(next, hls.url) || !/^https:\/\/([^/]+\.)?(dmcdn\.net|dailymotion\.com)\//i.test(hls.url)) throw fail('official_hls_unavailable');
    source = next; sourceUntil = now() + 60000;
    return source;
  }

  function opaqueResources(text, descriptor) {
    for (const [id, row] of resources) if (row.until <= now()) { resources.delete(id); if (identifiers.get(row.url) === id) identifiers.delete(row.url); }
    return text.replace(/https:\/\/meridiano-relay\.internal\/resource\?[^\s"<>]+/g, value => {
      const upstream = new URL(value).searchParams.get('url');
      if (!upstream || !allowedResource(descriptor, upstream)) throw fail('source_scope');
      let id = identifiers.get(upstream);
      if (!id || !resources.has(id)) {
        if (resources.size >= 4096) throw fail('resource_limit');
        id = randomBytes(32).toString('base64url'); identifiers.set(upstream, id);
      }
      resources.set(id, {url: upstream, source: descriptor, until: now() + 600000});
      return '/resource?id=' + id;
    });
  }

  return async function relay(request) {
    const provided = Buffer.from(request.headers.get('Authorization') || '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json({error: 'unauthorized'}, 403);
    if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'method_not_allowed'}, 405);
    const url = new URL(request.url);
    if (!['/health', '/live.m3u8', '/resource'].includes(url.pathname)) return json({error: 'not_found'}, 404);
    let descriptor, internal = new URL(url.pathname, INTERNAL);
    if (url.pathname === '/resource') {
      const id = url.searchParams.get('id'), row = resources.get(id);
      if (url.searchParams.size !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(id || '') || !row || row.until <= now()) return json({error: 'resource_expired'}, 410);
      descriptor = row.source; internal.searchParams.set('source', descriptor.id); internal.searchParams.set('url', row.url);
    }
    try {
      await vpnReady(request.signal);
      descriptor ||= await officialSource(request.signal);
      const forwarded = new Headers();
      for (const name of ['Range', 'If-Range']) if (request.headers.has(name)) forwarded.set(name, request.headers.get(name));
      const response = await handleBridge(new Request(internal, {method: request.method, headers: forwarded, signal: request.signal}), fetcher, {sources: [descriptor]});
      if (url.pathname === '/health') {
        const state = await response.json();
        return json({...state, vpnConfigured: true, vpnConnected: true, exitCountry: 'VE'});
      }
      if (request.method === 'GET' && /mpegurl/i.test(response.headers.get('Content-Type') || '')) {
        const text = opaqueResources(await response.text(), descriptor);
        const headers = new Headers(response.headers); headers.delete('content-length');
        return new Response(text, {status: response.status, headers});
      }
      return response;
    } catch (error) {
      // Never fall back to an ordinary Internet route or expose provider errors/tokens.
      const states = new Set(['vpn_disconnected', 'venezuelan_exit_unverified', 'official_geo_blocked', 'official_unavailable',
        'official_hls_unavailable', 'upstream_unavailable', 'upstream_response_too_large', 'source_scope', 'resource_limit']);
      return json({ready: false, vpnConfigured: true, state: states.has(error.state) ? error.state : 'vpn_relay_unavailable'}, 503);
    }
  };
}

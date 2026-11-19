// Only plain, independently addressable MPEG-TS media playlists are eligible.
// Encrypted, byterange, fMP4 and low-latency playlists retain their native path.
const segmentLimit = 8 * 1024 * 1024;

export function appleGolPeruChannel(title) {
  if (typeof title !== 'string' || title.length > 200) return false;
  const normalized = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
  return /^PER\s*[-:|]\s*GOL\s+PERU(?:\s*\((?:L|M|TV|W|SD|HD|FHD|UHD|4K|720P?|1080P?|2160P?)\))*(?:\s+(?:720P?|1080P?|2160P?))?$/i.test(normalized);
}

export async function appleFragmentPlaylist(text, sign) {
  if (!text.startsWith('#EXTM3U') || /^#EXT-X-(?:KEY|SESSION-KEY|MAP|BYTERANGE|PART|PRELOAD-HINT|SKIP|GAP|STREAM-INF|MEDIA:|I-FRAME|RENDITION-REPORT)/m.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const base = lines.find(line => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  let sequence = base === undefined ? 0 : Number(base.slice(22));
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
  const discontinuityLine = lines.find(line => line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:'));
  let period = discontinuityLine ? Number(discontinuityLine.split(':')[1]) : 0;
  if (!Number.isSafeInteger(period) || period < 0) return null;
  const segments = [];
  let nextDate = null;
  let map = true, durationAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '#EXT-X-DISCONTINUITY') { period++; map = true; }
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const ms = Date.parse(line.slice(25));
      nextDate = Number.isFinite(ms) ? ms : null;
    }
    if (line.startsWith('#EXTINF:')) {
      if (durationAt !== -1 || !/^#EXTINF:\d+(?:\.\d+)?,/.test(line)) return null;
      durationAt = i;
    }
    if (!line || line.startsWith('#')) continue;
    if (durationAt === -1 || !Number.isSafeInteger(sequence) || sequence > 0xffffffff ||
        segments.length >= 48 || /\.(?:m4s|mp4|aac|vtt|m3u8)(?:$|[?#])/i.test(line)) return null;
    const durationMs = Number(lines[durationAt].slice(8).split(',')[0]) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 24000) return null;
    segments.push({uri:line, index:i, durationAt, durationMs, map, sequence, period, epochMs:nextDate});
    if (nextDate !== null) nextDate += durationMs;
    sequence++;
    durationAt = -1;
    map = false;
  }
  if (!segments.length || durationAt !== -1) return null;
  // A probe two segments behind the live edge avoids either volatile endpoint.
  // The signed map embeds its tiny verified init and survives the source window.
  let edge = Date.now();
  const groups = new Map();
  for (const segment of segments) {
    if (!groups.has(segment.period)) groups.set(segment.period,[]);
    groups.get(segment.period).push(segment);
  }
  if (groups.size > 3) return null;
  for (let i = segments.length-1; i >= 0; i--) {
    const segment = segments[i]; edge -= segment.durationMs;
    segment.epochMs = Math.round(segment.epochMs ?? edge);
  }
  await Promise.all(segments.map(async segment => {
    const {uri, index, durationAt, map, sequence} = segment;
    const group = groups.get(segment.period);
    const probe = group[Math.max(0,group.length-2)];
    const [media, init] = await Promise.all([sign(uri, sequence, 'media', segment),
      map ? sign(probe.uri, probe.sequence, 'init', probe) : null]);
    lines[index] = media;
    if (map) lines[durationAt] = '#EXT-X-MAP:URI="' + init + '"\n' + lines[durationAt];
  }));
  const version = lines.findIndex(line => line.startsWith('#EXT-X-VERSION:'));
  if (version < 0) lines.splice(1, 0, '#EXT-X-VERSION:7');
  else lines[version] = '#EXT-X-VERSION:' + Math.max(7, Number(lines[version].slice(15)) || 7);
  return lines.join('\n');
}

async function readSegment(response, signal) {
  if (response.status !== 200 || !response.body || Number(response.headers.get('content-length')) > segmentLimit) {
    await response.body?.cancel();
    throw Error('invalid_apple_segment');
  }
  const reader = response.body.getReader();
  const declared = Number(response.headers.get('content-length'));
  const storage = new Uint8Array(declared > 0 ? declared : segmentLimit);
  let bytes = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15000);
  let complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted || timedOut) throw Error('invalid_apple_segment');
      if (chunk.done) break;
      if (bytes + chunk.value.length > storage.length) throw Error('invalid_apple_segment');
      storage.set(chunk.value, bytes); bytes += chunk.value.length;
    }
    if (!bytes || (declared > 0 && bytes !== declared)) throw Error('invalid_apple_segment');
    complete = true;
    return storage.subarray(0,bytes);
  } finally {
    clearTimeout(timer);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function appleFragmentResponse(bytes, part, req) {
  const total = bytes.byteLength;
  const headers = {'content-type':part === 'init' ? 'video/mp4' : 'video/iso.segment', 'cache-control':'private, no-store', 'accept-ranges':'bytes'};
  let start = 0, end = total - 1;
  const range = req.headers.has('If-Range') ? null : req.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, total - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
    } else start = total;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
      return new Response(null, {status:416, headers:{...headers,'content-range':'bytes */' + total}});
    }
    headers['content-range'] = 'bytes ' + start + '-' + end + '/' + total;
  }
  headers['content-length'] = String(end - start + 1);
  return new Response(req.method === 'HEAD' ? null : bytes.subarray(start,end+1), {status:range ? 206 : 200, headers});
}

// Do not share response streams or pending fetch promises across request contexts.
// Source reads may overlap (init + first segment); the CPU transform is synchronous.
export function createAppleFragments(convert) {
  const cache = new Map();
  let retained = 0, activeReads = 0;
  function remove(key, entry) { retained -= entry.bytes; cache.delete(key); }
  return async function fragment(req, claim, fetchSource) {
    const {applePart:part, appleSequence:sequence} = claim;
    if (!['init','media'].includes(part) || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff)
      throw Error('invalid_apple_segment');
    const key = JSON.stringify([claim.sid,claim.lease_id,claim.request_id,claim.resource,sequence]);
    const now = Date.now();
    for (const [k,v] of cache) if (v.until <= now) remove(k,v);
    let result = cache.get(key)?.result;
    while (!result && activeReads >= 2) {
      if (req.signal.aborted || Date.now()-now > 4000) return new Response(null,{status:503,headers:{'Retry-After':'1'}});
      await new Promise(resolve=>setTimeout(resolve,50));
      result = cache.get(key)?.result;
    }
    if (!result) {
      activeReads++;
      try {
        const data = await readSegment(await fetchSource(),req.signal);
        result = cache.get(key)?.result;
        if (!result) {
          result = convert(data,{sequence,epochMs:claim.appleEpoch});
          const bytes = result.init.byteLength + result.media.byteLength;
          if (!(result.init instanceof Uint8Array) || !(result.media instanceof Uint8Array) || !result.init.length ||
              result.init.length > 4096 || !result.media.length || bytes > segmentLimit + 262144) throw Error('invalid_apple_segment');
          while (cache.size && (retained+bytes > segmentLimit+262144 || cache.size >= 4)) {
            const [oldKey,entry] = cache.entries().next().value; remove(oldKey,entry);
          }
          retained += bytes; cache.set(key,{result,bytes,until:Math.min(claim.exp,Date.now()+45000)});
        }
      } finally { activeReads--; }
    }
    if (req.signal.aborted || claim.exp <= Date.now()) return new Response(null,{status:410});
    return appleFragmentResponse(result[part],part,req);
  };
}

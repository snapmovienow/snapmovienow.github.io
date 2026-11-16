import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createVpnRelay, METADATA_URL} from '../../meridiano-bridge/vpn/relay.mjs';
import {createRelayHttpServer} from '../../meridiano-bridge/vpn/server.mjs';
import {handleBridge, allowedResource, SOURCES} from '../../meridiano-bridge/worker.mjs';

// Synthetic media verifies transport and gates; it does not certify a live TV source.
const token = Buffer.alloc(32, 17).toString('base64url');
const edgeOrigin = 'https://edge.test';
const mediaOrigin = 'https://proxy-123.dmcdn.net';
const signedRoot = mediaOrigin + '/live/master.m3u8?token=fixture-secret';
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nvariant.m3u8?token=fixture-secret\n';
const media = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:6,\npart.ts?token=fixture-secret\n';
const packets = new Uint8Array(188 * 4); for (let i = 0; i < packets.length; i += 188) packets[i] = 71;
const calls = [];
let connected = true, country = 'VE', blocked = false;
const fetcher = async (value, options = {}) => {
  const url = new URL(value); calls.push({url: url.href, headers: new Headers(options.headers), method: options.method || 'GET'});
  if (url.hostname === '127.0.0.1') return new Response(null, {status: connected ? 200 : 503});
  if (url.origin === edgeOrigin) {
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + token);
    return Response.json({country});
  }
  if (url.href === METADATA_URL) return Response.json(blocked ? {error: {code: 'DM007'}} :
    {qualities: {auto: [{type: 'application/x-mpegURL', url: signedRoot}]}});
  assert.equal(url.origin, mediaOrigin);
  assert.equal(new Headers(options.headers).has('authorization'), false, 'relay credentials never reach video providers');
  assert.equal(url.searchParams.get('token'), 'fixture-secret', 'signed provider query survives all relay hops');
  if (url.pathname.endsWith('master.m3u8')) return new Response(master, {headers: {'Content-Type': 'application/vnd.apple.mpegurl'}});
  if (url.pathname.endsWith('variant.m3u8')) return new Response(media, {headers: {'Content-Type': 'application/vnd.apple.mpegurl'}});
  const range = new Headers(options.headers).get('range');
  return new Response(packets, {status: range ? 206 : 200, headers: {'Content-Type': 'video/mp2t', 'Accept-Ranges': 'bytes'}});
};
const request = (path, options = {}) => new Request('https://origin.test' + path,
  {...options, headers: {Authorization: 'Bearer ' + token, ...options.headers}});
const makeRelay = () => createVpnRelay({token, edgeOrigin, fetcher});

let relay = makeRelay();
assert.equal((await relay(new Request('https://origin.test/health'))).status, 403);
assert.equal(calls.length, 0, 'unauthenticated requests never open an upstream connection');
connected = false;
let result = await relay(request('/live.m3u8'));
assert.equal(result.status, 503);
assert.equal((await result.json()).state, 'vpn_disconnected');
assert.equal(calls.some(x => x.url === METADATA_URL), false);
connected = true; country = 'US'; relay = makeRelay(); calls.length = 0;
result = await relay(request('/live.m3u8'));
assert.equal((await result.json()).state, 'venezuelan_exit_unverified');
assert.equal(calls.some(x => x.url === METADATA_URL), false);
country = 'VE'; blocked = true; relay = makeRelay();
result = await relay(request('/health'));
assert.equal((await result.json()).state, 'official_geo_blocked');
blocked = false; relay = makeRelay();
const state = await (await relay(request('/health'))).json();
assert.equal(state.ready, true); assert.equal(state.exitCountry, 'VE');
const opened = await relay(request('/live.m3u8'));
const text = await opened.text();
assert(!text.includes('fixture-secret')); assert(!text.includes('dmcdn.net')); assert(!text.includes(token));
const variantPath = text.split('\n').find(line => line.startsWith('/resource?id='));
assert(variantPath);
const variant = await (await relay(request(variantPath))).text();
const segmentPath = variant.split('\n').find(line => line.startsWith('/resource?id='));
assert(segmentPath);
const segment = await relay(request(segmentPath, {headers: {Range: 'bytes=0-751'}}));
assert.equal(segment.status, 206);
assert.deepEqual(new Uint8Array(await segment.arrayBuffer()), packets);
assert.equal((await relay(request('/resource?url=http://127.0.0.1/'))).status, 410);
assert.equal((await relay(request('/resource?id=' + 'x'.repeat(43)))).status, 410);
connected = false;
assert.equal((await relay(request(segmentPath))).status, 503, 'existing player resources also stop when the VPN falls');
connected = true;
assert(allowedResource({id: 'official-dailymotion', url: signedRoot, prefix: '/'}, 'https://another.dmcdn.net/part.ts'));
assert(!allowedResource({id: 'official-dailymotion', url: signedRoot, prefix: '/'}, 'https://dmcdn.net.evil.test/part.ts'));
assert(!allowedResource(SOURCES[0], signedRoot), 'public legacy sources retain their original host and channel scope');

const env = {VPN_RELAY_ORIGIN: 'https://origin.test', VPN_RELAY_TOKEN: token};
const edgeFetch = async (url, options) => relay(new Request(url, options));
result = await handleBridge(new Request(edgeOrigin + '/live.m3u8'), edgeFetch, {env});
assert.equal(result.status, 200);
const externalText = await result.text();
assert(!externalText.includes('origin.test')); assert(!externalText.includes(token));
assert.equal((await handleBridge(new Request(edgeOrigin + '/resource?url=https://other.test/'), edgeFetch, {env})).status, 403);
let fallbacks = 0;
const unavailable = await handleBridge(new Request(edgeOrigin + '/live.m3u8'), async () => { fallbacks++; throw Error('offline'); }, {env});
assert.equal(unavailable.status, 503); assert.equal(fallbacks, 1, 'a configured VPN never falls back to a direct public origin');
assert.equal((await handleBridge(new Request(edgeOrigin + '/health'), edgeFetch, {env: {...env, VPN_RELAY_TOKEN: ''}})).status, 503);
assert.equal((await handleBridge(new Request(edgeOrigin + '/vpn-country'), edgeFetch, {env})).status, 403);
const attestation = new Request(edgeOrigin + '/vpn-country', {headers: {Authorization: 'Bearer ' + token}});
Object.defineProperty(attestation, 'cf', {value: {country: 'VE'}});
assert.equal((await (await handleBridge(attestation, edgeFetch, {env})).json()).country, 'VE');

// Verify the real Node HTTP adapter as well as the Fetch handlers.
const server = createRelayHttpServer(relay);
server.listen(0, '127.0.0.1'); await once(server, 'listening');
try {
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/live.m3u8', {headers: {Authorization: 'Bearer ' + token}});
  assert.equal(response.status, 200); assert((await response.text()).startsWith('#EXTM3U'));
  assert.equal((await fetch(base + '/health')).status, 403);
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
console.log('PASS: VPN loss and country gates, official geo block, authenticated edge-to-origin, opaque HLS resources, ranges, no direct fallback and Node HTTP adapter.');

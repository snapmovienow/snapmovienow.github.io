import assert from 'node:assert/strict';
import {SOURCES, allowedResource, probeSource, rewritePlaylist, handleBridge} from '../../meridiano-bridge/worker.mjs';

const source = SOURCES[0];
assert(allowedResource(source, source.url));
assert(allowedResource(source, new URL('segment.ts?token=public-fixture', source.url).href));
for (const url of ['http://127.0.0.1/private', 'https://other.invalid/segment.ts',
  source.url.replace('/quickstart/114-934-21/', '/quickstart/different-channel/'),
  source.url + '/%2e%2e/private', source.url.replace('https://', 'https://user:password@')]) {
  assert.equal(allowedResource(source, url), false, 'relay cannot reach another host, channel or credentials');
}

const request = new Request('https://bridge.test/live.m3u8');
const text = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\nsegment.ts\n';
const packet = new Uint8Array(188 * 3); packet[0] = 71; packet[188] = 71; packet[376] = 71;
const healthy = async url => new Response(url.endsWith('.ts') ? packet : text,
  {headers: {'Content-Type': url.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl'}});
const probe = await probeSource(source, request, healthy);
assert.equal(probe.ready, true);
const rewritten = rewritePlaylist(source, {url: source.url, text}, 'https://bridge.test');
assert(rewritten.includes('https://bridge.test/resource?source=viginet-https'));
assert.throws(() => rewritePlaylist(source, {url: source.url, text: text.replace('segment.ts', 'https://other.invalid/segment.ts')}, 'https://bridge.test'), /source_scope/);
const opened = await handleBridge(request, healthy);
assert.equal(opened.status, 200);
const resource = (await opened.text()).split('\n').find(line => line.startsWith('https://bridge.test/resource'));
const segment = await handleBridge(new Request(resource), healthy);
assert.deepEqual(new Uint8Array(await segment.arrayBuffer()), packet, 'video passes through the normal relay entry points');
assert.equal((await probeSource(source, new Request(request, {method: 'HEAD'}), healthy)).ready, true);

const missing = async () => new Response('Missing', {status: 404});
const health = await handleBridge(new Request('https://bridge.test/health'), missing);
const state = await health.json();
assert.equal(state.ready, false);
assert.equal(state.state, 'awaiting_source');
assert.equal(state.sources.length, 3);
assert.equal((await handleBridge(request, missing)).status, 503, 'no playable channel is advertised without media');
let upstreamCalls = 0;
const forbidden = new URL('https://bridge.test/resource');
forbidden.searchParams.set('source', source.id);
forbidden.searchParams.set('url', 'http://127.0.0.1/private');
assert.equal((await handleBridge(new Request(forbidden), async () => { upstreamCalls++; })).status, 403);
assert.equal(upstreamCalls, 0);
const redirect = await probeSource(source, request, async () => new Response(null, {status: 302, headers: {Location: 'http://127.0.0.1/private'}}));
assert.equal(redirect.ready, false);
assert.equal(redirect.reason, 'source_scope');
console.log('PASS: fixed-channel bridge, media validation, playlist rewriting, scope/redirect isolation and failed-source publication gate.');

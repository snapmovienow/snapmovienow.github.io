import assert from 'node:assert/strict';
import {traceRequest, SERVICE_VERSION} from '../src/request-diagnostics.mjs';
import worker from '../src/index.js';

const events = [], secret = 'password-do-not-log';
const request = new Request('https://example.test/live/customer/' + secret + '/42.ts?token=private-ticket', {
  headers: {'CF-Ray': 'aabbccddeeff0011-MIA', 'Authorization': 'private-token'}});
const response = await traceRequest(request, () => new Response('private body', {status: 403}), {logger: value => events.push(value)});
assert.equal(response.status, 403);
assert.equal(await response.text(), 'private body');
assert.match(response.headers.get('X-SMN-Request-ID'), /^[a-f0-9-]{36}$/);
assert.equal(response.headers.get('X-SMN-Version'), SERVICE_VERSION);
assert.deepEqual(Object.keys(events[0]).sort(), ['event','time','request_id','ray_id','route','method','status','elapsed_ms','version'].sort());
assert.equal(events[0].route, '/live/*');
assert.equal(events[0].ray_id, 'aabbccddeeff0011-MIA');
for (const value of ['customer', secret, 'private-ticket', 'private-token', 'private body']) assert.ok(!JSON.stringify(events).includes(value));

const malicious = new Request('https://example.test/sensitive/' + secret, {headers: {'CF-Ray': secret}});
await traceRequest(malicious, () => {throw Error(secret)}, {logger: value => events.push(value), allowedOrigin:'https://snapmovienow.github.io'});
assert.equal(events[1].route, 'other'); assert.equal(events[1].ray_id, null);
const fallback = await traceRequest(malicious, () => {throw Error(secret)}, {logger: () => {throw Error('logger failed')}, allowedOrigin:'https://snapmovienow.github.io'});
assert.equal(fallback.status, 502); assert.deepEqual(await fallback.json(), {error:'service_unavailable'});
assert.equal(fallback.headers.get('Access-Control-Allow-Origin'), 'https://snapmovienow.github.io');

let pulls = 0, cancels = 0;
const stream = new ReadableStream({pull(controller) {pulls++; controller.enqueue(new Uint8Array([1,2,3]))}, cancel() {cancels++}}, {highWaterMark:0});
const media = await traceRequest(request, () => new Response(stream, {status:206,headers:{'Content-Range':'bytes 0-2/3','Access-Control-Expose-Headers':'Content-Range'}}), {logger: value => events.push(value)});
assert.equal(pulls,0,'diagnostics must not read or clone video');
assert.equal(media.status,206); assert.equal(media.headers.get('Content-Range'),'bytes 0-2/3');
assert.ok(media.headers.get('Access-Control-Expose-Headers').includes('Content-Range'));
await media.body.cancel();assert.equal(cancels,1,'closing the wrapped stream must cancel upstream');
assert.equal(events.length,2,'successful media requests do not create log events');

const health = await worker.fetch(new Request('https://example.test/health'),{});
const healthInfo=await health.json();assert.equal(healthInfo.version,SERVICE_VERSION);assert.ok(healthInfo.capabilities.includes('admin-recovery-renewal'),'public deployment health identifies support without returning any private data');
assert.ok(health.headers.get('X-SMN-Request-ID'));
assert.ok(healthInfo.capabilities.includes('xtream-series-diagnostic'),'health identifies the deployed episode diagnostic');
const unauthorised = await worker.fetch(new Request('https://example.test/player_api.php'),{});
assert.equal(unauthorised.status,401); assert.equal((await unauthorised.json()).error,'credentials_required');
console.log('PASS: bounded error diagnostics redact credentials, preserve cancellation/Range/CORS, survive logger failures, and retain Xtream authentication.');

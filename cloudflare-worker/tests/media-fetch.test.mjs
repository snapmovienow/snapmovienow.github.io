import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fetchMedia, recoverMedia} from '../src/media-fetch.mjs';

// A real local HTTP stream catches a total fetch deadline that a Response mock
// would miss. No provider accounts or external requests are used.
const server = createServer((req, res) => {
  if (req.url === '/headers-stall') return;
  res.writeHead(206, {'Content-Type':'video/mp2t','Content-Length':'6','Content-Range':'bytes 10-15/100','ETag':'"segment-v1"'});
  res.flushHeaders(); res.write('abc');
  if (req.url === '/healthy') setTimeout(() => res.end('def'), 350);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
try {
  const healthy = await fetchMedia(origin+'/healthy', {}, 150, 1000);
  assert.equal(healthy.status, 206); assert.equal(healthy.headers.get('content-range'), 'bytes 10-15/100');
  assert.equal(await healthy.text(), 'abcdef', 'a healthy response survives beyond the header deadline');
  await assert.rejects(fetchMedia(origin+'/headers-stall', {}, 150, 1000), /media_timeout/);
  const idle = await fetchMedia(origin+'/idle', {}, 150, 150);
  await assert.rejects(idle.text(), /media_idle_timeout|aborted/i);
  const canceled = await fetchMedia(origin+'/cancel', {}, 150, 1000);
  await canceled.body.cancel();
} finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))}

const encoder = new TextEncoder();
const truncated = (extra = {}) => new Response(new ReadableStream({start(c) {c.enqueue(encoder.encode('abc')); c.close()}}), {headers:{'content-length':'6',etag:'"v1"',...extra}});
let ranges = [], checks = 0;
const recovered = recoverMedia(truncated(), async (range, validator) => {
  ranges.push(range); assert.equal(validator, '"v1"');
  return new Response('def', {status:206,headers:{'content-range':'bytes 3-5/6',etag:'"v1"'}});
}, async () => {checks++; return true});
assert.equal(await recovered.text(), 'abcdef'); assert.deepEqual(ranges, ['bytes=3-5']); assert.equal(checks, 1);
assert.equal(recovered.headers.get('content-length'), '6');

const partial = recoverMedia(new Response('abc', {status:206,headers:{'content-length':'6','content-range':'bytes 10-15/100',etag:'"v1"'}}), async range => {
  assert.equal(range, 'bytes=13-15');
  return new Response('def', {status:206,headers:{'content-range':'bytes 13-15/100',etag:'"v1"'}});
}, async () => true);
assert.equal(await partial.text(), 'abcdef');

// Streaming origins often omit Content-Length even for a finite byte range.
// The declared Content-Range still gives the exact number of bytes owed.
const chunkedRange = recoverMedia(new Response('abc', {status:206,headers:{'content-range':'bytes 10-15/100'}}), async range => {
  assert.equal(range, 'bytes=13-15');
  return new Response('def', {status:206,headers:{'content-range':'bytes 13-15/100'}});
}, async () => true);
assert.equal(await chunkedRange.text(), 'abcdef');

for (const bad of [new Response('def'), new Response('def', {status:206,headers:{'content-range':'bytes 0-2/6',etag:'"v1"'}}), new Response('def', {status:206,headers:{'content-range':'bytes 3-5/6',etag:'"v2"'}})]) {
  await assert.rejects(recoverMedia(truncated(), async () => bad, async () => true).text(), /invalid_media_resume/);
}
let forbiddenFetches = 0;
await assert.rejects(recoverMedia(truncated(), async () => {forbiddenFetches++}, async () => false).text(), /truncated_http_body/);
assert.equal(forbiddenFetches, 0, 'revocation stops recovery before another media request');
await assert.rejects(recoverMedia(truncated(), async () => {forbiddenFetches++}, async () => {throw Error('authorization_unavailable')}).text(), /authorization_unavailable/);
assert.equal(forbiddenFetches, 0);
let retries = 0;
await assert.rejects(recoverMedia(truncated(), async () => {retries++; return new Response('', {status:206,headers:{'content-range':'bytes 3-5/6',etag:'"v1"'}})}, async () => true).text(), /truncated_http_body/);
assert.equal(retries, 2, 'retry count stays bounded when the origin repeatedly truncates');
const weak = recoverMedia(truncated({etag:'W/"v1"','last-modified':'Mon, 05 Oct 2026 12:00:00 GMT'}), async (range, validator) => {
  assert.equal(validator, 'Mon, 05 Oct 2026 12:00:00 GMT');
  return new Response('def', {status:206,headers:{'content-range':'bytes 3-5/6','last-modified':validator}});
}, async () => true);
assert.equal(await weak.text(), 'abcdef');
console.log('PASS: healthy HTTP body outlives header timeout; stalled headers/body stop; cancel closes transport; truncated files resume exact bytes; wrong ranges or changed validators fail; revocation and bounded retries.');

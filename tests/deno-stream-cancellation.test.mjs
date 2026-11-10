import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {setImmediate as nextTurn} from 'node:timers/promises';

const source = readFileSync(new URL('../backend/main.ts', import.meta.url), 'utf8');
const globals = {Deno: globalThis.Deno, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
const timers = new Map();
const ticket = {username: 'fixture', password: 'fixture', id: '1', type: 'movie', expires: Date.now() + 60000};
let handler;

try {
  globalThis.Deno = {
    openKv: async () => ({get: async () => ({value: ticket})}),
    serve: callback => { handler = callback; },
  };
  globalThis.setTimeout = (fn, ms) => {
    const id = Symbol();
    timers.set(id, {fn, ms});
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  const js = stripTypeScriptTypes(source, {sourceUrl: 'backend/main.ts'});
  await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const stream = (signal, headers) => handler(new Request('https://fixture.test/stream?t=fixture', {signal, headers}));
  const hang = signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  });

  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('fixture'); };
  assert.equal((await stream(AbortSignal.abort())).status, 502);
  assert.equal(called, false, 'an already cancelled request must not contact the origin');

  globalThis.fetch = (_url, {signal}) => hang(signal);
  const client = new AbortController();
  const cancelled = stream(client.signal);
  await nextTurn();
  assert.equal(timers.size, 1);
  client.abort();
  assert.equal((await cancelled).status, 502);
  assert.equal(timers.size, 0);

  const timed = stream();
  await nextTurn();
  const [{fn, ms}] = [...timers.values()];
  assert.equal(ms, 15000);
  fn();
  assert.equal((await timed).status, 502);
  assert.equal(timers.size, 0);

  let upstreamSignal;
  globalThis.fetch = async (_url, {signal, headers}) => {
    upstreamSignal = signal;
    assert.equal(headers.get('range'), 'bytes=2-');
    assert.equal(headers.get('if-range'), '"fixture"');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(7));
        signal.addEventListener('abort', () => controller.error(signal.reason), {once: true});
      },
    });
    return new Response(body, {status: 206, headers: {'content-range': 'bytes 2-2/3'}});
  };
  const playback = new AbortController();
  const response = await stream(playback.signal, {Range: 'bytes=2-', 'If-Range': '"fixture"'});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-2/3');
  assert.equal(timers.size, 0, 'the header deadline must not outlive the headers');
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(7));
  const pending = reader.read();
  playback.abort(new Error('fixture playback cancelled'));
  await assert.rejects(pending, /fixture playback cancelled/);
  assert.equal(upstreamSignal.aborted, true);
  console.log('PASS Deno stream: pre-abort, disconnect, header deadline, range and body cancellation');
} finally {
  Object.assign(globalThis, globals);
}

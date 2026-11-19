import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import worker, {PlaybackSession} from '../src/index.js';

registerHooks({
 resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:sockets') {
   return {url: 'data:text/javascript,export const connect = () => globalThis.testRelaySocket()', shortCircuit: true};
  }
  return nextResolve(specifier, context);
 }
});

const env = {TICKET_SECRET: 'local-lease-failure-fixture', CCF_ENTRY_TRANSPORT: 'tcp'};
const sid = 'fixture-session';
const ticket = {
 sid, lease_id: 'lease', request_id: 'request', type: 'live', ext: 'ts', xtream: true,
 origin: 'http://ccf.center:8444', username: 'fixture', password: 'fixture',
 id: '1', exp: Date.now() + 60000
};
const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(env.TICKET_SECRET)), 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(ticket)));
const url = 'https://api.snaptvnow.com/stream?t=' + Buffer.concat([iv, new Uint8Array(encrypted)]).toString('base64url');
let socketClosures = 0, opens = 0, finalChecks = 0, reset = true;
const relay = new PlaybackSession({storage: {}, waitUntil() {}}, env);
env.PLAYBACK_SESSIONS = {
 idFromName: name => name,
 get: id => ({fetch: async (input, init) => {
  const request = new Request(input, init);
  if (id === '__smn_media_v1:' + sid) return relay.fetch(request);
  if (new URL(request.url).pathname === '/accounts/lease-check') {
   assert.ok(opens > finalChecks, 'origin is already open when the lease check runs');
   finalChecks++;
   if (reset) throw Error('fixture_directory_reset');
  }
  return new Response(null, {status: 200});
 }})
};
globalThis.testRelaySocket = () => {
 opens++;
 return {
  opened: Promise.resolve(), closed: new Promise(() => {}),
  readable: new ReadableStream({start(controller) {
   controller.enqueue(new TextEncoder().encode('HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\n'));
   controller.enqueue(new Uint8Array([0x47, 1, 2, 0x10]));
  }}),
  writable: new WritableStream(),
  close: async () => { socketClosures++; }
 };
};

try {
 const failed = await worker.fetch(new Request(url), env, {});
 assert.equal(failed.status, 502);
 assert.equal(socketClosures, 1, 'a failed authorization transport closes the abandoned live connection');

 reset = false;
 const live = await worker.fetch(new Request(url), env, {});
 assert.equal(live.status, 200);
 const reader = live.body.getReader();
 assert.deepEqual([...(await reader.read()).value], [0x47, 1, 2, 0x10]);
 assert.equal(socketClosures, 1, 'successful authorization hands the live connection to the player');
 await reader.cancel();
 assert.equal(socketClosures, 2, 'stopping playback still closes the origin');
 assert.equal(finalChecks, 2);
} finally {
 delete globalThis.testRelaySocket;
}

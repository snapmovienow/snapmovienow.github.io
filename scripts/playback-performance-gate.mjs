// Deterministic release gate: real worker routes, controlled source delays and
// a virtual clock. These are regression limits, not production latency claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import worker, {PlaybackSession} from '../cloudflare-worker/src/index.js';
import {openLeaseStore} from '../cloudflare-worker/src/lease-store.mjs';

class Store {
  constructor() { this.data = new Map(); this.queue = Promise.resolve(); }
  async get(key) { return Array.isArray(key) ? new Map(key.filter(name => this.data.has(name)).map(name => [name, structuredClone(this.data.get(name))])) : structuredClone(this.data.get(key)); }
  async put(key, value) { if (typeof key === 'object') { for (const [name, item] of Object.entries(key)) this.data.set(name, structuredClone(item)); } else this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  async deleteAll() { this.data.clear(); }
  async setAlarm() {}
  async list({prefix}) { return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); }
  transaction(fn) { const result = this.queue.then(() => fn(this)); this.queue = result.catch(() => {}); return result; }
}

const realNow = Date.now, realFetch = globalThis.fetch, realTimeout = AbortSignal.timeout, realAny=AbortSignal.any;
let now = realNow(), mode = 'healthy', charge = false;
const signalBudgets = new WeakMap(), calls = {validations: [], signals: [], ranges: []};
const objects = new Map(), pending = new Set();
const env = {TICKET_SECRET: 'local-performance-fixture-secret', ADMIN_SETUP_SECRET: 'local-performance-setup-12345678901234567890'};
env.PLAYBACK_SESSIONS = {
  idFromName: value => value,
  get(id) {
    if (!objects.has(id)) objects.set(id, new PlaybackSession({storage: new Store()}, env));
    return {fetch: (url, options) => objects.get(id).fetch(new Request(url, options))};
  }
};
const ctx = {waitUntil(promise) { pending.add(promise); promise.catch(() => {}).finally(() => pending.delete(promise)); }};
const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); };
const advance = (milliseconds, signal) => {
  if (!charge) return;
  const budget = signalBudgets.get(signal);
  const elapsed = budget === undefined ? milliseconds : Math.min(milliseconds, budget);
  now += elapsed;
  if (budget !== undefined && milliseconds > budget) throw new DOMException('Controlled fixture deadline', 'TimeoutError');
};
const fixtureRow = id => ['<a>' + id + '</a>', '<a>fixture-source-' + id + '</a>', '<span class="table-trunc-copy-cell__text tooltip" title="fixture-password">hidden</span>', 'owner', '<i title="Active"></i>', '', '', '0', '3', '', '', '2099-01-01'];
const report = {
  scope: 'Real worker HTTP routing with mock upstreams, virtual source time and in-memory serialized storage; excludes production provider, network, device decoding and Cloudflare CPU.',
  policy: {liveDeadlineMs: 8000, vodDeadlineMs: 12000, maxSourceAttempts: 3, validationDeadlineMs:5000, warmValidationRequests: 0, warmStarts: 12, concurrentViewers: 5},
  scenarios: []
};
const clearCalls = () => { calls.validations.length = 0; calls.signals.length = 0; calls.ranges.length = 0; };
const mark = (name, start, extra = {}) => report.scenarios.push({name, virtualElapsedMs: now - start, validations: calls.validations.length, mediaRequests: calls.signals.length, ...extra});
const origin = 'https://local-performance.example';
const post = async (body, route = '/') => {
  const response = await worker.fetch(new Request(origin + route, {method: 'POST', body: JSON.stringify(body)}), env, ctx);
  return {status: response.status, data: await response.json()};
};
let owner;
const admin = (action, body = {}) => post({action, access_token: owner, ...body}, '/admin');
const headers = client => ({'CF-Connecting-IP': '198.51.100.20', 'User-Agent': 'PerformanceFixture/' + client});
const endpoint = (user, route) => origin + route.replace('{user}', user).replace('{password}', 'local-viewer-password');
const request = (user, route, extra = {}) => worker.fetch(new Request(endpoint(user, route), {headers: {...headers(user), ...extra}}), env, ctx);
const cancel = async response => { await response.body?.cancel(); await drain(); };

try {
  Date.now = () => now;
  AbortSignal.timeout = milliseconds => {
    const signal = realTimeout.call(AbortSignal, milliseconds);
    signalBudgets.set(signal, milliseconds);
    return signal;
  };
  AbortSignal.any=signals=>{const signal=realAny.call(AbortSignal,signals),values=signals.map(s=>signalBudgets.get(s)).filter(Number.isFinite);if(values.length)signalBudgets.set(signal,Math.min(...values));return signal};
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith('/login')) return new Response(options.method === 'POST' ? '<a href="dashboard">Welcome</a>' : '<input name="password">', {headers: {'set-cookie': 'PHPSESSID=local; path=/'}});
    if (url.pathname.endsWith('/table')) return Response.json({recordsFiltered: 4, data: [1, 2, 3, 4].map(fixtureRow)});
    if (url.pathname === '/player_api.php') {
      const action = url.searchParams.get('action');
      if (action === 'get_live_streams') return Response.json([101, 102, 103, 104].map(stream_id => ({stream_id, name: 'Controlled channel ' + stream_id})));
      if (action === 'get_vod_streams') return Response.json([{stream_id: 201, name: 'Controlled movie', container_extension: 'mp4'}]);
      if (action === 'get_series') return Response.json([{series_id: 301, name: 'Controlled series'}]);
      if (action === 'get_series_info') return Response.json({info: {name: 'Controlled series'}, episodes: {1: [{id: 302, title: 'Controlled episode', episode_num: 1, season: 1, container_extension: 'mp4'}]}});
      if (action) return Response.json([]);
      const source = url.searchParams.get('username');
      calls.validations.push(source);
      const unavailable = mode === 'unavailable' || mode === 'cold-failover' && source === 'fixture-source-1';
      advance(unavailable ? 6000 : 200, options.signal);if(mode==='coalesced')await new Promise(resolve=>setTimeout(resolve,20));
      return Response.json({user_info: {auth: 1, status: 'Active', max_connections: '3', active_cons: '0'}});
    }
    if (url.pathname.startsWith('/live/')) {
      calls.signals.push(url.pathname.split('/')[2]);
      advance(100);
      if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/fixture-segment.ts\n', {headers: {'content-type': 'application/vnd.apple.mpegurl'}});
      return new Response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([0x47, 1, 2, 3])); }}), {headers: {'content-type': 'video/mp2t'}});
    }
    if (url.pathname.startsWith('/movie/') || url.pathname.startsWith('/series/')) {
      calls.signals.push(url.pathname.split('/')[2]);
      const range = new Headers(options.headers).get('range'); calls.ranges.push(range);
      advance(100);
      return new Response('0123456789', {status: 206, headers: {'content-type': 'video/mp4', 'content-length': '10', 'content-range': 'bytes 30-39/100', etag: '"local-fixture"'}});
    }
    if (url.pathname === '/fixture-segment.ts') return new Response(new Uint8Array([0x47, 1, 2, 3]), {headers: {'content-type': 'video/mp2t'}});
    throw Error('Unrecognized local fixture operation; external networking is disabled');
  };

  assert.equal((await post({action: 'setup', setupSecret: env.ADMIN_SETUP_SECRET, username: 'owner', password: 'local-owner-password'}, '/admin')).status, 200);
  owner = (await post({action: 'login', username: 'owner', password: 'local-owner-password'}, '/admin')).data.access_token;
  assert.equal((await admin('provider-save', {mode: 'panel', username: 'owner', password: 'local-panel-password'})).status, 200);
  for (let index = 0; index < 11; index++) assert.equal((await admin('save', {create: true, username: 'local-viewer-' + index, password: 'local-viewer-password', status: 'active'})).status, 200);
  const channels = await (await request('local-viewer-0', '/player_api.php?username={user}&password={password}&action=get_live_streams')).json();
  const movies = await (await request('local-viewer-0', '/player_api.php?username={user}&password={password}&action=get_vod_streams')).json();
  const series = await (await request('local-viewer-0', '/player_api.php?username={user}&password={password}&action=get_series')).json();
  const details = await (await request('local-viewer-0', '/player_api.php?username={user}&password={password}&action=get_series_info&series_id=' + series[0].series_id)).json();
  const episodeId = Object.values(details.episodes).flat()[0].id;
  const accounts = objects.get('__smn_accounts_v1').state.storage;
  const leases = await openLeaseStore(accounts);
  const live = (user, index, extension = 'ts') => request(user, '/live/{user}/{password}/' + channels[index % channels.length].stream_id + '.' + extension);
  const active = async () => [...(await leases.active()).values()];

  charge = true; mode = 'cold-failover'; clearCalls(); let started = now;
  let response = await live('local-viewer-0', 0);
  assert.equal(response.status, 200, 'cold startup recovers from one slow source');
  assert.ok(now - started <= 4000, 'one slow validation must not multiply into repeated full timeouts');
  assert.ok(calls.validations.length <= 3, 'cold recovery is bounded by one candidate budget');
  const initial = (await active())[0]; assert.ok(initial);
  const firstReader = response.body.getReader();
  assert.deepEqual([...(await firstReader.read()).value], [0x47, 1, 2, 3], 'a small first media payload must be delivered immediately');
  firstReader.releaseLock();
  mark('cold-start-with-slow-source', started);
  await cancel(response);

  mode = 'healthy'; clearCalls(); started = now;
  for (let index = 0; index < report.policy.warmStarts; index++) {
    response = await live('local-viewer-0', index, index % 2 ? 'ts' : 'm3u8');
    assert.equal(response.status, 200);
    assert.equal((await active())[0].provider_id, initial.provider_id, 'healthy CCF affinity survives format and channel changes');
    if (index % 2) await cancel(response); else { await response.text(); await drain(); }
    assert.ok((await leases.count()) <= 1, 'rapid zapping cannot accumulate this viewer\'s leases');
  }
  assert.equal(calls.validations.length, 0, 'warm starts cannot repeat a fresh account validation');
  assert.ok(now - started <= report.policy.warmStarts * 150, 'warm startup has no repeated validation penalty');
  mark('warm-channel-changes', started, {starts: report.policy.warmStarts});

  for (const [type, id] of [['movie', movies[0].stream_id], ['series', episodeId]]) {
    clearCalls(); started = now;
    for (let index = 0; index < 5; index++) {
      const movie = await request('local-viewer-0', '/' + type + '/{user}/{password}/' + id + '.mp4', {Range: 'bytes=30-39'});
      assert.equal(movie.status, 206); assert.equal(movie.headers.get('content-range'), 'bytes 30-39/100');
      assert.equal(await movie.text(), '0123456789'); await drain();
    }
    assert.ok(calls.validations.length <= 1, 'resume requests share recent validation');
    assert.deepEqual(calls.ranges, Array(5).fill('bytes=30-39'), 'resume byte ranges reach the source unchanged');
    assert.ok(now - started <= 750, 'seeking cannot reintroduce one validation per range');
    mark(type + '-resume-byte-ranges', started, {requests: 5});
  }

  clearCalls(); started = now;
  const viewers = await Promise.all(Array.from({length: report.policy.concurrentViewers}, (_, index) => live('local-viewer-' + (index + 1), index)));
  assert.ok(viewers.every(value => value.status === 200));
  const simultaneous = await active();
  assert.equal(new Set(simultaneous.map(lease => lease.uid)).size, report.policy.concurrentViewers, 'five viewers keep five independent owners');
  const countByProvider = new Map();
  for (const lease of simultaneous) countByProvider.set(lease.provider_id, (countByProvider.get(lease.provider_id) || 0) + 1);
  assert.ok([...countByProvider.values()].every(value => value <= 3), 'concurrent starts never overbook a provider');
  await Promise.all(viewers.map(cancel));
  assert.equal(await leases.count(), 0, 'concurrent disconnects release every playback reservation');
  mark('concurrent-independent-viewers', started, {viewers: viewers.length, peakProviderOccupancy: Math.max(...countByProvider.values())});

  // Three independent viewers compete for the same account's three local
  // slots while its one status response is deliberately still in flight.
  const inventory=await accounts.get('pool');await accounts.put('pool',{...inventory,lines:inventory.lines.slice(0,1)});await accounts.delete('provider-health');
  mode='coalesced';clearCalls();started=now;
  const joined=await Promise.all([8,9,10].map(index=>live('local-viewer-'+index,0)));
  assert.ok(joined.every(value=>value.status===200));assert.equal(calls.validations.length,1,'concurrent viewers share an in-flight validation, never a playback reservation');
  const joinedLeases=await active();assert.equal(new Set(joinedLeases.map(lease=>lease.uid)).size,3);assert.equal(joinedLeases.length,3);
  mark('concurrent-validation-coalescing',started,{viewers:3});await Promise.all(joined.map(cancel));assert.equal(await leases.count(),0);await accounts.put('pool',inventory);

  mode = 'unavailable';
  for (const [type, deadline, id] of [['live', 8000, 0], ['movie', 12000, movies[0].stream_id], ['series', 12000, episodeId]]) {
    await accounts.delete('provider-health');
    clearCalls(); started = now;
    const result = type === 'live' ? await live('local-viewer-7', 0) : await request('local-viewer-7', '/' + type + '/{user}/{password}/' + id + '.mp4');
    assert.ok(result.status >= 500, 'unavailable sources must fail without claiming successful playback');
    assert.ok(calls.validations.length <= 3, 'nested allocation and playback retries cannot multiply source attempts');
    assert.ok(now - started <= Math.min(deadline,report.policy.validationDeadlineMs), 'source validation stays inside its five-second sub-budget and overall startup deadline');
    await cancel(result);
    assert.equal(await leases.count(), 0, 'unavailable source attempts cannot leak reservations');
    mark(type + '-all-sources-timeout', started, {deadlineMs: deadline, status: result.status});
  }
  if (process.env.SMN_PERFORMANCE_REPORT) {
    const target = path.resolve(process.env.SMN_PERFORMANCE_REPORT);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('PASS playback release gate: cold recovery, warm zapping, Range resume, concurrent isolation, shared live/VOD deadlines and cleanup.');
  console.log(JSON.stringify(report));
} finally {
  await drain();
  Date.now = realNow; globalThis.fetch = realFetch; AbortSignal.timeout = realTimeout;AbortSignal.any=realAny;
}

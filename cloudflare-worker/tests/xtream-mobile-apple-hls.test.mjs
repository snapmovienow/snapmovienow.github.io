import assert from 'node:assert/strict';
import {handleXtream} from '../src/xtream.mjs';

const origin = 'https://xtream.example';
const apple = 'AppleCoreMedia/1.0.0.22G86 (iPhone; U; CPU OS 18_6 like Mac OS X)';
const stream = '/live/test%40local/test%2Fvalue/878.ts';
const json = (data, status) => Response.json(data, {status});

function request(path = stream, method = 'GET', agent = apple) {
  return new Request(origin + path, {method, headers: {'User-Agent': agent, Range: 'bytes=0-1'}});
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls, json,
    authenticate: async (user, password) => {
      assert.equal(user, 'test@local');
      assert.equal(password, 'test/value');
      return {user: {permissions: {tv: true, movies: true, series: true, adults: false}}, session: {}};
    },
    resolve: async () => ({kind: 'live', server: 'ccf'}),
    adultPolicy: {allowed: async () => true},
    play: async (req, session, record) => {
      calls.push([req.method, record.type, record.ext]);
      return new Response(null, {status: 200});
    },
    ...overrides
  };
}

for (const agent of [
  apple, apple.replace('iPhone;', 'iPad;'), apple.replace('iPhone;', 'iPhone Simulator;'),
  'SmartersPlayerLite/1.4.2 (iOS 18.6; iPhone)', 'Smarters%20Player%20Lite/1.4.2 (iPadOS 18.6)',
  'SmartersPlayerLite/1.4.2 CFNetwork/123 Darwin/24'
]) {
  for (const method of ['GET', 'HEAD']) {
    const deps = dependencies();
    const response = await handleXtream(request(stream + '?ignored=value', method, agent), deps);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('Location'), '878.m3u8');
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('Vary'), 'User-Agent');
    assert.equal(response.body, null);
    assert.equal(deps.calls.length, 0);
    const target = new URL(response.headers.get('Location'), origin + stream);
    assert.equal(target.href, origin + stream.replace('.ts', '.m3u8'));
    assert.equal((await handleXtream(request(target.pathname, method, agent), deps)).status, 200);
    assert.deepEqual(deps.calls, [[method, 'live', 'm3u8']]);
  }
}

for (const agent of [
  '', 'VLC/3.0.21', 'VLC/3.0.21 (iPhone)', 'ExoPlayer/2.18 (Android)',
  'SmartersPlayerLite/1.4.2 (Android)', 'UnrelatedApp/1.0 CFNetwork/123 Darwin/24',
  'AppleCoreMedia/1.0 (Macintosh)', 'AppleCoreMedia/1.0 (AppleTV)', 'Mozilla/5.0 (iPhone)'
]) {
  const deps = dependencies();
  assert.equal((await handleXtream(request(stream, 'GET', agent), deps)).status, 200);
  assert.deepEqual(deps.calls, [['GET', 'live', 'ts']]);
}

for (const [path, kind, method, type] of [
  [stream, 'live', 'POST', 'live'], [stream.replace('/live/', '/movie/'), 'movie', 'GET', 'movie'],
  [stream.replace('/live/', '/series/'), 'episode', 'GET', 'series']
]) {
  const deps = dependencies({resolve: async () => ({kind, server: 'ccf'})});
  assert.equal((await handleXtream(request(path, method), deps)).status, 200);
  assert.deepEqual(deps.calls, [[method, type, 'ts']]);
}

for (const [overrides, expected] of [
  [{authenticate: async () => json({}, 401)}, 401],
  [{authenticate: async () => ({user: {permissions: {tv: false}}, session: {}})}, 403],
  [{resolve: async () => null}, 404],
  [{resolve: async () => ({kind: 'movie'})}, 404],
  [{adultPolicy: {allowed: async () => false}}, 403]
]) {
  const deps = dependencies(overrides);
  const response = await handleXtream(request(), deps);
  assert.equal(response.status, expected);
  assert.equal(response.headers.has('Location'), false);
  assert.equal(deps.calls.length, 0);
}

const local = dependencies({localLive: {matches: () => true, play: (req, auth, row) => json({ext: row.ext}, 200)}});
const response = await handleXtream(request(), local);
assert.deepEqual(await response.json(), {ext: 'ts'});
assert.equal(response.headers.has('Location'), false);
console.log('PASS: authenticated mobile Apple live TS negotiates HLS with a private sibling redirect.');

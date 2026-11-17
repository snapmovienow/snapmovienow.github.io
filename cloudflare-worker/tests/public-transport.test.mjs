import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import {requireControlHTTPS} from '../src/public-transport.mjs';

const env = {ENVIRONMENT:'production',TICKET_SECRET:'fixture-only-transport-test-secret'};

test('management endpoints and native logins require TLS', async () => {
  for (const [host, path, method, body] of [
    ['api.snaptvnow.com', '/', 'POST', '{"op":"auth"}'],
    ['api.snaptvnow.com', '/another-path', 'POST', '{"op":"auth"}'],
    ['api.snaptvnow.com', '/admin', 'POST', 'fixture'],
    ['api.snaptvnow.com', '/reseller-bridge', 'POST', 'fixture'],
    ['api.snaptvnow.com', '/bounded-ts-diagnostic', 'POST', 'fixture'],
    ['api.snaptvnow.com', '/api/boxpanel/builds/claim', 'POST', 'fixture'],
    ['api.snaptvnow.com', '/owner-panel/enter?ticket=private-fixture', 'GET'],
    ['resellers.snaptvnow.com', '/?token=private-fixture', 'GET'],
    ['resellers.snaptvnow.com', '/api/portal', 'POST', 'fixture']
  ]) {
    const req = new Request('http://' + host + path, {method,
      headers: {'X-Forwarded-Proto':'https','Content-Type':'application/json'}, body});
    const result = await worker.fetch(req, env);
    assert.equal(result.status, 400, path);
    assert.equal(result.headers.has('Location'), false);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.has('Set-Cookie'), false);
    assert.deepEqual(await result.json(), {error:'https_required'});
  }
});

test('known public entry pages upgrade without forwarding credentials', async () => {
  for (const hostAndPath of ['api.snaptvnow.com/owner-panel','resellers.snaptvnow.com/','juanito.resellers.snaptvnow.com/apps']) {
    const req = new Request('http://' + hostAndPath);
    const result = await worker.fetch(req, env);
    assert.equal(result.status,301);
    assert.equal(result.headers.get('Location'),'https://' + hostAndPath);
    for (const headers of [{Authorization:'Bearer fixture'}, {Cookie:'key=fixture'}]) {
      const denied = await worker.fetch(new Request(req,{headers}),env);
      assert.equal(denied.status,400);
      assert.equal(denied.headers.has('Location'),false);
    }
  }
  assert.equal(requireControlHTTPS(new Request('http://127.0.0.1:8787/')),null);
  assert.equal(requireControlHTTPS(new Request('https://api.snaptvnow.com/admin')),null);
});

test('legacy clients and device paths retain their existing routing', async () => {
  const deviceEnv = {...env, PLAYBACK_SESSIONS:{
    idFromName: id => id,
    get: () => ({fetch: async () => Response.json({fixture:'config'})})
  }};
  const config = await worker.fetch(new Request(
    'http://api.snaptvnow.com/api/boxpanel/client/00000000-0000-0000-0000-000000000000/config'), deviceEnv);
  assert.equal(config.status,200);
  assert.deepEqual(await config.json(),{fixture:'config'});
  for (const [path, method, body, expectedStatus, expectedError] of [
    ['/stream?t=invalid','GET',undefined,410,'Expired'],
    ['/player_api.php','GET',undefined,400,'https_required'],
    ['/movie/fixture/fixture/1.mp4','GET',undefined,400,'https_required'],
    ['/','POST','{"op":"profile_get"}',401,'session_required'],
    ['/api/boxpanel/client/00000000-0000-0000-0000-000000000000/config','POST','{}',405,'method_not_allowed']
  ]) {
    const response = await worker.fetch(new Request('http://api.snaptvnow.com' + path,
      {method, body,headers:{'Content-Type':'application/json'}}), env);
    assert.equal(response.status,expectedStatus,path);
    const code = response.headers.get('content-type')?.includes('json') ? (await response.json()).error : await response.text();
    assert.equal(code,expectedError,path);
  }
});

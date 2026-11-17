import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import worker from '../src/index.js';
import {matchesStaticAdminURL, staticAdminResponse} from '../src/static-admin-response.mjs';

const https = 'https://app.snaptvnow.com';
test('only the static admin route goes straight to Pages, preserving conditional requests and bytes', async () => {
  const original = globalThis.fetch;
  const request = new Request(https + '/admin.js?v=43', {headers:{'If-None-Match':'"fixture"'}});
  let calls = 0;
  globalThis.fetch = async (req, options) => {
    calls++;
    assert.equal(req,request);
    assert.equal(options.redirect,'manual');
    return new Response('fixture JS', {headers:{'Content-Type':'application/javascript','Cache-Control':'max-age=600',
      ETag:'"fixture"','Content-Security-Policy':"script-src 'self'"}});
  };
  try {
    const res = await worker.fetch(request, new Proxy({}, {get(){throw Error('unexpected backend access');}}));
    assert.equal(calls,1);
    assert.equal(res.status,200);
    assert.equal(await res.text(),'fixture JS');
    assert.equal(res.headers.get('cache-control'),'max-age=600');
    assert.equal(res.headers.get('etag'),'"fixture"');
    assert.equal(res.headers.get('content-type'),'application/javascript');
    assert.equal(res.headers.get('content-security-policy'),"script-src 'self', frame-ancestors 'none'");
    assert.equal(res.headers.get('x-frame-options'),'DENY');
    assert.equal(res.headers.get('referrer-policy'),'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'),'nosniff');
    assert.equal(res.headers.get('strict-transport-security'),'max-age=86400');
  } finally {globalThis.fetch = original;}
  for (const path of ['/owner-security.html','/owner-security.js','/admin.html']) {
    assert.equal(matchesStaticAdminURL(new URL(https+path)),true);
  }
  for (const url of ['https://api.snaptvnow.com/admin','https://other.example/admin.html',https+'/',https+'/player_api.php']) {
    assert.equal(matchesStaticAdminURL(new URL(url)),false);
  }
});
test('static route preserves HTTP redirects, cache revalidation and HEAD behavior',async()=>{
  for(const status of [301,304,404]){
    const req=new Request('http://app.snaptvnow.com/admin.html?lang=es',{method:'HEAD'});
    const res=await staticAdminResponse(req,async(input,options)=>{
      assert.equal(input.method,'HEAD');assert.equal(options.redirect,'manual');
      return new Response(null,{status,headers:status===301?{Location:https+'/admin.html?lang=es'}:{}});
    });
    assert.equal(res.status,status);
    assert.equal(res.body,null);
    assert.equal(res.headers.has('strict-transport-security'),false);
    if(status===301)assert.equal(res.headers.get('location'),https+'/admin.html?lang=es');
  }
});
test('Worker maps only the selected path to the existing Pages origin',()=>{
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url)));
  assert.deepEqual(cfg.routes.filter(r=>r.pattern.includes('app.snaptvnow.com')),['admin*','owner-security*'].map(path=>({pattern:'app.snaptvnow.com/'+path,zone_id:'17501b8eeff61147b9fd949f1885d74a'})));
  assert.ok(!cfg.compatibility_flags.includes('global_fetch_strictly_public'));
});

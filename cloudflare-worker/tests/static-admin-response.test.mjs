import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';
import worker from '../src/index.js';
import {matchesStaticAdminURL, staticAdminResponse} from '../src/static-admin-response.mjs';

const https = 'https://app.snaptvnow.com';
test('only the static admin route goes straight to Pages, preserving conditional requests and bytes', async () => {
  const original = globalThis.fetch;
  const request = new Request(https + '/admin.js?v=43', {headers:{'If-None-Match':'"fixture"', Cookie:'synthetic=private', Authorization:'Bearer synthetic', 'X-Test-Secret':'dummy'}});
  let calls = 0;
  globalThis.fetch = async (req, options) => {
    calls++;
    assert.equal(req.url,request.url);
    assert.deepEqual(Object.fromEntries(req.headers),{'if-none-match':'"fixture"'});
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
test('safe HTTP page entries upgrade without sending a request to Pages',async()=>{
  const noFetch=()=>assert.fail('static request must not reach Pages');
  const response=await staticAdminResponse(new Request('http://app.snaptvnow.com/admin.html'),noFetch);
  assert.equal(response.status,301);
  assert.equal(response.headers.get('location'),https+'/admin.html');
  for(const [path, method, headers, status] of [
    ['http://app.snaptvnow.com/admin.html?username=fixture','GET',{},400],
    ['http://app.snaptvnow.com/admin.html','POST',{},400],
    ['http://app.snaptvnow.com/admin.html','GET',{Cookie:'test=1'},400],
    ['http://app.snaptvnow.com/admin.js','GET',{},400],
    [https+'/admin.html','POST',{},405],
    [https+'/admin.html?username=fixture','GET',{},400],
    [https+'/admin.js?v=1&token=fixture','GET',{},400],
    [https+'/owner-security/unexpected','GET',{},404],
  ]) {
    const rejected=await staticAdminResponse(new Request(path,{method,headers}),noFetch);
    assert.equal(rejected.status,status);
    assert.equal(rejected.headers.get('location'),null);
    assert.equal(rejected.headers.get('cache-control'),'no-store');
  }
});
test('HTTPS Pages conditional HEAD requests retain origin status and have no body',async()=>{
  for(const status of [304,404]){
    const req=new Request(https+'/admin.js?v=43.10',{method:'HEAD'});
    const res=await staticAdminResponse(req,async(input)=>{
      assert.equal(input.method,'HEAD');
      return new Response(null,{status});
    });
    assert.equal(res.status,status);
    assert.equal(res.body,null);
  }
});
test('admin forms protect native submission when the client module fails to run',async()=>{
  const cached=await staticAdminResponse(new Request(https+'/admin.html'),()=>new Response('old HTML'));
  assert.match(cached.headers.get('content-security-policy'),/form-action 'none'/);
  const root=new URL('../../',import.meta.url);
  const page=readFileSync(new URL('admin.html',root),'utf8');
  assert.ok(page.includes("form-action 'none'"));
  for(const file of readdirSync(root).filter(p=>p==='admin.html'||/^admin(?:-[\w-]+)?\.js$/.test(p))){
    const source=readFileSync(new URL(file,root),'utf8');
    for(const [form] of source.matchAll(/<form\b[^>]*>/gi))assert.match(form,/\bmethod="post"/i,file);
  }
});
test('Worker maps only the selected path to the existing Pages origin',()=>{
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url)));
  assert.deepEqual(cfg.routes.filter(r=>r.pattern.includes('app.snaptvnow.com')),['admin*','owner-security*'].map(path=>({pattern:'app.snaptvnow.com/'+path,zone_id:'17501b8eeff61147b9fd949f1885d74a'})));
  assert.ok(!cfg.compatibility_flags.includes('global_fetch_strictly_public'));
});

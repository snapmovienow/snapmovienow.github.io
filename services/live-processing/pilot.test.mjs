import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createPilot} from './pilot.mjs';
import {DEFAULT_POLICY,validatePolicy,selectedChannel,validateCatalog} from './policy.mjs';
const token='a'.repeat(48),catalog=[{id:'sports-1',name:'Deporte 1',categoryId:'sports',categoryName:'Deportes',demo:true},{id:'sports-2',name:'Deporte 2',categoryId:'sports',categoryName:'Deportes',demo:true},{id:'news-1',name:'Noticias',categoryId:'news',categoryName:'Noticias',demo:true}];
const selected=()=>({...DEFAULT_POLICY,enabled:true,categories:['sports'],logo:false,idleSeconds:10});
async function fixture(options={}) {
  let time=1700000000000,created=0,stopped=0;
  const fake=async({directory})=>{
    created++;await new Promise(r=>setTimeout(r,10));
    await mkdir(path.join(directory,'0'),{recursive:true});await mkdir(path.join(directory,'1'),{recursive:true});
    for(const i of [0,1]){await writeFile(path.join(directory,String(i),'index.m3u8'),'#EXTM3U\n#EXTINF:2,\nseg000000000.ts\n');await writeFile(path.join(directory,String(i),'seg000000000.ts'),'media');}
    return {exited:false,mediaReady:async()=>true,stop:async()=>{stopped++;await rm(directory,{recursive:true,force:true});}};
  };
  const pilot=await createPilot({adminToken:token,catalog,demo:true,initialPolicy:selected(),now:()=>time,encoder:fake,sweepMs:100000,...options});
  await new Promise(r=>pilot.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+pilot.server.address().port;
  const api=(route,method='GET',data,extra={})=>fetch(base+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
  const preview=async id=>{const r=await api('preview','POST',{channelId:id});assert.equal(r.status,200);return (await r.json()).url;};
  return {pilot,base,api,preview,counts:()=>({created,stopped}),advance:ms=>{time+=ms;}};
}
test('bounded policies and category/time selection; no implicit all-channel processing',()=>{
  assert.equal(selectedChannel(DEFAULT_POLICY,catalog[0]),false);
  assert.equal(selectedChannel(validatePolicy(selected()),catalog[0]),true);
  assert.equal(selectedChannel(validatePolicy(selected()),catalog[2]),false);
  const p=validatePolicy({...selected(),window:{start:100,end:200}});
  assert.equal(selectedChannel(p,catalog[0],99),false);assert.equal(selectedChannel(p,catalog[0],100),true);assert.equal(selectedChannel(p,catalog[0],200),false);
  for(const invalid of [{maxChannels:0},{maxChannels:21},{idleSeconds:0},{profiles:[]},{profiles:['4k']},{channels:['../']},{categories:['sports','sports']},{text:'x\n'},{window:{start:2,end:1}},{credits:100}])assert.throws(()=>validatePolicy({...selected(),...invalid}));
  assert.throws(()=>validateCatalog([{...catalog[0],demo:false,source:'http://127.0.0.1/private'}],{allowedOrigins:['https://provider.example']}));
  assert.throws(()=>validateCatalog(catalog,{demo:false}));
});
test('admin authentication, same origin and sanitized catalog',async()=>{
  const f=await fixture({catalog:[{id:'real-1',name:'Canal',categoryId:'sports',categoryName:'Deportes',source:'https://provider.example/live/private-user/private-password/1.ts'}],allowedOrigins:['https://provider.example']});
  try{
    assert.equal((await fetch(f.base+'/api/config')).status,401);
    assert.equal((await f.api('config','GET',undefined,{Origin:'https://attacker.example'})).status,403);
    const text=await (await f.api('config')).text();assert(!text.includes('private-password'));assert(!text.includes('provider.example'));
    const health=await (await fetch(f.base+'/health')).json();assert.equal(health.customerRouting,false);
    const r=await f.api('preview','POST',{channelId:'real-1',source:'http://attacker.example'});assert.equal(r.status,200);
    assert.equal(f.counts().created,0,'issuing a preview cannot start encoding');
  }finally{await f.pilot.close();}
});
test('20 concurrent starts share one encoder; category does not start unused channels; bounded capacity',async()=>{
  const f=await fixture();
  try{
    const url=await f.preview('sports-1');
    const results=await Promise.all(Array.from({length:20},()=>fetch(f.base+url)));
    assert(results.every(r=>r.status===200));await Promise.all(results.map(r=>r.arrayBuffer()));
    assert.equal(f.counts().created,1);
    const second=await f.preview('sports-2');assert.equal((await fetch(f.base+second)).status,503);assert.equal(f.counts().created,1);
    assert.equal((await f.api('preview','POST',{channelId:'news-1'})).status,403);
    const status=await (await f.api('status')).json();assert.equal(status.active.length,1);assert.equal(status.starts,1);
    f.advance(10001);await f.pilot.sweep();assert.equal(f.counts().stopped,1);
    assert.equal((await fetch(f.base+second)).status,200);assert.equal(f.counts().created,2);
  }finally{await f.pilot.close();}
});
test('every playlist/segment requires a channel grant; HEAD and missing assets do not keep encoders alive',async()=>{
  const f=await fixture();
  try{
    const url=await f.preview('sports-1'),u=new URL(url,f.base),grant=u.searchParams.get('token');
    assert.equal((await fetch(f.base+url,{method:'HEAD'})).status,404);assert.equal(f.counts().created,0);
    assert.equal((await fetch(f.base+'/hls/sports-1/master.m3u8')).status,401);
    assert.equal((await fetch(f.base+url.replace('sports-1','sports-2'))).status,401);
    assert.equal((await fetch(f.base+url)).status,200);
    const playlist=await (await fetch(`${f.base}/hls/sports-1/0/index.m3u8?token=${grant}`)).text();assert(playlist.includes('seg000000000.ts?token='));
    assert.equal((await fetch(`${f.base}/hls/sports-1/0/seg000000000.ts`)).status,401);
    assert.equal((await fetch(`${f.base}/hls/sports-1/0/seg000000000.ts?token=${grant}`)).status,200);
    f.advance(10001);assert.equal((await fetch(f.base+url,{method:'HEAD'})).status,200);
    assert.equal((await fetch(`${f.base}/hls/sports-1/0/seg999999999.ts?token=${grant}`)).status,404);
    await f.pilot.sweep();assert.equal(f.counts().stopped,1);
    f.advance(600000);assert.equal((await fetch(f.base+url)).status,401);assert.equal(f.counts().created,1);
  }finally{await f.pilot.close();}
});
test('atomic revisions reject stale writers and disable immediately revokes existing previews',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'snap-policy-')),policyFile=path.join(directory,'policy.json');
  const f=await fixture({policyFile});
  try{
    const url=await f.preview('sports-1');assert.equal((await fetch(f.base+url)).status,200);
    const policy={...selected(),enabled:false};
    const results=await Promise.all([f.api('config','PUT',{expectedRevision:0,policy}),f.api('config','PUT',{expectedRevision:0,policy})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.counts().stopped,1);
    assert.equal((await fetch(f.base+url)).status,401);
    const saved=JSON.parse(await readFile(policyFile,'utf8'));assert.equal(saved.revision,1);assert.equal(saved.enabled,false);
    assert.equal((await f.api('config','PUT',{expectedRevision:1,policy:{...saved,enabled:true,channels:['missing']}})).status,400);
    assert.equal(JSON.parse(await readFile(policyFile,'utf8')).revision,1);
  }finally{await f.pilot.close();await rm(directory,{recursive:true,force:true});}
});
test('startup cannot publish a playlist after the owner disables the policy',async()=>{
  let release;const ready=new Promise(r=>{release=r;});let stopped=0;
  const f=await fixture({encoder:async()=>({exited:false,mediaReady:async()=>ready,stop:async()=>{stopped++;}})});
  try{
    const url=await f.preview('sports-1'),request=fetch(f.base+url);
    await new Promise(r=>setTimeout(r,30));
    assert.equal((await f.api('config','PUT',{expectedRevision:0,policy:{...selected(),enabled:false}})).status,200);
    release(true);assert.equal((await request).status,401);assert.equal(stopped,1);
  }finally{release(true);await f.pilot.close();}
});

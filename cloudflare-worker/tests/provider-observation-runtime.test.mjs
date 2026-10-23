import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const actualNow=Date.now;let time=actualNow();Date.now=()=>time;
const objects=new Map(),env={TICKET_SECRET:'provider-observation-test-secret',ADMIN_SETUP_SECRET:'provider-observation-setup-long-test-secret'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
let busy=true,broken=false,mediaCalls=0;
const row=id=>['<a>'+id+'</a>','<a>source'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="source-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:2,data:[1,2].map(row)});
 if(u.pathname==='/player_api.php')return u.searchParams.has('action')?Response.json([{stream_id:123,name:'Test movie'}]):Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:busy?'3':'0'}});
 if(u.pathname.startsWith('/movie/')){mediaCalls++;const range=new Headers(opts.headers).get('range');if(range==='bytes=9999-')return new Response(null,{status:416,headers:{'content-range':'bytes */4'}});if(broken)return new Response('provider unavailable',{status:503});return new Response(new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,1]),{status:range?206:200,headers:{'content-type':'video/mp4','content-length':'16',...(range?{'content-range':'bytes 0-15/16'}:{})}})}
 throw Error('unexpected upstream test path');
};
const origin='https://api.example.com',pending=[],ctx={waitUntil(p){pending.push(Promise.resolve(p).catch(()=>{}))}};
const call=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
try{
 await call({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');const adminToken=(await call({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token;
 const admin=(action,body={})=>call({action,access_token:adminToken,...body},'/admin');assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'})).status,200);
 const tokens=[];for(let i=0;i<2;i++){await admin('save',{create:true,username:'viewer'+i,password:'viewer-password-test',status:'active'});tokens.push((await call({op:'auth',username:'viewer'+i,password:'viewer-password-test'})).data.access_token)}
 const storage=objects.get('__smn_accounts_v1').state.storage,leases=await openLeaseStore(storage);let revision=0;
 const prepare=(i=0)=>call({op:'stream_token',access_token:tokens[i],type:'movie',id:123,ext:'mp4',request_id:'web-vod-'+(++revision),revision});
 const stream=(prepared,headers={})=>worker.fetch(new Request(prepared.data.url,{headers}),env,ctx);
 for(let i=0;i<4;i++){const r=await prepare();assert.equal(r.status,409);assert.equal(r.data.error,'ccf_capacity')}
 let summary=(await admin('playback-diagnostics')).data.providers;assert.deepEqual(summary.circuits,[],'valid but full accounts never open an outage circuit');assert.equal(await leases.count(),0);assert.equal(mediaCalls,0);
 busy=false;const pool=await storage.get('pool');await storage.put('pool',{...pool,lines:pool.lines.slice(0,1)});await storage.delete('provider-health');
 const healthy=await prepare(1);assert.equal(healthy.status,200);const healthyResponse=await stream(healthy);assert.equal(healthyResponse.status,200);await healthyResponse.arrayBuffer();
 const ownHealthy=await leases.active({});assert.equal(ownHealthy.size,1);const [healthyLeaseId]=[...ownHealthy.keys()];
 let health=await storage.get('provider-health');assert.equal(Object.keys(health).filter(k=>k.startsWith('channel|')).length,1,'direct web VOD observes actual initial bytes, not just allocation validation');
 // Ignore caller-supplied impossible seeks and internal startup headers. They
 // cannot become false provider incidents or prevent the next valid observation.
 for(let i=0;i<3;i++){
  const r=await prepare();assert.equal(r.status,200);const invalidRange=await stream(r,{Range:'bytes=9999-'});assert.equal(invalidRange.status,416);await invalidRange.body?.cancel();
  const real=await stream(r,{'X-SMN-Prepare':'1','X-SMN-Startup-Deadline':'1'});assert.equal(real.status,200,'public callers cannot force immediate internal startup timeout');await real.arrayBuffer();
 }
 assert.deepEqual((await admin('playback-diagnostics')).data.providers.circuits,[]);
 // Each failed actual GET counts once, releases only its own slot, and the
 // third consecutive failure temporarily isolates the exact movie/source.
 broken=true;
 for(let i=0;i<3;i++){
  const r=await prepare();assert.equal(r.status,200);const failed=await stream(r);assert.equal(failed.status,503);await failed.text();assert.equal(await leases.count(),1);assert.ok(await leases.get(healthyLeaseId),'other viewer keeps its existing lease');
 }
 summary=(await admin('playback-diagnostics')).data.providers;assert.ok(summary.circuits.some(c=>c.scope==='media'&&c.type==='movie'&&c.state==='open'));
 const before=mediaCalls,blocked=await prepare();assert.equal(blocked.status,503);assert.equal(blocked.data.error,'provider_temporarily_unavailable');assert.equal(mediaCalls,before,'open circuit avoids another upstream wait');
 time+=30001;broken=false;const recovery=await prepare();assert.equal(recovery.status,200);const recovered=await stream(recovery);assert.equal(recovered.status,200);await recovered.arrayBuffer();assert.deepEqual((await admin('playback-diagnostics')).data.providers.circuits,[],'real web VOD success completes half-open recovery');
 await call({op:'playback_release',access_token:tokens[0],lease_id:recovery.data.lease_id,request_id:recovery.data.request_id});assert.equal(await leases.count(),1);await Promise.all(pending);
 console.log('PASS: capacity busy stays healthy; direct web VOD observations, forged timeout/invalid Range isolation, scoped quarantine and automatic real-byte recovery preserve other viewers.');
}finally{Date.now=actualNow}

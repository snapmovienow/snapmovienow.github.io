import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
const clock=Date.now,realFetch=globalThis.fetch;Date.now=()=>Date.parse('2026-10-24T22:22:00Z');
class Store{
 data=new Map();queue=Promise.resolve();
 async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key))}
 async put(key,value){if(typeof key==='object'){for(const [k,v]of Object.entries(key))this.data.set(k,structuredClone(v));return}this.data.set(key,structuredClone(value))}
 async delete(key){this.data.delete(key)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)))}
 transaction(fn){const task=this.queue.then(()=>fn(this));this.queue=task.catch(()=>{});return task}
}
const objects=new Map(),pending=[],comparisonAllocations=[],env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'dieguito2026',TICKET_SECRET:'targeted-fixture-secret',ADMIN_SETUP_SECRET:'targeted-fixture-setup-secret-long-enough'};
const waitUntil=p=>pending.push(Promise.resolve(p).catch(()=>{})),ctx={waitUntil};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store(),waitUntil},env));return {fetch:async(url,opts)=>{const req=new Request(url,opts);if(new URL(req.url).pathname==='/accounts/acquire'){const body=await req.clone().json();if(body.comparison)comparisonAllocations.push({exclude:body.exclude,mediaKey:body.mediaKey})}return objects.get(id).fetch(req)}}}};
const video=new Uint8Array(188);video.set([0x47,0x40,0,0x10]);const targeted=[];let catalogs=0,releaseTarget,targetStarted;
const targetGate=new Promise(resolve=>{releaseTarget=resolve}),targetEntered=new Promise(resolve=>{targetStarted=resolve});
globalThis.fetch=async(url)=>{const u=new URL(url);assert.equal(u.origin,'http://ccf.center:8444','all upstream operations remain mocked');
 if(u.pathname==='/player_api.php'){const action=u.searchParams.get('action');if(action==='get_live_streams'){catalogs++;return Response.json([{stream_id:124,name:'Healthy fixture channel'}])}if(action)return Response.json([]);return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}})}
 if(u.pathname.startsWith('/live/')){if(u.pathname.endsWith('/217967.ts')){targeted.push(u.pathname);if(targeted.length===1){targetStarted();await targetGate}return new Response('fixture missing',{status:404})}assert.ok(u.pathname.endsWith('/124.ts'));return new Response(video,{headers:{'content-type':'video/mp2t'}})}
 throw Error('Unexpected mock operation');
};
const origin='https://api.snaptvnow.com',call=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0))};
try{
 await call({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'fixture-owner-password'},'/admin');
 const token=(await call({action:'login',username:'owner',password:'fixture-owner-password'},'/admin')).data.access_token,admin=(action,body={})=>call({action,access_token:token,...body},'/admin');
 assert.equal((await admin('provider-save',{mode:'single',url:'http://ccf.center:8444',username:'fixture-source',password:'fixture-source-password'})).status,200);
 for(const username of ['dieguito2026','untouched'])assert.equal((await admin('save',{create:true,username,password:'fixture-viewer-password',status:'active'})).status,200);
 const customer=(await call({op:'auth',username:'untouched',password:'fixture-viewer-password'})).data.access_token;
 assert.equal((await call({op:'stream_token',access_token:customer,type:'live',id:124,ext:'ts',request_id:'kept',revision:1})).status,200);
 const leases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage),before=[...(await leases.active()).values()].map(l=>l.sid);
 const canary=env.PLAYBACK_SESSIONS.get('__smn_canary_v1'),storage=objects.get('__smn_canary_v1').state.storage;
 const prior={state:'complete',attempts:3,results:[{type:'live',origin:{ok:false},relay:{ok:false}},{type:'series',origin:{ok:true},relay:{ok:true}}]},audit={state:'complete',attempts:1,result:{verdict:'origin_not_found'}};
 await storage.put('owner-comparison-20261024-tcp-relay-v1',prior);await storage.put('owner-live404-audit-v1',audit);await storage.put('owner-comparison-account-20261023-v1','single:fixture-source');
 await storage.put('comparison-sample:live',{type:'live',server:'ccf',id:'999',ext:'ts',until:Date.now()+60000});
 for(const path of ['/canary-run','/targeted-comparison','/canary-comparison-status'])assert.equal((await call({username:'dieguito2026',type:'live',sample:{id:'217967'}},path)).status,403,'no public execution route');
 const healthBefore=await(await worker.fetch(new Request(origin+'/health'),env,ctx)).json();assert.equal(healthBefore.playback_comparison.targetedCase,null);assert.equal(targeted.length,0,'health is read only');
 const probe=async()=>{const r=await canary.fetch('https://private/canary-run',{method:'POST',body:JSON.stringify({username:'dieguito2026',type:'live'})});assert.equal(r.status,200);return r.json()};
 const firstProbe=probe();let timer,result;
 try{await Promise.race([targetEntered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('comparison_not_started')),1000)})]);clearTimeout(timer);result=await Promise.race([firstProbe,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('comparison_delayed_canary_response')),1000)})]);assert.equal(targeted.length,1,'comparison is still blocked while normal response completes')}
 finally{clearTimeout(timer);releaseTarget()}
 await flush();assert.equal(result.ok,true,'targeted failure cannot replace the normal canary result');assert.equal(result.reason,'ok');
 assert.equal(targeted.length,2,'one exact-target origin/relay pair, with no retry or channel substitution');assert.equal(new Set(targeted).size,1,'both legs use the same authorized source');
 assert.deepEqual(comparisonAllocations,[{exclude:[],mediaKey:'live|ccf|217967|ts'}],'targeted allocation never adds historical exclusions or retries preparation');
 assert.deepEqual([...(await leases.active()).values()].map(l=>l.sid),before,'only diagnostic-owned sessions are released');
 assert.deepEqual(await storage.get('owner-comparison-20261024-tcp-relay-v1'),prior);assert.deepEqual(await storage.get('owner-live404-audit-v1'),audit);assert.equal((await storage.get('comparison-sample:live')).id,'999','isolated adapter must not modify existing sample cache');
 const health=await(await worker.fetch(new Request(origin+'/health'),env,ctx)).json(),target=health.playback_comparison.targetedCase;
 assert.equal(target.state,'complete');assert.equal(target.attempts,1);assert.equal(target.result.verdict,'origin_not_found');assert.equal(target.result.origin.httpStatus,404);assert.equal(target.result.relay.httpStatus,404);
 assert.ok(!/217967|dieguito2026|fixture-source|password|https/.test(JSON.stringify(target)));assert.ok(!JSON.stringify([...storage.data]).includes('217967'),'target does not leak into durable sample caches');
 const catalogCount=catalogs;assert.equal((await probe()).ok,true);assert.equal(targeted.length,2,'next tick cannot repeat the case');assert.equal(catalogs,catalogCount,'forced target and repeat tick do not scan additional catalogs');
 objects.set('__smn_canary_v1',new PlaybackSession({storage,waitUntil},env));assert.equal((await probe()).ok,true);assert.equal(targeted.length,2,'recreated object reuses its terminal claim');
 await flush();console.log('PASS: private nonblocking next-tick hook compares only the exact TS target once, preserves canary/audit/cache/customer sessions, ignores historical account exclusions, exposes only redacted read-only health, and survives object recreation.');
}finally{releaseTarget();Date.now=clock;globalThis.fetch=realFetch}

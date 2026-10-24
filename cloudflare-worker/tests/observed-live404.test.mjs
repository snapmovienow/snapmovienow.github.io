import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {failedLive404Sample,recordProviderHealth} from '../src/provider-health.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
const clock=Date.now;let at=clock();Date.now=()=>at;
const realFetch=globalThis.fetch,objects=new Map(),pending=[];
class Store{data=new Map();queue=Promise.resolve();async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k))}async put(k,v){if(typeof k==='object'){for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value));return}this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}}
const env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'ownerprobe',TICKET_SECRET:'observed-404-fixture-secret',ADMIN_SETUP_SECRET:'observed-404-setup-fixture-long-secret'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store(),waitUntil:p=>pending.push(Promise.resolve(p).catch(()=>{}))},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
const video=new Uint8Array(188);video.set([0x47,0x40,0,0x10]);let badCalls=0;
const row=id=>['<a>'+id+'</a>','<a>fixture'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="synthetic-source-password">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=fixture; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:2,data:[1,2].map(row)});
 if(u.pathname==='/player_api.php'){const action=u.searchParams.get('action');if(action==='get_live_streams')return Response.json([{stream_id:123,name:'Missing fixture channel'},{stream_id:124,name:'Healthy fixture channel'}]);if(action)return Response.json([]);return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}})}
 if(u.pathname.startsWith('/live/')){if(u.pathname.endsWith('/123.ts')){badCalls++;return new Response('missing',{status:404})}return new Response(video,{headers:{'content-type':'video/mp2t'}})}
 throw Error('Unexpected fixture operation');
};
const origin='https://api.snaptvnow.com',ctx={waitUntil:p=>pending.push(Promise.resolve(p).catch(()=>{}))};
const call=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0))};
try{
 await call({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'fixture-owner-password'},'/admin');const token=(await call({action:'login',username:'owner',password:'fixture-owner-password'},'/admin')).data.access_token;
 const admin=(action,b={})=>call({action,access_token:token,...b},'/admin');
 await admin('provider-save',{mode:'panel',username:'fixture-panel',password:'fixture-panel-password'});
 for(const username of ['viewer','untouched','ownerprobe'])await admin('save',{create:true,username,password:'fixture-viewer-password',status:'active'});
 const storage=objects.get('__smn_accounts_v1').state.storage,leases=await openLeaseStore(storage);
 const api=await worker.fetch(new Request(origin+'/player_api.php?username=viewer&password=fixture-viewer-password&action=get_live_streams'),env,ctx),list=await api.json();
 const goodId=list.find(r=>r.name.startsWith('Healthy')).stream_id,badId=list.find(r=>r.name.startsWith('Missing')).stream_id;
 const kept=await worker.fetch(new Request(origin+'/live/untouched/fixture-viewer-password/'+goodId+'.ts'),env,ctx);assert.equal(kept.status,200,kept.ok?'':await kept.clone().text());await flush();const activeBefore=[...(await leases.active()).values()].map(l=>l.sid);assert.equal(activeBefore.length,1);
 const failed=await worker.fetch(new Request(origin+'/live/viewer/fixture-viewer-password/'+badId+'.ts'),env,ctx);assert.equal(failed.status,404);assert.equal((await failed.json()).error,'upstream_unavailable');
 const observed=await storage.get('provider-health');assert.ok(Object.values(observed).some(r=>r.httpStatus===404));
 const privateRead=await objects.get('__smn_accounts_v1').fetch(new Request('https://private/accounts/canary-sample',{method:'POST',body:JSON.stringify({username:'ownerprobe',type:'live'})}));const hints=await privateRead.json();assert.equal(hints.failed404.id,'123');assert.equal(hints.sample.id,'124','healthy random sample and failed real channel remain separate');
 const canary=env.PLAYBACK_SESSIONS.get('__smn_canary_v1'),canaryStore=objects.get('__smn_canary_v1').state.storage;
 await canaryStore.put('owner-comparison-20261024-tcp-relay-v1',{state:'complete',attempts:2,results:['live','series'].map(type=>({type,origin:{ok:true},relay:{ok:true}}))});
 at+=40000;
 const probe=async()=>{const r=await canary.fetch('https://private/canary-run',{method:'POST',body:JSON.stringify({username:'ownerprobe',type:'live'})});return r.json()};
 assert.equal((await probe()).ok,true,'normal probe can succeed while the observed customer channel is missing');
 const audit=await canaryStore.get('owner-live404-audit-v1');assert.equal(audit.trigger,'observed_request_404');assert.equal(audit.result.verdict,'origin_not_found');assert.equal(audit.result.origin.httpStatus,404);assert.equal(audit.result.relay.httpStatus,404);
 assert.deepEqual([...(await leases.active()).values()].map(l=>l.sid),activeBefore,'diagnosis preserves the other viewer and releases only its own sessions');
 const count=badCalls;assert.equal((await probe()).ok,true);assert.equal(badCalls,count,'the completed diagnosis never repeats the missing channel');
 const health=await(await worker.fetch(new Request(origin+'/health'),env,ctx)).json();assert.ok(!/synthetic-source-password|ownerprobe|"id":"123"/.test(JSON.stringify(health.playback_comparison)));
 await kept.body.cancel();await flush();
 const pool={syncedAt:at,lines:[{id:'known',server:'ccf'}]},fresh={'channel|live|ccf|88|ts|known':{at,ok:false,httpStatus:404}};
 assert.equal(failedLive404Sample(fresh,pool,at).id,'88');
 for(const rows of [{...fresh,'channel|live|ccf|88|ts|known':{at,ok:false,httpStatus:503}},{'channel|live|ccf|88|m3u8|known':{at,ok:false,httpStatus:404}},{'channel|live|ccf|88|ts|unknown':{at,ok:false,httpStatus:404}},{'channel|live|ccf|88|ts|known':{at:at-900001,ok:false,httpStatus:404}}])assert.equal(failedLive404Sample(rows,pool,at),null);
 const unsafe=recordProviderHealth({},'known','live|ccf|1|ts',false,1,'validation',at,null,null,404);assert.equal(unsafe['account|known'].httpStatus,undefined,'account validation cannot forge a missing media sample');
 console.log('PASS: real Xtream 404 reaches exact-channel owner diagnosis even when normal canary succeeds; source/account checks, bounded single pair, stale/format rejection and customer session isolation.');
}finally{Date.now=clock;globalThis.fetch=realFetch}

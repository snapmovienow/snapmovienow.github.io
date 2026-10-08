import {openLeaseStore} from '../src/lease-store.mjs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker,{PlaybackSession} from '../src/index.js';
// Native Node WebCrypto.
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const objects=new Map(),env={TICKET_SECRET:'test-ticket-secret-never-deployed',ADMIN_SETUP_SECRET:'test-setup-secret-never-deployed-1234567890123456'};env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
let upstreamCalls=0;globalThis.fetch=async(url)=>{upstreamCalls++;const u=new URL(url);if(u.pathname==='/player_api.php'){assert.equal(u.searchParams.get('username'),'service-test');assert.equal(u.searchParams.get('password'),'service-password');const action=u.searchParams.get('action');return Response.json(action==='get_vod_streams'?[{name:'Test movie',stream_id:123}]:action==='get_series'?[{name:'Test series',series_id:456}]:{user_info:{auth:1,status:'Active',max_connections:'3'}})}return new Response('sample',{headers:{'content-type':'video/mp4','content-length':'6'}})};
const root='https://snapmovienow-edge.juancanta89.workers.dev';async function req(b,path=''){const r=await worker.fetch(new Request(root+path,{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'test-ip'},body:JSON.stringify(b)}),env);return {status:r.status,data:await r.json()}}
const admin=(action,data={})=>req({action,...data},'/admin');
assert.equal((await admin('users')).status,401);
assert.equal((await admin('setup',{setupSecret:'wrong',username:'owner',password:'owner-password-test'})).status,403);
assert.equal((await admin('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'})).status,200);
assert.equal((await admin('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'other',password:'owner-password-test'})).status,409);
const a=await admin('login',{username:'owner',password:'owner-password-test'});assert.equal(a.status,200);const at=a.data.access_token;const act=(action,b={})=>admin(action,{access_token:at,...b});
assert.equal((await req({op:'vod',access_token:at})).status,401);
assert.equal((await act('provider-save',{username:'service-test',password:'service-password'})).status,200);
for(let i=0;i<4;i++)assert.equal((await act('save',{create:true,username:'customer'+i,password:'customer-password-test',name:'Test <script>',status:'active'})).status,200);
assert.equal((await act('save',{create:true,username:'customer0',password:'customer-password-test',status:'active'})).status,409);
const list=await act('users');assert.equal(list.data.length,4);assert.ok(!JSON.stringify(list.data).includes('hash'));assert.ok(!JSON.stringify(list.data).includes('password'));
const sessions=[];for(let i=0;i<4;i++){const a=await req({op:'auth',username:'customer'+i,password:'customer-password-test'});assert.equal(a.status,200);assert.equal(a.data.user_info.auth,1);assert.ok(!JSON.stringify(a.data).includes('service-password'));sessions.push(a.data.access_token)}
assert.equal((await req({op:'vod',access_token:sessions[0]})).data[0].name,'Test movie');assert.equal((await req({op:'series',access_token:sessions[0]})).data[0].name,'Test series');assert.equal((await admin('users',{access_token:sessions[0]})).status,401);
const plays=await Promise.all(sessions.map(access_token=>req({op:'stream_token',access_token,type:'movie',id:123})));assert.equal(plays.filter(x=>x.status===200).length,3);assert.equal(plays.filter(x=>x.status===409).length,1);assert.equal(plays.find(x=>x.status===409).data.error,'ccf_capacity');
assert.equal((await worker.fetch(new Request(plays[0].data.url,{method:'HEAD'}),env)).status,200);
assert.equal((await req({op:'playback_heartbeat',access_token:sessions[0],lease_id:plays[0].data.lease_id})).status,200);
assert.equal((await req({op:'playback_release',access_token:sessions[1],lease_id:plays[0].data.lease_id})).status,410);
const playback=(request_id,revision)=>req({op:'stream_token',access_token:sessions[0],type:'movie',id:123,request_id,revision});
const cancel=(request_id,revision)=>req({op:'playback_cancel',access_token:sessions[0],request_id,revision});
await cancel('cancel-before-arrival',100);
const beforeCancelled=upstreamCalls;
assert.equal((await playback('cancel-before-arrival',100)).status,410,'closing before allocation rejects a late request');
assert.equal(upstreamCalls,beforeCancelled,'cancelled preparation does not connect to the provider');
const newer=await playback('newer',101);assert.equal(newer.status,200);
await cancel(plays[0].data.request_id);
assert.equal((await req({op:'playback_heartbeat',access_token:sessions[0],lease_id:newer.data.lease_id,request_id:'newer'})).status,200,'old cleanup cannot release the replacement');
assert.equal((await playback('older',100)).status,410,'out-of-order token preparation cannot supersede a newer revision');
const originalFetch=globalThis.fetch;let signalPrepared,finishPrepared;
const preparing=new Promise(resolve=>signalPrepared=resolve),finish=new Promise(resolve=>finishPrepared=resolve);
globalThis.fetch=async(url,opts)=>{if(new URL(url).pathname.endsWith('/200.m3u8')){signalPrepared();await finish;return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}})}return originalFetch(url,opts)};
const delayed=req({op:'stream_token',access_token:sessions[0],type:'live',id:200,ext:'m3u8',request_id:'delayed',revision:102});
await preparing;await cancel('delayed',102);finishPrepared();
assert.equal((await delayed).status,410,'closing during manifest preparation cannot return a usable late token');
globalThis.fetch=originalFetch;
const leaseStore=objects.get('__smn_accounts_v1').state.storage;
assert.equal([...(await (await openLeaseStore(leaseStore)).active()).values()].filter(x=>x.username==='customer0').length,0,'pending close frees the customer reservation');
const finalPlay=await playback('final',103);assert.equal(finalPlay.status,200);
await cancel('delayed',102);
assert.equal((await worker.fetch(new Request(finalPlay.data.url,{method:'HEAD'}),env)).status,200,'late cancellation preserves new playback');
await cancel('final',103);await cancel('final',103);
assert.equal((await worker.fetch(new Request(finalPlay.data.url,{method:'HEAD'}),env)).status,410,'idempotent explicit close revokes signed resources');
assert.equal((await act('save',{username:'customer0',status:'suspended',create:false})).status,200);
assert.equal((await req({op:'vod',access_token:sessions[0]})).status,401);
assert.equal((await worker.fetch(new Request(plays[0].data.url,{method:'HEAD'}),env)).status,410);
const callsBefore=upstreamCalls;assert.equal((await req({op:'auth',username:'customer0',password:'customer-password-test'})).status,401);assert.equal(upstreamCalls,callsBefore);
assert.equal((await req({op:'stream_token',access_token:sessions[3],type:'series',id:456})).status,200);
await act('save',{username:'customer1',password:'changed-password-test',status:'active',create:false});assert.equal((await req({op:'gnula_catalog',access_token:sessions[1]})).status,401);
assert.equal((await act('delete',{username:'customer2'})).status,200);assert.equal((await req({op:'session_info',access_token:sessions[2]})).status,401);
assert.equal((await req({op:'logout',access_token:sessions[3]})).status,200);assert.equal((await req({op:'vod',access_token:sessions[3]})).status,401);
const s=await req({op:'auth',username:'customer1',password:'changed-password-test'});assert.equal(s.status,200);const state=objects.get('__smn_accounts_v1').state.storage;const user=await state.get('user:customer1');user.expiresAt=Date.now()-100;await state.put('user:customer1',user);assert.equal((await req({op:'session_info',access_token:s.data.access_token})).status,401);
for(const object of objects.values()){const sid=await object.state.storage.get('sid');if(sid&&await object.state.storage.get('identity')){await object.alarm();assert.equal(await state.get('playback:'+sid),undefined,'expired sessions remove playback ownership state')}}
await act('logout');assert.equal((await act('users')).status,401);
console.log('PASS: protected admin setup/login, independent customer auth, provider-only credentials, movie/series catalogs, concurrent 3-slot capacity, stream protection, suspension, password reset, deletion, expiration and logout.');

// At the stored millisecond boundary, every gateway denies access before any
// provider call; this includes cached Xtream authentication and old tickets.
{
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 try {
  const expiresAt=clock+60000;
  const expiryAdmin=(await admin('login',{username:'owner',password:'owner-password-test'})).data.access_token;
  const expiryAct=(action,data)=>admin(action,{access_token:expiryAdmin,...data});
  assert.equal((await expiryAct('save',{create:true,username:'expiryexact',password:'expiry-password-test',status:'active',expiresAt})).status,200);
  const login=await req({op:'auth',username:'expiryexact',password:'expiry-password-test'});assert.equal(login.status,200);
  const token=login.data.access_token;assert.equal(login.data.session_expires_at,expiresAt);assert.equal(login.data.account_expires_at,expiresAt);assert.equal(login.data.server_time,clock);
  const url=root+'/player_api.php?'+new URLSearchParams({username:'expiryexact',password:'expiry-password-test'});
  assert.equal((await worker.fetch(new Request(url),env)).status,200);
  const signed=await req({op:'stream_token',access_token:token,type:'movie',id:123});assert.equal(signed.status,200);
  clock=expiresAt-1;assert.equal((await req({op:'session_info',access_token:token})).status,200);
  clock=expiresAt;const calls=upstreamCalls;
  for(const op of ['session_info','vod','series','live','vod_categories','series_categories','live_categories','gnula_catalog','playback_heartbeat'])assert.equal((await req({op,access_token:token})).status,401,op);
  for(const type of ['movie','series','live'])assert.equal((await req({op:'stream_token',access_token:token,type,id:123})).status,401,type);
  assert.equal((await worker.fetch(new Request(signed.data.url,{method:'HEAD'}),env)).status,410);
  for(const action of ['', 'get_live_categories','get_live_streams','get_vod_streams','get_series'])assert.equal((await worker.fetch(new Request(url+(action?'&action='+action:'')),env)).status,401,action);
  assert.equal((await req({op:'auth',username:'expiryexact',password:'expiry-password-test'})).status,401);
  assert.equal(upstreamCalls,calls,'expired users never reach the provider');
  for(const [id,obj]of objects)if(id!=='__smn_accounts_v1'&&await obj.state.storage.get('identity')?.then(identity=>identity?.username==='expiryexact'))await obj.alarm();
  assert.equal([...(await (await openLeaseStore(leaseStore)).active()).values()].filter(x=>x.username==='expiryexact').length,0,'expiry alarm releases reserved capacity');
 } finally{Date.now=realNow}
}
console.log('PASS: exact account date/time boundary blocks web/Xtream login, all content catalogs, stream tokens, cached authentication and previous tickets; alarm releases capacity.');

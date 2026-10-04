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
const plays=await Promise.all(sessions.map(access_token=>req({op:'stream_token',access_token,type:'movie',id:123})));assert.equal(plays.filter(x=>x.status===200).length,3);assert.equal(plays.filter(x=>x.status===409).length,1);assert.equal(plays[3].data.error,'ccf_capacity');
assert.equal((await worker.fetch(new Request(plays[0].data.url,{method:'HEAD'}),env)).status,200);
assert.equal((await req({op:'playback_heartbeat',access_token:sessions[0],lease_id:plays[0].data.lease_id})).status,200);
assert.equal((await req({op:'playback_release',access_token:sessions[1],lease_id:plays[0].data.lease_id})).status,410);
assert.equal((await act('save',{username:'customer0',status:'suspended',create:false})).status,200);
assert.equal((await req({op:'vod',access_token:sessions[0]})).status,401);
assert.equal((await worker.fetch(new Request(plays[0].data.url,{method:'HEAD'}),env)).status,410);
const callsBefore=upstreamCalls;assert.equal((await req({op:'auth',username:'customer0',password:'customer-password-test'})).status,401);assert.equal(upstreamCalls,callsBefore);
assert.equal((await req({op:'stream_token',access_token:sessions[3],type:'series',id:456})).status,200);
await act('save',{username:'customer1',password:'changed-password-test',status:'active',create:false});assert.equal((await req({op:'gnula_catalog',access_token:sessions[1]})).status,401);
assert.equal((await act('delete',{username:'customer2'})).status,200);assert.equal((await req({op:'session_info',access_token:sessions[2]})).status,401);
assert.equal((await req({op:'logout',access_token:sessions[3]})).status,200);assert.equal((await req({op:'vod',access_token:sessions[3]})).status,401);
const s=await req({op:'auth',username:'customer1',password:'changed-password-test'});assert.equal(s.status,200);const state=objects.get('__smn_accounts_v1').state.storage;const user=await state.get('user:customer1');user.expiresAt=Date.now()-100;await state.put('user:customer1',user);assert.equal((await req({op:'session_info',access_token:s.data.access_token})).status,401);
await act('logout');assert.equal((await act('users')).status,401);
console.log('PASS: protected admin setup/login, independent customer auth, provider-only credentials, movie/series catalogs, concurrent 3-slot capacity, stream protection, suspension, password reset, deletion, expiration and logout.');

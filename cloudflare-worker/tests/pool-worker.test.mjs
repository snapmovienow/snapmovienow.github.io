import {openLeaseStore} from '../src/lease-store.mjs';
import assert from 'node:assert/strict';import worker,{PlaybackSession} from '../src/index.js';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const objects=new Map(),env={TICKET_SECRET:'test-ticket-secret-only',ADMIN_SETUP_SECRET:'setup-test-only-123456789012345678901234567890'};env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const row=id=>['<a>'+id+'</a>','<a>line'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="line-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts)=>{const u=new URL(url);if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID='+((opts.body||'').includes('username=second')?'second':'first')+'; path=/'}});if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:2,data:opts.headers.Cookie?.includes('second')?[row(2),row(3)]:[row(1),row(2)]});if(u.pathname==='/player_api.php'){assert.ok(['line1','line2','line3'].includes(u.searchParams.get('username')));assert.equal(u.searchParams.get('password'),'line-password-test');const action=u.searchParams.get('action');return Response.json(action==='get_vod_streams'?[{stream_id:123,name:'Movie'}]:action==='get_series'?[{series_id:456,name:'Series'}]:{user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}})}return new Response('sample',{headers:{'content-type':'video/mp4'}})};
const origin='https://snapmovienow-edge.juancanta89.workers.dev';const req=async(b,path='')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(b)}),env);return {status:r.status,data:await r.json()}};
await req({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');const login=await req({action:'login',username:'owner',password:'owner-password-test'},'/admin');assert.equal(login.status,200);const admin=(action,b={})=>req({action,access_token:login.data.access_token,...b},'/admin');assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'})).status,200);
const sessions=[];for(let i=0;i<7;i++){assert.equal((await admin('save',{create:true,username:'customer'+i,password:'customer-password-test',status:'active'})).status,200);sessions.push((await req({op:'auth',username:'customer'+i,password:'customer-password-test'})).data.access_token)}
assert.equal((await req({op:'vod',access_token:sessions[0]})).data[0].name,'Movie');assert.equal((await req({op:'series',access_token:sessions[0]})).data[0].name,'Series');const plays=await Promise.all(sessions.map(access_token=>req({op:'stream_token',access_token,type:'movie',id:123})));assert.equal(plays.filter(p=>p.status===200).length,6);assert.equal(plays.filter(p=>p.status===409).length,1);
const succeeded=plays.findIndex(p=>p.status===200),rejected=plays.findIndex(p=>p.status===409);assert.equal((await worker.fetch(new Request(plays[succeeded].data.url,{method:'HEAD'}),env)).status,200);await req({op:'logout',access_token:sessions[succeeded]});assert.equal((await worker.fetch(new Request(plays[succeeded].data.url,{method:'HEAD'}),env)).status,410);assert.equal((await req({op:'stream_token',access_token:sessions[rejected],type:'series',id:456})).status,200);const overview=await admin('overview');assert.equal(overview.data.provider.activeAccounts,2);assert.equal(overview.data.provider.maxConnections,6);assert.ok(!JSON.stringify(overview).includes('password'));
assert.ok([...objects.keys()].some(id=>id.startsWith('__smn_media_v1:')),'media runs in its own per-session relay');
console.log('PASS: panel connection → independent login → movie/series catalogs → encrypted tickets → protected stream; six simultaneous allocations across two accounts, seventh rejected, logout revokes and releases capacity.');

assert.equal((await admin('provider-save',{mode:'panel',username:'second',password:'panel-second-test'})).status,200);
let combined=await admin('overview');assert.equal(combined.data.provider.sourceCount,2);assert.equal(combined.data.provider.activeAccounts,3);assert.equal(combined.data.provider.maxConnections,9);assert.equal(combined.data.connections,6);
const storage=objects.get('__smn_accounts_v1').state.storage;const pool=await storage.get('pool');pool.syncedAt=0;await storage.put('pool',pool);
assert.equal((await req({op:'vod',access_token:sessions[rejected]})).status,200);
combined=await admin('overview');assert.equal(combined.data.provider.activeAccounts,3);assert.equal(combined.data.provider.maxConnections,9);assert.equal(combined.data.connections,6);
console.log('PASS: second reseller adds capacity, overlapping line deduplicated, refresh retains both sources and active playback leases.');
assert.ok(objects.has('__smn_provider_refresh_v1'),'panel refresh executes in a dedicated Durable Object rather than in the video request');

const directory = async body => {
 const result = await env.PLAYBACK_SESSIONS.get('__smn_accounts_v1').fetch('https://private/accounts/pool-sync', {method:'POST',body:JSON.stringify(body)});
 assert.equal(result.status,200);
};
const sources=Object.keys(await storage.get('source-pools'));
await directory({source:sources[0],retain:true});
assert.equal((await storage.get('pool')).lines.length,3);
assert.equal(await (await openLeaseStore(storage)).count(),6,'a transient source outage preserves authorised running streams');
await directory({source:sources[0],lines:[]});
assert.deepEqual((await storage.get('pool')).lines.map(l=>l.id),['2','3']);
assert.ok([...(await (await openLeaseStore(storage)).active()).values()].every(l=>l.provider_id!=='1'),'a confirmed inactive source revokes its accounts immediately');
const retainedPools=await storage.get('source-pools');retainedPools[sources[1]].syncedAt=Date.now()-3600000;await storage.put('source-pools',retainedPools);
await directory({source:sources[1],retain:true});assert.equal((await storage.get('pool')).lines.length,2,'a one-hour panel outage does not erase authorised accounts');
const expiredPools=await storage.get('source-pools');expiredPools[sources[1]].syncedAt=Date.now()-12*3600000-1;await storage.put('source-pools',expiredPools);
await directory({source:sources[1],retain:true});
assert.equal((await storage.get('pool')).lines.length,0); assert.equal(await (await openLeaseStore(storage)).count(),0,'inventory retention expires after twelve hours');
console.log('PASS: transient inventory failure preserves leases; confirmed inactivity revokes them; stale inventory expires after twelve hours.');

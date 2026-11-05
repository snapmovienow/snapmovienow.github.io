import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {PUBLIC_TV_CHANNELS} from '../src/public-tv-channels.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {publicTvFixture} from './public-tv-fixture.mjs';
import {createLocalTvXtream,LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';

class Store{
 constructor(){this.data=new Map([['exclusive:index',{revision:1,ids:[],updatedAt:1}]]);this.queue=Promise.resolve();}
 async get(k){return Array.isArray(k)?new Map(k.filter(key=>this.data.has(key)).map(key=>[key,structuredClone(this.data.get(key))])):structuredClone(this.data.get(k));}
 async put(k,v){if(typeof k==='object')for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value));else this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const channel=PUBLIC_TV_CHANNELS[0],row={...channel,type:'movie',mode:'direct',source:'HEAD TEST',year:null,adult:false,visible:true,usageKind:'channel',episodes:[]};
// The metadata branch never calls prepare/media, even with a valid visible row.
const hooks=createLocalTvXtream({read:async()=>({items:[row]}),prepare:()=>{throw Error('HEAD must not prepare');},media:()=>{throw Error('HEAD must not fetch');}},{},null),auth={user:{permissions:{tv:true,adults:false}}},record={kind:'live',server:LOCAL_TV_SERVER,upstreamId:channel.xtreamId,ext:'m3u8'};
assert.equal((await hooks.play(new Request('https://api.snaptvnow.com/live/fixture/fixture/1.m3u8',{method:'HEAD'}),auth,record)).status,200);

const env={TICKET_SECRET:'local-tv-head-secret-only',ADMIN_SETUP_SECRET:'local-tv-head-setup-only-1234567890'},objects=new Map(),origin='https://api.snaptvnow.com',provider='https://head-provider.example.test';
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))};}};
let providerAllocations=0,sourceCalls=0;
globalThis.fetch=async(value,options={})=>{
 const u=new URL(value);if(u.origin===provider){
  const action=u.searchParams.get('action');if(!action){providerAllocations++;return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});}
  if(action==='get_live_categories')return Response.json([{category_id:'7',category_name:'CANALES-NOVELAS',parent_id:0}]);
  if(['get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series'].includes(action))return Response.json([]);
  throw Error('unexpected provider action');
 }
 sourceCalls++;assert.equal(options.redirect,'manual');const response=publicTvFixture(value);assert.ok(response);return response;
};
const post=async body=>{const r=await worker.fetch(new Request(origin+'/admin',{method:'POST',body:JSON.stringify(body)}),env);assert.equal(r.status,200);return r.json();};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'local-tv-head-owner-fixture'});
const login=await post({action:'login',username:'owner',password:'local-tv-head-owner-fixture'}),admin=(action,body={})=>post({action,access_token:login.access_token,...body});
await admin('provider-save',{mode:'single',url:provider,username:'head-provider-user',password:'head-provider-password'});
const customer={username:'head-viewer',password:'head-viewer-password'};await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:false,series:false,adults:false}});
await admin('exclusive-save',{revision:0,item:row});
const query=new URLSearchParams({...customer,action:'get_live_streams'}),streams=await(await worker.fetch(new Request(origin+'/player_api.php?'+query),env)).json(),stream=streams.find(r=>r.name===channel.name);assert.ok(stream);
const headers={'User-Agent':'Native-HEAD-Test','CF-Connecting-IP':'198.51.100.25'},request=(url,method='GET')=>worker.fetch(new Request(url,{method,headers}),env),store=objects.get('__smn_accounts_v1').state.storage;
const leases=await openLeaseStore(store),active=async()=>[...(await leases.active()).values()].filter(l=>l.uid),capacity=providerAllocations,sourceBefore=sourceCalls;
const firstHead=await request(stream.direct_source,'HEAD');assert.equal(firstHead.status,200);assert.equal(await firstHead.text(),'');assert.match(firstHead.headers.get('Content-Type'),/mpegurl/);assert.equal(firstHead.headers.get('Cache-Control'),'no-store');assert.equal(firstHead.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(sourceCalls,sourceBefore);assert.equal(providerAllocations,capacity);assert.equal((await active()).length,0);
const get=await request(stream.direct_source);assert.equal(get.status,200);const master=await get.text(),video=master.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(video);
const before=await request(video);assert.equal(before.status,200);await before.body?.cancel();
const activeBefore=await active();assert.equal(activeBefore.length,1);
const callsBefore=sourceCalls,allocationsBefore=providerAllocations;
const lateHead=await request(stream.direct_source,'HEAD');assert.equal(lateHead.status,200);assert.equal(await lateHead.text(),'');assert.equal(sourceCalls,callsBefore);assert.equal(providerAllocations,allocationsBefore);assert.deepEqual(await active(),activeBefore,'HEAD preserves the active lease and request identity');
const tsHead=await request(stream.direct_source.replace(/\.m3u8$/,'.ts'),'HEAD');assert.equal(tsHead.status,302);assert.equal(tsHead.headers.get('Location'),stream.direct_source);assert.equal(sourceCalls,callsBefore);assert.equal(providerAllocations,allocationsBefore);assert.deepEqual(await active(),activeBefore);
const after=await request(video);assert.equal(after.status,200,'GET → HEAD must leave the previously signed playlist usable');const playlist=await after.text(),segment=playlist.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(segment);const bytes=await request(segment);assert.equal(bytes.status,200);assert.equal((await bytes.arrayBuffer()).byteLength,2048);
const saved=await store.get('exclusive:item:'+channel.id);await store.put('exclusive:item:'+channel.id,{...saved,visible:false});
let deniedCalls=sourceCalls;assert.equal((await request(stream.direct_source,'HEAD')).status,404);assert.equal((await request(stream.direct_source.replace(/\.m3u8$/,'.ts'),'HEAD')).status,404);assert.equal(sourceCalls,deniedCalls);
await store.put('exclusive:item:'+channel.id,{...saved,page:PUBLIC_TV_CHANNELS[1].page});assert.equal((await request(stream.direct_source,'HEAD')).status,404);assert.equal(sourceCalls,deniedCalls);
await store.put('exclusive:item:'+channel.id,saved);await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:false,movies:true,series:true,adults:false}});
assert.equal((await request(stream.direct_source,'HEAD')).status,403);assert.equal((await request(stream.direct_source.replace(/\.m3u8$/,'.ts'),'HEAD')).status,403);assert.equal(sourceCalls,deniedCalls);
assert.equal((await worker.fetch(new Request(stream.direct_source.replace(customer.password,'wrong-password'),{method:'HEAD',headers}),env)).status,401);assert.equal(sourceCalls,deniedCalls);
console.log('PASS: local TV HEAD reports authorized HLS without prepare, upstream requests or leases; GET → HEAD preserves signed media, TS redirect, hidden/source identity, TV permissions and authentication.');

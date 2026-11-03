import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {PUBLIC_TV_CHANNELS,PUBLIC_TV_FOLDERS,UNIVISION_NY_CHANNEL} from '../src/public-tv-channels.mjs';
import {runPublicTvImport} from '../src/public-tv-import.mjs';
import {runUnivisionNyImport} from '../src/univision-ny-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {readChannelUsage} from '../src/channel-usage.mjs';
import {LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';
import {publicTvFixture} from './public-tv-fixture.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(k){return Array.isArray(k)?new Map(k.filter(key=>this.data.has(key)).map(key=>[key,structuredClone(this.data.get(key))])):structuredClone(this.data.get(k));}
 async put(k,v){if(typeof k==='object')for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value));else this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={TICKET_SECRET:'public-tv-test-secret-only',ADMIN_SETUP_SECRET:'public-tv-test-setup-only-1234567890'},objects=new Map();
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))};}};
const origin='https://api.snaptvnow.com',provider='https://public-tv-provider.example.test',accountId='test-owned-account';
const background=[],ctx={waitUntil(p){background.push(p);}};
const drain=async()=>{for(let n=0;background.length&&n<20;n++)await Promise.allSettled(background.splice(0));};
let failMedia=false,providerAllocations=0,providerCategoryCalls=0,sourceCalls=0;
const providerFolders=PUBLIC_TV_FOLDERS.map((f,index)=>({category_id:String(index+101),category_name:f.aliases.at(-1),parent_id:0}));
const providerRows=PUBLIC_TV_FOLDERS.map((f,index)=>({stream_id:index+1,name:'Existing '+f.key,category_id:String(index+101),stream_icon:''}));
globalThis.fetch=async(value,options={})=>{
 const u=new URL(value);if(u.origin===provider){
  const action=u.searchParams.get('action');
  if(!action){providerAllocations++;return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});}
  if(action==='get_live_categories'){providerCategoryCalls++;return Response.json(providerFolders);}
  if(action==='get_live_streams')return Response.json(providerRows);
  if(['get_vod_categories','get_vod_streams','get_series_categories','get_series'].includes(action))return Response.json([]);
  throw Error('unexpected provider action');
 }
 sourceCalls++;assert.equal(new Headers(options.headers).has('Cookie'),false);
 if(failMedia)return new Response('upstream unavailable',{status:503});
 const r=publicTvFixture(value);assert.ok(r,'unexpected public media request');return r;
};
const post=async(body,path='/admin')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()};};
assert.equal((await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'public-tv-owner-fixture'})).status,200);
const login=await post({action:'login',username:'owner',password:'public-tv-owner-fixture'}),admin=(action,body={})=>post({action,access_token:login.data.access_token,...body});
assert.equal((await admin('provider-save',{mode:'single',url:provider,username:'test-provider-user',password:'test-provider-pass'})).status,200);
const customer={username:'public-tv-viewer',password:'public-tv-password-fixture'};
assert.equal((await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000})).status,200);
const store=objects.get('__smn_accounts_v1').state.storage,user=await store.get('user:'+customer.username);
await store.put('user:'+customer.username,{...user,resellerBridge:{accountId,lineId:'owned-line-1'}});
const api=(action,params={},method='GET')=>{const query=new URLSearchParams({...customer,action,...params});return worker.fetch(new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,headers:{'CF-Connecting-IP':'198.51.100.22','User-Agent':'Public-TV-External-Fixture',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:query}:{})}),env);};
const categoriesBefore=await(await api('get_live_categories')).json(),rowsBefore=await(await api('get_live_streams')).json();
await runPublicTvImport(store,{}, {ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},{probe:media=>inspectCatalogSource(media,{fetcher:globalThis.fetch})});
const categories=await(await api('get_live_categories')).json(),rows=await(await api('get_live_streams')).json(),added=rows.slice(rowsBefore.length);
assert.deepEqual(categories,categoriesBefore,'reuse existing provider folder IDs, names and order without duplicates');
assert.deepEqual(rows.slice(0,rowsBefore.length),rowsBefore,'provider channels and bookmarks stay intact');
assert.equal(added.length,20);assert.equal(new Set(added.map(c=>c.stream_id)).size,20);
assert.deepEqual(await(await api('get_live_streams')).json(),rows,'stable IDs across catalog refreshes');
for(const folder of PUBLIC_TV_FOLDERS){
 const category=categories.find(c=>c.category_name===folder.aliases.at(-1)),expected=rows.filter(c=>c.category_id===category.category_id);
 const filtered=await(await api('get_live_streams',{category_id:category.category_id},'POST')).json();assert.deepEqual(filtered.map(c=>c.stream_id),expected.map(c=>c.stream_id));
 for(const c of PUBLIC_TV_CHANNELS.filter(c=>c.categories.includes(folder.key)))assert.ok(expected.some(r=>r.name===c.name));
}
await runUnivisionNyImport(store,{}, {ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},{probe:media=>inspectCatalogSource(media,{fetcher:globalThis.fetch})});
const expanded=await(await api('get_live_streams')).json(),nyCategories=await(await api('get_live_categories')).json(),nyCategory=nyCategories.find(c=>c.category_name==='LOCAL NEW YORK');
assert.ok(nyCategory);assert.equal(nyCategories.filter(c=>c.category_name==='LOCAL NEW YORK').length,1);
assert.deepEqual(expanded.slice(0,rows.length),rows,'adding WXTV preserves every original provider/public numeric identity');
const ny=expanded.find(c=>c.name===UNIVISION_NY_CHANNEL.name);assert.ok(ny);assert.equal(ny.category_id,nyCategory.category_id);
assert.deepEqual((await(await api('get_live_streams',{category_id:nyCategory.category_id},'POST')).json()).map(c=>c.stream_id),[ny.stream_id]);
rows.push(ny);added.push(ny);assert.deepEqual(await(await api('get_live_streams')).json(),rows);
for(const row of added){
 assert.equal(row.stream_type,'live');assert.equal(row.container_extension,'m3u8');assert.equal(new URL(row.direct_source).origin,origin);assert.ok(!JSON.stringify(row).includes('akamaized.net'));
 const allocations=providerAllocations,response=await worker.fetch(new Request(row.direct_source,{headers:{'CF-Connecting-IP':'198.51.100.22','User-Agent':'Public-TV-External-Fixture'}}),env,ctx);
 assert.equal(response.status,200);const master=await response.text();assert.ok(!master.includes('cloudfront.net'));
 const uris=[...master.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]);
 for(const track of [...uris,master.split('\n').find(s=>s.startsWith('https://'))]){
  const playlist=await worker.fetch(new Request(track),env,ctx);assert.equal(playlist.status,200);const text=await playlist.text();
  const init=text.match(/URI="([^"]+)"/)[1],segment=text.split('\n').find(s=>s.startsWith('https://'));
  for(const resource of [init,segment]){const r=await worker.fetch(new Request(resource),env,ctx);assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,2048);}
 }
 assert.equal(providerAllocations,allocations,'public channels do not consume provider connections');
 await drain();
}
const catalog=(await exclusiveSnapshot(store)).items,usage=await(await readChannelUsage(store,null,{accountId},catalog)).json();
assert.equal(usage.channels.length,21);assert.equal(usage.summary.channelsUsed,21,'actual signed Xtream plays are recorded for every new channel');assert.equal(usage.summary.users,1);assert.ok(usage.rows.every(s=>s.username===customer.username&&s.mediaObserved));
assert.deepEqual(usage.channels.find(c=>c.id===UNIVISION_NY_CHANNEL.id).folders,['LOCAL NEW YORK']);
const foreign=await(await readChannelUsage(store,null,{accountId:'foreign-account'},catalog)).json();assert.equal(foreign.summary.sessions,0);assert.ok(!JSON.stringify(foreign).includes(customer.username));
const first=PUBLIC_TV_CHANNELS[0],saved=await store.get('exclusive:item:'+first.id);await store.put('exclusive:item:'+first.id,{...saved,visible:false});assert.equal((await worker.fetch(new Request(added[0].direct_source),env)).status,404);await store.put('exclusive:item:'+first.id,saved);
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:false,series:false,adults:false}})).status,200);
assert.equal((await(await api('get_live_streams')).json()).length,rows.length);assert.equal((await(await api('get_exclusive_catalog')).json()).items.length,0);
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:false,movies:true,series:true,adults:false}})).status,200);assert.deepEqual(await(await api('get_live_streams')).json(),[]);assert.equal((await worker.fetch(new Request(added[0].direct_source),env)).status,403);
assert.ok(sourceCalls>0);assert.ok(providerCategoryCalls<10,'category mapping reuses retained catalogs rather than fetching once per channel');
console.log('PASS: full Worker public channels plus WXTV in LOCAL NEW YORK, existing-folder merging/filters, signed video/audio/init paths, original stable IDs, scoped usage/first bytes, provider capacity isolation, TV permissions and manual hide revocation.');

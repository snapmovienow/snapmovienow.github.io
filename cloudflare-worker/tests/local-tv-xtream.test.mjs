import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {KANSAS_CHANNELS as OFFICIAL_CHANNELS} from '../src/official-live.mjs';
import {LOCAL_TV_SERVER,visibleLocalTv,localTvXtreamStatus} from '../src/local-tv-xtream.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';

class Store {
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key));}
 async put(key,value){if(typeof key==='object')for(const [k,v]of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const next=this.queue.then(()=>fn(this));this.queue=next.catch(()=>{});return next;}
}
const objects=new Map(),env={TICKET_SECRET:'local-tv-xtream-test-secret',ADMIN_SETUP_SECRET:'local-tv-xtream-setup-only-1234567890'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))};}};
const origin='https://api.snaptvnow.com',provider='https://provider.example.test';
let fallback=false,denyOfficial=false,kakeSlate=false,providerAllocations=0,sourceCalls=0;
const reply=data=>Response.json({header:{code:0},data});
globalThis.fetch=async(value,options={})=>{
 const u=new URL(value),body=options.body?JSON.parse(options.body):null;
 if(u.origin===provider){
  const action=u.searchParams.get('action');
  if(!action){providerAllocations++;return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});}
  if(action==='get_live_categories')return Response.json([{category_id:'7',category_name:fallback?'Original':'CANALES-NOVELAS',parent_id:0},{category_id:'8',category_name:'CANALES-DEPORTES',parent_id:0}]);
  if(action==='get_live_streams')return Response.json([{stream_id:55,name:'Existing provider channel',category_id:'7',stream_icon:''},{stream_id:56,name:'Sports',category_id:'8',stream_icon:''}]);
  if(action==='get_vod_categories'||action==='get_vod_streams'||action==='get_series_categories'||action==='get_series')return Response.json([]);
  throw Error('unexpected provider action');
 }
 sourceCalls++;assert.equal(new Headers(options.headers).has('Cookie'),false);
 if(denyOfficial)return new Response('Forbidden',{status:403});
 const station=u.hostname==='www.kwch.com'?'kwch':u.hostname==='www.wibw.com'?'wibw':u.hostname==='www.kctv5.com'?'kctv':null;
 if(station&&u.pathname==='/livestream/')return new Response(OFFICIAL_CHANNELS.filter(c=>c.station===station).map(c=>'"id":"'+c.contentId+'"').join(' '));
 if(station&&u.pathname.startsWith('/pf/'))return Response.json({access_token:'anonymous-test-access'});
 if(u.hostname==='auth-gw.api.gray.quickplay.com')return reply({token:'anonymous-test-qpat'});
 if(u.hostname==='device-register-service.api.gray.quickplay.com')return reply({secret:btoa('01234567890123456789012345678901')});
 if(u.hostname==='playback-auth-service.api.gray.quickplay.com'){
  const c=OFFICIAL_CHANNELS.find(c=>c.contentId===body.contentId);assert.ok(c);
  return reply({contentUrl:'https://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/index.m3u8',drm:'none',pgmBlackout:false,ssaiEnabled:true,assetKey:'fixture-asset-'+c.id,heartbeatToken:'anonymous-test-heartbeat'});
 }
 if(u.hostname==='www.koamnewsnow.com')return new Response('<source src="https://amg01499-amg01499c3-morganmurphy-us-4207.playouts.now.amagi.tv/playlist/amg01499-morganmurphyfast-koam-morganmurphyus/playlist.m3u8?coppa=0&amp;genre=news">');
 if(u.hostname==='amg01499-amg01499c3-morganmurphy-us-4207.playouts.now.amagi.tv'){if(u.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://amg01499-amg01499c3-morganmurphy-us-4207.playouts.now.amagi.tv/ts-us-e2-n2/beacon/amg01499-morganmurphyfast-koam-morganmurphyus/segment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});}
 if(u.hostname==='www.kake.com'&&u.pathname==='/video/live/')return new Response('<iframe src="https://www.kake.com/tncms/block/3942264"></iframe>');
 if(u.hostname==='www.kake.com'&&u.pathname==='/tncms/block/3942264/')return new Response('<source src="https://townnews.g-mana.live/media/11111111-1111-1111-1111-111111111111/master.m3u8">');
 if(u.hostname==='pubads.g.doubleclick.net')return new Response(null,{status:302,headers:{Location:'https://dai.google.com/linear/'+u.pathname.split('/')[3]+'/master.m3u8'}});
 if(u.hostname==='dai.google.com'){
  const c=OFFICIAL_CHANNELS.find(c=>u.pathname.includes(c.id));assert.ok(c);
  return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/segment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 }
 if(u.hostname==='townnews.g-mana.live')return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n'+(kakeSlate?'https://evrideo.g-mana.online/gmana-assets/slates/8a1b14d7-36b9-4901-b333-e62abebbb973/slate.ts':'https://ssai1.field59.com/kake1/segment.ts')+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.hostname==='live-streaming-mcdn.api.graylive.quickplay.com'||u.hostname==='ssai1.field59.com'||u.hostname==='evrideo.g-mana.online')return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});
 throw Error('unexpected request host');
};
const post=async(body,path='/admin')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()};};
assert.equal((await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-fixture'})).status,200);
const login=await post({action:'login',username:'owner',password:'owner-password-fixture'});
const admin=(action,body={})=>post({action,access_token:login.data.access_token,...body});
assert.equal((await admin('provider-save',{mode:'single',url:provider,username:'provider-user-fixture',password:'provider-pass-fixture'})).status,200);
const customer={username:'local-tv-customer',password:'local-tv-password-fixture'};
assert.equal((await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000})).status,200);
const api=(action,params={},method='GET')=>{const query=new URLSearchParams({...customer,action,...params});return worker.fetch(new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,headers:{'CF-Connecting-IP':'198.51.100.12','User-Agent':'External-Xtream-Fixture',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:query}:{})}),env);};
const stream=(id,ext='m3u8',kind='live')=>worker.fetch(new Request(origin+'/'+kind+'/'+customer.username+'/'+customer.password+'/'+id+'.'+ext,{headers:{'CF-Connecting-IP':'198.51.100.12','User-Agent':'External-Xtream-Fixture'}}),env);
const beforeCategories=await(await api('get_live_categories')).json(),beforeRows=await(await api('get_live_streams')).json();
for(const channel of OFFICIAL_CHANNELS)assert.equal((await admin('exclusive-save',{revision:0,item:{...channel,type:'movie',mode:'gnula',source:'TV LOCAL OFICIAL',year:null,adult:false,visible:true,episodes:[]}})).status,200);
const previousIds=await(await env.PLAYBACK_SESSIONS.get('__smn_xtream_catalog_v1').fetch('https://private/accounts/xtream-register',{method:'POST',body:JSON.stringify({entries:OFFICIAL_CHANNELS.map((c,i)=>({kind:'live',server:LOCAL_TV_SERVER,upstreamId:String(i+1),ext:'m3u8'}))})})).json();
const accountStore=objects.get('__smn_accounts_v1').state.storage;
const rows=await(await api('get_live_streams')).json(),categories=await(await api('get_live_categories')).json();
assert.deepEqual(categories.filter(c=>c.category_name!=='LOCAL KANSAS'),beforeCategories,'keep all provider category identities and their relative order');
assert.deepEqual(categories.map(c=>c.category_name),['CANALES-NOVELAS','LOCAL KANSAS','CANALES-DEPORTES']);
assert.deepEqual(rows.slice(0,2),beforeRows,'provider channels and bookmarks remain unchanged');
const local=rows.slice(2),novelas=categories.find(c=>c.category_name==='CANALES-NOVELAS');
const kansas=categories.find(c=>c.category_name==='LOCAL KANSAS');
assert.deepEqual(local.map(c=>c.stream_id),previousIds,'moving the folder preserves existing channel IDs and favorites');
assert.equal(local.length,8);assert.equal(new Set(local.map(c=>c.stream_id)).size,8);
for(const row of local){assert.equal(row.category_id,kansas.category_id);assert.equal(row.stream_type,'live');assert.equal(row.container_extension,'m3u8');assert.equal(new URL(row.direct_source).origin,origin);assert.ok(!row.direct_source.includes('quickplay'));assert.ok(!JSON.stringify(row).includes('anonymous-test'));}
assert.deepEqual(await(await api('get_live_streams')).json(),rows,'refresh preserves stable numeric stream IDs');
assert.deepEqual((await(await api('get_live_streams',{category_id:novelas.category_id},'POST')).json()).map(r=>r.name),rows.filter(r=>r.category_id===novelas.category_id).map(r=>r.name));
assert.equal((await(await api('get_live_streams',{category_id:novelas.category_id})).json()).length,1,'the eight local channels are removed from novelas');
assert.deepEqual((await(await api('get_live_streams',{category_id:kansas.category_id},'POST')).json()).map(c=>c.stream_id),previousIds,'LOCAL KANSAS contains exactly the same eight channels');
assert.equal((await(await api('get_live_streams',{category_id:categories[2].category_id})).json()).length,1,'locals are not added to other categories');
assert.deepEqual(await(await api('get_live_streams',{category_id:'2147483647'})).json(),[]);
assert.deepEqual(await(await api('get_vod_streams')).json(),[]);
assert.deepEqual(await(await api('get_series')).json(),[]);
assert.deepEqual(await(await api('get_short_epg',{stream_id:local[0].stream_id})).json(),{epg_listings:[]},'do not invent programme schedules');
for(const row of local){
 const allocations=providerAllocations;
 const r=await stream(row.stream_id);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/mpegurl/);
 const text=await r.text();assert.ok(text.startsWith('#EXTM3U'));assert.ok(!text.includes('quickplay'));assert.ok(!text.includes('field59'));
 const child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 assert.ok(child);const segment=await worker.fetch(new Request(child),env);assert.equal(segment.status,200);assert.equal((await segment.arrayBuffer()).byteLength,2048);
 assert.equal(providerAllocations,allocations,'official TV never allocates upstream provider connections');
}
const redirected=await stream(local[0].stream_id,'ts');assert.equal(redirected.status,302);assert.ok(redirected.headers.get('Location').endsWith('.m3u8'));
kakeSlate=true;const slatePlaylist=await(await stream(local[3].stream_id)).text(),slateUrl=slatePlaylist.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(slateUrl);const slateResponse=await worker.fetch(new Request(slateUrl),env);assert.equal(slateResponse.status,200);assert.equal((await slateResponse.arrayBuffer()).byteLength,2048);kakeSlate=false;
assert.equal((await stream(local[0].stream_id,'m3u8','movie')).status,404);
assert.equal((await api('get_live_streams',{password:'wrong-password-fixture'})).status,401);
// TV-only subscribers retain TV access without gaining access to exclusive VOD.
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:false,series:false,adults:false}})).status,200);
assert.equal((await(await api('get_live_streams')).json()).length,10);
assert.equal((await(await api('get_exclusive_catalog')).json()).items.length,0);
assert.equal((await stream(local[0].stream_id)).status,200);
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:false,movies:true,series:true,adults:false}})).status,200);
assert.deepEqual(await(await api('get_live_streams')).json(),[]);assert.equal((await stream(local[0].stream_id)).status,403);
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:true,series:true,adults:false}})).status,200);
const row=await accountStore.get('exclusive:item:'+OFFICIAL_CHANNELS[0].id);
await accountStore.put('exclusive:item:'+row.id,{...row,visible:false});
assert.equal((await(await api('get_live_streams')).json()).length,9);assert.equal((await stream(local[0].stream_id)).status,404);
await accountStore.put('exclusive:item:'+row.id,{...row,page:OFFICIAL_CHANNELS[1].page});
assert.equal((await stream(local[0].stream_id)).status,404,'never swap a fixed channel identity for a different station');
await accountStore.put('exclusive:item:'+row.id,row);
const count=async()=>[...(await(await openLeaseStore(accountStore)).active()).values()].filter(l=>l.uid).length;
const beforeFailure=await count();denyOfficial=true;assert.equal((await stream(local[0].stream_id)).status,502);denyOfficial=false;assert.equal(await count(),beforeFailure,'failed resolution does not acquire a lease');
assert.ok(sourceCalls>0);
// Real account lease accounting: different client sessions share the same cap.
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000})).status,200);
let signed;
for(let device=1;device<=4;device++){
 const response=await worker.fetch(new Request(local[0].direct_source,{headers:{'CF-Connecting-IP':'198.51.100.'+(30+device),'User-Agent':'External-Fixture-'+device}}),env);
 assert.equal(response.status,device<=3?200:409);
 if(device===1)signed=(await response.text()).split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));else await response.body?.cancel();
}
assert.equal(await count(),3);
assert.equal((await admin('save',{...customer,status:'suspended',expiresAt:Date.now()+86400000})).status,200);
assert.equal((await worker.fetch(new Request(signed),env)).status,401,'suspension revokes already signed media');
assert.equal(await count(),0);
assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000})).status,200);
env.CATALOG_MAINTENANCE_ENABLED='true';
const health=await(await worker.fetch(new Request(origin+'/health'),env)).json();
assert.equal(health.catalog_maintenance.localTvXtream.channels.length,8);assert.equal(health.catalog_maintenance.localTvXtream.category,'LOCAL KANSAS');assert.equal(health.catalog_maintenance.localTvXtream.afterCategory,'CANALES-NOVELAS');assert.equal(health.catalog_maintenance.localTvXtream.version,3);
assert.equal(visibleLocalTv({...row,adult:true},{tv:true,adults:false}),false);
assert.equal((await localTvXtreamStatus(new Store())).channels.length,0);
// Standalone category fallback when an upstream panel has no matching folder.
const {createLocalTvXtream}=await import('../src/local-tv-xtream.mjs');
const hooks=createLocalTvXtream({read:async()=>({items:[row]})},{},null),registered=[];
const register=async entries=>entries.map(e=>{registered.push(e);return e.kind==='live_category'?987:988;});
const auth={user:{permissions:{tv:true,adults:false}},username:'fixture',password:'fixture'};
const common={auth,base:origin,register,catalog:async()=>[],adultPolicy:{filter:async(a,r)=>r}};
const fallbackCategories=await hooks.list({...common,action:'get_live_categories',rows:[]});assert.deepEqual(fallbackCategories,[{category_id:'987',category_name:'LOCAL KANSAS',parent_id:0}]);
const duplicated=await hooks.list({...common,action:'get_live_categories',rows:[{category_id:'5',category_name:'Canales Novelas',parent_id:0},fallbackCategories[0],{category_id:'6',category_name:'Sports',parent_id:0}]});assert.deepEqual(duplicated.map(c=>c.category_name),['Canales Novelas','LOCAL KANSAS','Sports'],'insert once below normalized anchor labels');
assert.equal((await hooks.list({...common,action:'get_live_streams',rows:[],categoryId:'987'})).length,1);
assert.equal(registered[0].server,LOCAL_TV_SERVER);
console.log('PASS: full Worker Xtream category merging, stable IDs, GET/POST, all eight signed HLS streams and bytes, provider isolation, TV-only permission, authentication, hidden/changed sources, TS redirect, EPG, failure cleanup and fallback category.');

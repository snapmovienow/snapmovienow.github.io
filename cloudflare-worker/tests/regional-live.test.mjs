import assert from 'node:assert/strict';
import {REGIONAL_CHANNELS,KANSAS_CHANNELS,LOCAL_TV_CHANNELS,isOfficialLivePage,resolveOfficialLive,officialMediaAllowed} from '../src/official-live.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';
import {regionalFixture} from './regional-live-fixture.mjs';
const fetcher=async(value,options={})=>{assert.equal(options.redirect,'manual');assert.equal(new Headers(options.headers).has('Authorization'),false);assert.equal(new Headers(options.headers).has('Cookie'),false);const r=regionalFixture(value,options);assert.ok(r,'unreviewed fixture request');return r;};
assert.deepEqual(LOCAL_TV_CHANNELS.slice(0,8),KANSAS_CHANNELS,'append only: original upstream identities stay fixed');
for(const c of REGIONAL_CHANNELS){
 assert.equal(isOfficialLivePage(c.page),true);const r=await resolveOfficialLive(c.page,{fetcher});assert.equal(r.officialPage,c.page);assert.equal(officialMediaAllowed(c.page,r.url),true);assert.equal(r.officialHeartbeat,undefined);
 assert.deepEqual(await inspectCatalogSource({mode:'gnula',page:c.page},{fetcher}),{ok:true,check:'playlist_and_segment'});
 for(const suffix of ['?redirect=https://127.0.0.1/','#test'])assert.equal(isOfficialLivePage(c.page+suffix),false);
 for(const u of ['https://127.0.0.1/live/segment.ts','https://'+c.mediaHost+'.evil.example/live/video.ts','https://'+c.mediaHost+'/other/segment.ts','https://user:pass@'+c.mediaHost+'/live/a.ts'])assert.equal(officialMediaAllowed(c.page,u),false);
 await assert.rejects(()=>resolveOfficialLive(c.page,{fetcher:async()=>new Response('Forbidden',{status:403})}));
}
const nbc=REGIONAL_CHANNELS.find(c=>c.adapter==='nbcu-fast'),cbs=REGIONAL_CHANNELS.find(c=>c.adapter==='cbs-local'),other=REGIONAL_CHANNELS.find(c=>c.adapter==='cbs-local'&&c!==cbs);
assert.equal(officialMediaAllowed(nbc.page,'https://d2kowtvrzzi7ps.cloudfront.net/11602/88889710/hls/master.m3u8'),false);
assert.equal(officialMediaAllowed(cbs.page,'https://dai.google.com/linear/hls/event/'+other.event+'/master.m3u8'),false);
assert.equal(officialMediaAllowed(cbs.page,'https://dai.google.com/linear/pods/v1/p/'+other.event+'/ad.ts'),false);
assert.equal(officialMediaAllowed(cbs.page,'https://rr1---sn-test.googlevideo.com/videoplayback/ad.ts'),true);
assert.equal(officialMediaAllowed(cbs.page,'https://'+cbs.mediaHost+'/ad/seg/videoplayback/pod/ad.ts'),true);
assert.equal(officialMediaAllowed(cbs.page,'https://'+other.mediaHost+'/ad/seg/videoplayback/pod/ad.ts'),false);
await assert.rejects(()=>resolveOfficialLive(nbc.page,{fetcher:async()=>new Response(JSON.stringify({m3u8_url:'https://private.example.test/live.m3u8'}))}));
assert.equal((await inspectCatalogSource({mode:'gnula',page:nbc.page},{fetcher:async(u,o)=>u.includes('master.m3u8')?new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}}):fetcher(u,o)})).ok,false);
const rows=LOCAL_TV_CHANNELS.map(c=>({...c,type:'movie',source:'TV LOCAL OFICIAL',mode:'gnula',year:null,adult:false,visible:true,profileServer:'exclusive',playbackRevision:1,createdAt:1,episodes:[]})),tickets=new Map();let sequence=0;
const service=createExclusiveService({fetcher,resolveGnula(){throw Error('wrong adapter')},directory:async(env,path,body)=>path==='/exclusive-read'?Response.json({revision:1,items:rows}):path==='/exclusive-item-read'?Response.json(rows.find(r=>r.id===body.id)):Response.json({lease_id:'test-regional-lease'}),sessionCall:async()=>new Response('ok'),ticket:async(env,data)=>{const key='test-regional-ticket-'+(++sequence);tickets.set(key,data);return key;},unticket:async(env,key)=>tickets.get(key),requestConnectionClient:()=>({}),guardXtreamResponse:r=>r});
const permissions={tv:true,movies:false,series:false,adults:false},auth={user:{permissions},session:{sid:'test-regional-session',uid:'test-user',permissions,exp:Date.now()+3600000,xtream:true},username:'fixture',password:'fixture'},hooks=service.liveXtream({},null),registry=new Map(),records=new Map();let number=9000;
const register=async entries=>entries.map(entry=>{const key=entry.kind+':'+entry.upstreamId;if(!registry.has(key))registry.set(key,++number);const id=registry.get(key);records.set(id,entry);return id;});
const before=await register(KANSAS_CHANNELS.map((c,index)=>({kind:'live',server:LOCAL_TV_SERVER,upstreamId:String(index+1),ext:'m3u8'})));
const common={auth,base:'https://api.snaptvnow.com',register};
const provider=[{category_id:'55',category_name:'CANALES-NOVELAS',parent_id:0},{category_id:'56',category_name:'Sports',parent_id:0}];
const folders=await hooks.list({...common,action:'get_live_categories',rows:provider});
assert.deepEqual(folders.map(r=>r.category_name),['CANALES-NOVELAS','LOCAL KANSAS','LOCAL NEW YORK','LOCAL NEW JERSEY','LOCAL CALIFORNIA','Sports']);
assert.deepEqual(folders.filter(r=>!r.category_name.startsWith('LOCAL ')),provider);
const all=await hooks.list({...common,action:'get_live_streams',rows:[]});assert.deepEqual(all.slice(0,8).map(r=>r.stream_id),before);assert.equal(new Set(all.map(r=>r.stream_id)).size,all.length);
assert.deepEqual(await hooks.list({...common,action:'get_live_streams',rows:[]}),all);
const expected=[8,3,3,7];
for(const [i,folder] of folders.slice(1,5).entries()){
 const subset=await hooks.list({...common,action:'get_live_streams',rows:[],categoryId:folder.category_id});assert.equal(subset.length,expected[i]);assert.ok(subset.every(row=>row.category_id===folder.category_id));assert.deepEqual(subset,all.filter(row=>row.category_id===folder.category_id).map((row,index)=>({...row,num:index+1})));
}
assert.deepEqual(await hooks.list({...common,action:'get_live_streams',rows:[],categoryId:'55'}),[]);
const shared=all.filter(r=>r.name.includes('Telemundo Noticias Noreste'));assert.equal(shared.length,2);assert.notEqual(shared[0].stream_id,shared[1].stream_id);
for(const row of all.slice(8)){
 const record=records.get(row.stream_id);let response=await hooks.play(new Request(row.direct_source),auth,record);assert.equal(response.status,200);
 for(let depth=0;depth<3&&/mpegurl/i.test(response.headers.get('Content-Type')||'');depth++){
  const text=await response.text();assert.ok(!text.includes('.cloudfront.net'));assert.ok(!text.includes('.nbcuni.com'));const child=text.split('\n').find(l=>l.startsWith('https://'));assert.ok(child);response=await service.media(new Request(child),{});
 }
 assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,2048);
}
const sharedRow=rows.find(r=>r.name.includes('Telemundo Noticias Noreste'));sharedRow.visible=false;
for(const entry of shared){assert.equal((await hooks.play(new Request(entry.direct_source),auth,records.get(entry.stream_id))).status,404);}
console.log('PASS: regional public players, station/ad scopes, redirects, video/map checks, signed HLS playback, four ordered categories, shared NY/NJ membership, original stable IDs and visibility.');

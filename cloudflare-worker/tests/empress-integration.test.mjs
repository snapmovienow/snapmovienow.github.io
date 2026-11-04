import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {runEmpressImport,empressImportStatus} from '../src/empress-import.mjs';
import {EMPRESS_SERIES_ID,EMPRESS_SERIES_META,EMPRESS_EPISODES} from '../src/empress-catalog.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';

class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key));}
 async put(key,value){if(typeof key==='object')for(const [k,v]of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result;}
}

const origin='https://api.snaptvnow.com',provider='https://empress-provider.example.test';
const customer={username:'empress-viewer',password:'empress-customer-fixture-password'};
const env={TICKET_SECRET:'empress-integration-fixture-only',ADMIN_SETUP_SECRET:'empress-integration-setup-fixture-only'},objects=new Map(),privateCalls=[];
let failAfterAcquire=false,failMediaOnce=false;
env.PLAYBACK_SESSIONS={idFromName:value=>value,get(id){
 if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));
 return {fetch:async(value,options)=>{
  const request=new Request(value,options),path=new URL(request.url).pathname.replace(/^\/accounts(?=\/)/,'');
  const body=request.method==='POST'?await request.clone().json().catch(()=>null):null;
  privateCalls.push({id,path,body});const response=await objects.get(id).fetch(request);
  if(path==='/exclusive-acquire'&&response.ok&&failAfterAcquire){failAfterAcquire=false;failMediaOnce=true;}
  return response;
 }};
}};
const background=[],ctx={waitUntil(promise){background.push(promise);}};
const drain=async()=>{for(let n=0;background.length&&n<20;n++)await Promise.allSettled(background.splice(0));};
const voeIds=['qbx1bmzqqoxm','zhbsadlqzyhb','hcmxykc2a6yu','ifq0dewv8v1u'],cdn='ugc-cdn-caching-integration.cloudwindow-route.com';
const wrapper=n=>'https://nupload.my/watch/'+'A'.repeat(43)+n;
const hash=n=>String(n).padStart(12,'0'),root='https://sv2.ibra.lat/';
const voeEngine=n=>n%2===0?'hls2':'hls2-c';
const payload=(episode,option)=>Uint8Array.from({length:2048},(_,index)=>index===0?0x47:(episode*16+option+index)%256);
const rot13=value=>value.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
const voePlayer=data=>'<script type="application/json">'+JSON.stringify([rot13(btoa(Array.from(btoa(JSON.stringify(data))).reverse().map(c=>String.fromCharCode(c.charCodeAt(0)+3)).join('')))])+'</script>';
const nuPlayer=session=>{
 const offset=1406836,list=Array.from(root,c=>btoa('Ab'+(c.charCodeAt(0)+offset)+'Cd'));
 return 'var encoded='+JSON.stringify(list)+'; var source="";encoded.forEach(function publicPlayer(value) { source += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,\'\')) - '+offset+'); });var sesz="'+session+'";';
};
const master=prefix=>'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Original",URI="'+prefix+'audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,AUDIO="audio"\n'+prefix+'video.m3u8\n';
const variant=track=>'#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXT-X-KEY:METHOD=AES-128,URI="key.key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:7,\n'+track+'0.'+(track==='audio'?'aac':'ts')+'\n#EXT-X-ENDLIST\n';
let generation=0,providerAllocations=0,providerDetails=0,failPage=false,playing=false,expectedChoice='';
const sessions=new Map(),sourceCalls=[],probes=[];
let accountStore;
const leases=async()=>[...(await(await openLeaseStore(accountStore)).active()).values()];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(value,options={})=>{
 const url=new URL(value),headers=new Headers(options.headers),action=url.searchParams.get('action');
 if(url.origin===provider){
  if(!action){providerAllocations++;return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});}
  if(action==='get_series_categories')return Response.json([{category_id:'44',category_name:'SERIES-DISNEY',parent_id:0},{category_id:'45',category_name:'SERIES-NETFLIX',parent_id:0}]);
  if(action==='get_series')return Response.json([{series_id:12,name:'Existing Disney series',category_id:'44',cover:''}]);
  if(action==='get_series_info'){providerDetails++;throw Error('owned series must not request provider details');}
  if(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams'].includes(action))return Response.json([]);
  throw Error('unexpected provider action');
 }
 assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);
 for(const name of ['authorization','x-authorization','cookie'])assert.equal(headers.has(name),false,'public player requests never contain account secrets');
 assert.ok(!url.href.includes(customer.username)&&!url.href.includes(customer.password));
 for(const [,value]of headers)assert.ok(!value.includes(customer.username)&&!value.includes(customer.password));
 sourceCalls.push({url:url.href,method:options.method||'GET',range:headers.get('range')});
 const peli=url.hostname==='pelisflix200.rest'?url.pathname.match(/la-emperatriz-divorciada-1x([1-4])\/$/):null;
 if(peli){
  if(failPage)return new Response('unavailable',{status:503});
  return new Response('<h1>Ver La emperatriz divorciada Episodio '+peli[1]+' Temporada 1</h1><div data-url="'+btoa(wrapper(Number(peli[1])))+'"><span>CASTELLANO</span></div>');
 }
 if(url.hostname==='nupload.my'){
  const n=Number(url.pathname.at(-1));assert.equal(headers.get('referer'),EMPRESS_EPISODES[n-1].page);assert.equal(headers.has('origin'),false);
  const session='AnonymousIntegrationPlayerSession'+String(++generation).padStart(8,'0');sessions.set(session,n);return new Response(nuPlayer(session));
 }
 const tudu=url.hostname==='tudorama.com'?url.pathname.match(/the-remarried-empress-s1x([1-4])\/$/):null;
 if(tudu)return new Response('<h1>La emperatriz divorciada</h1><a href="https://cdn.tudorama.com/sub/download-6.php?id='+voeIds[Number(tudu[1])-1]+'">VOE</a>');
 if(url.hostname==='voe.sx')return new Response('window.location.href="https://shannoncoldalready.com'+url.pathname+'";');
 if(url.hostname==='shannoncoldalready.com'){
  const n=voeIds.indexOf(url.pathname.slice(1))+1;assert.ok(n);
  return new Response(voePlayer({source:'https://'+cdn+'/engine/'+voeEngine(n)+'/01/18734/'+voeIds[n-1]+'_,n,.urlset/master.m3u8?signature=fixture'+(++generation),title:'LED 0'+n+' SubEsp [Fixture].mp4',default_captions_language:'es',audio_languages:[{countryCode:'ko',language:'Korean'}]}));
 }
 let episode,option,prefix;
 if(url.hostname==='sv2.ibra.lat'){
  option=1;
  if(url.pathname==='/'){
   episode=sessions.get(url.searchParams.get('s'));assert.ok(episode);assert.equal(headers.get('referer'),wrapper(episode));assert.equal(headers.get('origin'),'https://nupload.my');
   return new Response(null,{status:301,headers:{location:'/da/'+(167+episode).toString(16)+'/'+hash(episode)+'.m3u8'}});
  }
  const redirected=url.pathname.match(/^\/da\/([a-f0-9]{2})\//);episode=redirected?parseInt(redirected[1],16)-167:Number(url.pathname.match(/^\/(?:st1\/)?files\/(\d+)\//)?.[1]);assert.ok(episode>=1&&episode<=4);prefix=(episode%2===0?'/st1':'')+'/files/'+episode+'/'+hash(episode)+'/';
  assert.equal(headers.get('referer'),wrapper(episode));assert.equal(headers.get('origin'),'https://nupload.my');
 }else if(url.hostname===cdn){
  option=2;episode=voeIds.findIndex(id=>url.pathname.includes('/'+id+'_'))+1;assert.ok(episode);prefix='/engine/'+voeEngine(episode)+'/01/18734/'+voeIds[episode-1]+'_,n,.urlset/';
  assert.equal(headers.has('origin'),false);assert.equal(headers.has('referer'),false);
 }else throw Error('unreviewed fixture destination');
 if(failMediaOnce){failMediaOnce=false;return new Response('unavailable',{status:503});}
 if(url.pathname.endsWith('.m3u8')){
  const text=url.pathname.endsWith('/video.m3u8')?variant('video'):url.pathname.endsWith('/audio.m3u8')?variant('audio'):master(prefix);
  return new Response(options.method==='HEAD'?null:text,{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 }
 // Public HLS segments can reject a synthetic Range even though the player's
 // normal GET succeeds. This applies only to the pre-publication probe.
 if(!playing&&headers.has('range'))return new Response('partial probe forbidden',{status:403});
 if(playing){
  const active=await leases();assert.equal(active.length,1);assert.equal(active[0].exclusiveId,expectedChoice);assert.equal(active[0].exclusiveParentId,EMPRESS_SERIES_ID);assert.equal(active[0].provider_id,undefined);
 }
 const bytes=payload(episode,option),range=headers.get('range'),match=range?.match(/^bytes=(\d+)-(\d+)$/),from=match?Number(match[1]):0,to=match?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;
 assert.ok(!range||match,'test resource ranges use one exact closed interval');
 const content=bytes.slice(from,to+1),type=url.pathname.endsWith('.ts')?'video/mp2t':url.pathname.endsWith('.aac')?'audio/aac':url.pathname.endsWith('.mp4')?'video/mp4':'application/octet-stream';
 return new Response(options.method==='HEAD'?null:content,{status:range?206:200,headers:{'content-type':type,'content-length':String(content.length),'accept-ranges':'bytes',...(range?{'content-range':'bytes '+from+'-'+to+'/'+bytes.length}:{})}});
};

const post=async(body,path='/admin')=>{const response=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:response.status,data:await response.json()};};
const nativeHeaders={'CF-Connecting-IP':'198.51.100.78','User-Agent':'Empress-External-Xtream-Fixture'};
const api=(action,params={},method='GET')=>{
 const query=new URLSearchParams({...customer,action,...params});return worker.fetch(new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,headers:{...nativeHeaders,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:query}:{})}),env,ctx);
};
const stream=(entry,options={})=>worker.fetch(new Request(entry.direct_source,{...options,headers:{...nativeHeaders,...options.headers}}),env,ctx);
const publicOnly=value=>{
 const text=JSON.stringify(value);for(const forbidden of ['pelisflix200.rest','nupload.my','ibra.lat','cloudwindow-route.com','https://voe.sx/','tudorama.com/ver/','empressContext','empressPage','preferredEmbed','signature=','AnonymousIntegrationPlayerSession'])assert.ok(!text.includes(forbidden),'private player details excluded: '+forbidden);
};
try{
 assert.equal((await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'empress-owner-fixture-password'})).status,200);
 const login=await post({action:'login',username:'owner',password:'empress-owner-fixture-password'}),admin=(action,body={})=>post({action,access_token:login.data.access_token,...body});
 assert.equal(login.status,200);assert.equal((await admin('provider-save',{mode:'single',url:provider,username:'fixture-provider',password:'fixture-provider-password'})).status,200);
 assert.equal((await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{series:true,tv:false,movies:false,adults:false}})).status,200);
 accountStore=objects.get('__smn_accounts_v1').state.storage;
 const beforeCategories=await(await api('get_series_categories')).json(),beforeRows=await(await api('get_series')).json(),beforeImport=sourceCalls.length;
 await runEmpressImport(accountStore,{}, {ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},{probe:async media=>{probes.push(media.page);return inspectCatalogSource(media,{fetcher:globalThis.fetch});}});
 const report=await empressImportStatus(accountStore);assert.equal(report.state,'completed');assert.equal(report.results.length,8);assert.ok(report.results.every(result=>result.status==='added'&&result.check==='playlist_and_segment'));
 assert.equal(probes.length,8);assert.equal(new Set(probes).size,8);assert.ok(sourceCalls.length>beforeImport);assert.ok(sourceCalls.slice(beforeImport).every(call=>!call.range),'HLS publication checks use the same GET as the player');
 const saved=(await exclusiveSnapshot(accountStore)).items.find(row=>row.id===EMPRESS_SERIES_ID);assert.ok(saved);assert.equal(saved.episodes.length,4);assert.ok(saved.episodes.every(ep=>ep.alternatives.length===1));
 const categories=await(await api('get_series_categories',{},'POST')).json(),rows=await(await api('get_series')).json(),disney=categories.find(row=>row.category_name==='SERIES-DISNEY');
 assert.deepEqual(categories,beforeCategories,'the existing SERIES-DISNEY folder keeps its identity and order');assert.equal(categories.filter(row=>row.category_name==='SERIES-DISNEY').length,1);
 assert.deepEqual(rows.slice(0,beforeRows.length),beforeRows);assert.equal(rows.length,beforeRows.length+1);assert.equal(rows.filter(row=>row.smn_profile?.id===EMPRESS_SERIES_ID).length,1);
 const owned=rows.find(row=>row.smn_profile?.id===EMPRESS_SERIES_ID);assert.equal(owned.category_id,disney.category_id);assert.equal(owned.cover,EMPRESS_SERIES_META.poster);assert.equal(owned.plot,EMPRESS_SERIES_META.plot);
 assert.deepEqual(await(await api('get_series',{},'POST')).json(),rows);assert.deepEqual(await(await api('get_series',{category_id:disney.category_id},'POST')).json(),rows);
 const netflix=categories.find(row=>row.category_name==='SERIES-NETFLIX');assert.deepEqual(await(await api('get_series',{category_id:netflix.category_id},'POST')).json(),[]);
 const details=await(await api('get_series_info',{series_id:owned.series_id},'POST')).json();assert.equal(details.info.name,EMPRESS_SERIES_META.name);assert.equal(details.info.cover,EMPRESS_SERIES_META.poster);assert.equal(details.info.plot,EMPRESS_SERIES_META.plot);assert.equal(details.info.category_id,disney.category_id);
 assert.deepEqual(Object.keys(details.episodes),['1']);assert.equal(details.seasons.length,1);assert.equal(details.seasons[0].name,'Temporada 1');assert.equal(details.seasons[0].episode_count,8);
 const options=details.episodes['1'];assert.equal(options.length,8);assert.equal(new Set(options.map(ep=>ep.id)).size,8);assert.deepEqual(options.map(ep=>ep.episode_num),[1,1,2,2,3,3,4,4]);
 assert.deepEqual((await(await api('get_series_info',{series_id:owned.series_id})).json()).episodes,details.episodes,'GET/POST and repeated detail reads preserve all eight native identifiers');
 for(const [index,entry]of options.entries()){
  const number=Math.floor(index/2)+1;assert.equal(entry.season,1);assert.equal(entry.custom_sid,'');assert.equal(entry.container_extension,'m3u8');assert.equal(new URL(entry.direct_source).origin,origin);
  assert.equal(entry.title,'E'+String(number).padStart(2,'0')+' · Opción '+(index%2?2:1)+' · '+(index%2?'Coreano subtitulado':'Español'));assert.ok(entry.info.movie_image&&entry.info.plot&&entry.info.duration_secs>0);assert.equal(entry.smn_profile.episodeId,'empress-2026-s1e'+number+(index%2?'-subes':'-es'));
 }
 publicOnly(rows);publicOnly(details);
 const ownApi=await(await api('get_exclusive_series_info',{series_id:EMPRESS_SERIES_ID})).json();assert.equal(ownApi.episodes['1'].length,4);assert.ok(ownApi.episodes['1'].every(ep=>ep.alternatives.length===1));publicOnly(ownApi);
 assert.deepEqual(await(await api('get_live_streams')).json(),[]);assert.deepEqual(await(await api('get_vod_streams')).json(),[]);
 const allocations=providerAllocations,catalogNetwork=sourceCalls.length;await api('get_series_info',{series_id:owned.series_id});assert.equal(sourceCalls.length,catalogNetwork,'opening the series card does not resolve playback URLs');
 let signedVideo;
 for(const [index,entry]of options.entries()){
  expectedChoice=entry.smn_profile.episodeId;playing=true;const starts=privateCalls.filter(call=>call.path==='/exclusive-acquire').length;
  const response=await stream(entry);assert.equal(response.status,200);const playlist=await response.text();assert.ok(response.headers.get('X-SNAP-Playback-Quality'));assert.ok(playlist.startsWith('#EXTM3U'));publicOnly(playlist);
  const video=playlist.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?')),audio=playlist.match(/URI="([^"]+)"/)[1];assert.ok(video&&audio);signedVideo=video;
  for(const track of [video,audio]){
   const result=await worker.fetch(new Request(track),env,ctx);assert.equal(result.status,200);const text=await result.text();publicOnly(text);
   const resources=[...text.matchAll(/URI="([^"]+)"/g)].map(match=>match[1]).concat(text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?')));assert.equal(resources.length,3);
   for(const resource of resources){
    const bytes=await worker.fetch(new Request(resource,{headers:{Range:'bytes=4-11'}}),env,ctx);assert.equal(bytes.status,206);assert.equal(bytes.headers.get('content-range'),'bytes 4-11/2048');assert.equal(bytes.headers.get('content-length'),'8');assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()),payload(Math.floor(index/2)+1,index%2+1).slice(4,12));
   }
  }
  assert.equal(privateCalls.filter(call=>call.path==='/exclusive-acquire').length,starts+1);assert.equal(providerAllocations,allocations,'each source uses the customer exclusive lease without allocating a CCF account');await drain();
 }
 playing=false;assert.equal(providerDetails,0);assert.equal((await leases()).length,1);assert.deepEqual(privateCalls.filter(call=>call.path==='/exclusive-acquire').map(call=>call.body.exclusiveId),options.map(entry=>entry.smn_profile.episodeId));
 assert.ok(privateCalls.some(call=>call.path==='/exclusive-item-read'));assert.ok(privateCalls.some(call=>call.path==='/heartbeat'));
 assert.equal((await stream({...options[0],direct_source:options[0].direct_source.replace('.m3u8','.mp4')})).status,400);
 assert.equal((await api('get_series',{password:'wrong-fixture-password'})).status,401);
 const beforeFailure=(await leases()).length;failPage=true;assert.equal((await stream(options[0])).status,502);failPage=false;assert.equal((await leases()).length,beforeFailure,'failed public-page resolution does not acquire another connection');
 failAfterAcquire=true;assert.equal((await stream(options[0])).status,502);assert.equal((await leases()).length,0,'upstream media failure after acquisition releases its new lease');
 const deviceHeaders=device=>({'CF-Connecting-IP':'198.51.100.'+(80+device),'User-Agent':'Empress-Capacity-Fixture-'+device});
 for(let device=1;device<=4;device++){
  const response=await worker.fetch(new Request(options[1].direct_source,{headers:deviceHeaders(device)}),env,ctx);assert.equal(response.status,device<=3?200:409,'owned source choices share the existing three-device account limit');await response.body?.cancel();
 }
 assert.equal((await leases()).length,3);
 for(let device=1;device<=3;device++){
  const response=await worker.fetch(new Request(options[1].direct_source,{method:'HEAD',headers:deviceHeaders(device)}),env,ctx);assert.equal(response.status,200);assert.equal((await leases()).length,3-device,'a completed HEAD check releases only its own device lease');
 }
 assert.equal(providerAllocations,allocations,'capacity checks for owned series still allocate no provider connection');
 const last=await stream(options[0]);assert.equal(last.status,200);const lastText=await last.text(),resource=lastText.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(resource);
 const hidden=await admin('exclusive-save',{item:{...saved,visible:false},revision:saved.revision});assert.equal(hidden.status,200);assert.equal((await worker.fetch(new Request(resource),env,ctx)).status,410,'owner hide invalidates already signed HLS resources');assert.equal((await stream(options[0])).status,404);assert.equal((await api('get_series_info',{series_id:owned.series_id})).status,404);assert.equal((await leases()).length,0);
 assert.deepEqual(await(await api('get_series')).json(),beforeRows,'manual hide removes only this card');
 assert.equal((await admin('exclusive-save',{item:saved,revision:hidden.data.item.revision})).status,200);
 assert.equal((await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{series:false,movies:true,tv:true,adults:false}})).status,200);
 assert.deepEqual(await(await api('get_series')).json(),[]);assert.equal((await api('get_series_info',{series_id:owned.series_id})).status,403);assert.equal((await stream(options[0])).status,403);assert.equal((await worker.fetch(new Request(signedVideo),env,ctx)).status,401,'permission edits revoke older viewer sessions');
 await drain();
 console.log('PASS: real Worker all-eight-player media gate, existing Disney folder, one four-episode series/eight explicit choices, GET/POST/stable metadata, actual HLS/audio/init/key/Range bytes, current parent authorization and private leases, series-only permissions, source privacy, owner-hide revocation and failed-start cleanup without provider allocation.');
}finally{globalThis.fetch=originalFetch;}

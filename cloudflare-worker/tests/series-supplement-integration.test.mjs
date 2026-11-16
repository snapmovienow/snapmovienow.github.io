import assert from 'node:assert/strict';
import test from 'node:test';
import {createXtreamBridge,guardXtreamResponse} from '../src/xtream-bridge.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {makeLqsaSupplement,LQSA_SUPPLEMENT_ID} from '../src/series-supplement.mjs';
import {encodeCatalog} from '../src/catalog-cache.mjs';
import {fingerprint} from '../src/provider-catalog.mjs';
import {createResellerBridge} from '../src/reseller-bridge.mjs';
import {readSeriesUsage} from '../src/series-usage.mjs';

const origin='https://api.fixture.test',customer={username:'supplement-client',password:'fixture-customer-password'};
const reference={server:'ccf',seriesId:'1245'};
const providerDetails=()=>({info:{name:'La que se avecina',series_id:1245,category_id:'77',cover:'https://images.fixture.test/original.jpg',plot:'Provider description'},
 seasons:[{id:96,season_number:16,name:'Temporada 16',episode_count:1},{id:97,season_number:17,name:'Temporada 17',episode_count:2}],
 episodes:{'16':[{id:'100',season:16,episode_num:1,title:'Keep old season',container_extension:'mkv'}],
 '17':[{id:'201',season:17,episode_num:1,title:'Provider E1',container_extension:'mkv'},{id:'204',season:17,episode_num:4,title:'Keep E4',container_extension:'mkv'}]},extra:'Retain this'});

async function fixture(){
 const env={TICKET_SECRET:'supplement-integration-fixture-secret',PLAYBACK_SESSIONS:{}},data=providerDetails();
 const state={row:{...makeLqsaSupplement({...reference,name:'La que se avecina'}),profileServer:'exclusive',createdAt:1794800000000,revision:1,playbackRevision:1},
  user:{id:'fixture-user',username:customer.username,version:1,expiresAt:Date.now()+86400000,permissions:{series:true,movies:true,tv:true,adults:true}},
  records:new Map(),keys:new Map(),tickets:new Map(),allocations:[],releases:[],media:[],providerPlays:[],adultParent:false,details:data};
 const providers=[{source:'single',origin:'https://private-provider.fixture.test',url:'https://private-provider.fixture.test',encrypted:'fixture-encrypted-provider'}];
 const scope=await fingerprint(env.TICKET_SECRET,JSON.stringify(providers.map(provider=>[provider.source,provider.origin,provider.url,provider.encrypted]))),cache=new Map();
 const add=async(action,server,params,value)=>cache.set(await fingerprint(env.TICKET_SECRET,JSON.stringify([scope,action,server||'',params])),value);
 const list=[{series_id:1245,name:'La que se avecina',category_id:'77',cover:data.info.cover,_server:'ccf'},{series_id:500,name:'Other series',category_id:'77',_server:'ccf'}];
 await add('get_series','',{},list);await add('get_series','ccf',{},list);
 const categories=[{category_id:'77',category_name:'Series España',_server:'ccf'}];
 await add('get_series_categories','',{},categories);await add('get_series_categories','ccf',{},categories);
 await add('get_series_info','ccf',{series_id:'1245'},data);
 const response=(value,status=200)=>Response.json(value,{status});
 const directory=async(_,path,body={})=>{
  if(path==='/providers')return response(providers);
  if(path==='/xtream-config')return response({enabled:true,version:1});
  if(path==='/xtream-login')return body.username===customer.username&&body.password===customer.password?response(state.user):response({error:'invalid_credentials'},401);
  if(path==='/xtream-count')return response({connections:0});
  if(path==='/exclusive-read')return response({revision:1,items:state.row?[state.row]:[]});
  if(path==='/exclusive-item-read')return state.row&&body.id===state.row.id?response(state.row):response({error:'not_found'},404);
  if(path==='/playback-begin')return response({ok:true});
  if(path==='/exclusive-acquire'){state.allocations.push(structuredClone(body));return response({lease_id:'fixture-lease'});}
  if(path==='/heartbeat')return response({ok:true});
  if(path==='/release'){state.releases.push(structuredClone(body));return response({ok:true});}
  if(path==='/channel-usage-observe')return response({ok:true});
  throw Error('unexpected private route '+path);
 };
 let nextId=1000,nextTicket=0;
 const registry=async(_,path,body={})=>{
  if(path==='/xtream-register')return response(body.entries.map(entry=>{
   const key=entry.kind+'|'+entry.server+'|'+entry.upstreamId;if(!state.keys.has(key)){const id=String(++nextId);state.keys.set(key,id);state.records.set(id,structuredClone(entry));}
   const id=state.keys.get(key);state.records.set(id,{...state.records.get(id),...structuredClone(entry)});return Number(id);
  }));
  if(path==='/xtream-resolve')return response(state.records.get(String(body.id))||null);
  if(path==='/xtream-cache-get'){
   if(!cache.has(body.key))return new Response(null,{status:404});
   return new Response(await encodeCatalog(cache.get(body.key)),{headers:{'x-catalog-saved-at':String(Date.now())}});
  }
  if(path==='/xtream-cache-inspect')return response({found:body.server==='ccf'&&['1245','500'].includes(String(body.id)),adult:state.adultParent});
  if(path==='/xtream-cache-put')throw Error('fresh fixture caches must never refresh from a provider');
  throw Error('unexpected registry route '+path);
 };
 const sessionCall=async(_,sid,path,body={})=>response(path==='/ensure'?{exp:body.exp}:{ok:true});
 const ticket=async(_,value)=>{const token='fixture-ticket-'+(++nextTicket);state.tickets.set(token,structuredClone(value));return token;};
 const unticket=async(_,token)=>state.tickets.get(token);
 const fetcher=async(url,options)=>{
  const target=new URL(url);assert.equal(target.hostname,'ia600409.us.archive.org');assert.match(target.pathname,/\/170[123]\.mp4$/);
  const range=new Headers(options.headers).get('range');state.media.push({path:target.pathname,range,method:options.method});
  const bytes=new Uint8Array(16);bytes.set(new TextEncoder().encode('ftyp'),4);
  return new Response(options.method==='HEAD'?null:bytes,{status:206,headers:{'content-type':'video/mp4','content-length':'16','content-range':'bytes 0-15/100000','accept-ranges':'bytes'}});
 };
 const exclusives=createExclusiveService({directory,sessionCall,ticket,unticket,fetcher,requestConnectionClient:()=>({}),resolveGnula:async()=>{throw Error('no webpage resolution');},guardXtreamResponse});
 const bridge=createXtreamBridge({directory,registry,sessionCall,ticket,unticket,exclusives,json:response,
  managedPlayback:async(_,session)=>({r:response({lease_id:'provider-lease'}),credentials:{origin:providers[0].origin,username:'fixture-upstream',password:'fixture-upstream-password'}}),
  serverStream:async(request,_,url)=>{state.providerPlays.push({request,url:String(url)});return new Response('provider-video',{headers:{'content-type':'video/mp4'}});}});
 const call=request=>bridge(request,env);
 const api=(action,params={},method='GET')=>{
  const query=new URLSearchParams({...customer,action,...params});
  return call(new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,headers:method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{},...(method==='POST'?{body:query}:{})}));
 };
 const play=(episode,init={})=>call(new Request(episode.direct_source,{headers:{Range:'bytes=0-15'},...init}));
 return {state,api,play,exclusives,env,call};
}

test('real Xtream bridge keeps one provider folder and root/category IDs while merging only T17E1–3',async()=>{
 const {state,api,exclusives,env}=await fixture(),backing=state.row;state.row=null;
 const originalList=await(await api('get_series')).json(),root=originalList.find(row=>row.name==='La que se avecina');
 const before=await(await api('get_series_info',{series_id:root.series_id})).json();state.row=backing;
 assert.deepEqual(await(await api('get_series')).json(),originalList,'no new series root or category is added');
 const after=await(await api('get_series_info',{series_id:root.series_id},'POST')).json();
 assert.deepEqual(after.info,before.info);assert.equal(after.extra,'Retain this');assert.deepEqual(after.episodes['16'],before.episodes['16']);
 assert.deepEqual(after.episodes['17'].map(episode=>episode.episode_num),[1,2,3,4]);
 assert.deepEqual(after.episodes['17'][3],before.episodes['17'][1],'provider E4 keeps its old public ID and route');
 assert.equal(after.seasons.find(season=>season.season_number===17).id,97);assert.equal(after.seasons.find(season=>season.season_number===17).episode_count,4);
 assert.deepEqual(after.episodes['17'].slice(0,3).map(episode=>episode.smn_profile.id),['1245','1245','1245']);
 assert.ok(after.episodes['17'].slice(0,3).every(episode=>episode.smn_profile.server==='ccf'&&episode.container_extension==='mp4'&&episode.custom_sid===''));
 assert.deepEqual(await exclusives.catalog(env,state.user.permissions,origin),{revision:1,items:[]},'the backing row is absent from Contenido propio');
 assert.ok(!JSON.stringify(after).includes('archive.org'));assert.ok(!JSON.stringify(after).includes(LQSA_SUPPLEMENT_ID));
 assert.deepEqual((await(await api('get_series_info',{series_id:root.series_id})).json()).episodes,after.episodes,'refresh reuses the same public episode IDs');
});

test('all three mapped episodes use the local authenticated media relay; other episodes keep their provider route',async()=>{
 const {state,api,play}=await fixture(),root=(await(await api('get_series')).json()).find(row=>row.name==='La que se avecina');
 const data=await(await api('get_series_info',{series_id:root.series_id})).json();
 for(const episode of data.episodes['17'].slice(0,3)){const result=await play(episode);assert.equal(result.status,206);assert.equal((await result.arrayBuffer()).byteLength,16);}
 assert.equal(state.providerPlays.length,0);assert.deepEqual(state.media.map(media=>media.path.split('/').at(-1)),['1701.mp4','1702.mp4','1703.mp4']);
 assert.deepEqual(state.allocations.map(allocation=>allocation.exclusiveId),['lqsa-t17-e1','lqsa-t17-e2','lqsa-t17-e3']);
 const old=await play(data.episodes['17'][3]);assert.equal(old.status,200);await old.text();assert.equal(state.providerPlays.length,1);
});

test('native range reconnects reuse one episode request identity and keep its lease through range EOF',async()=>{
 const {state,api,play}=await fixture(),root=(await(await api('get_series')).json()).find(row=>row.name==='La que se avecina');
 const episode=(await(await api('get_series_info',{series_id:root.series_id})).json()).episodes['17'][0];
 for(let count=0;count<2;count++){const response=await play(episode);assert.equal(response.status,206);await response.arrayBuffer();}
 assert.equal(state.allocations.length,2);assert.equal(state.allocations[0].request_id,state.allocations[1].request_id);
 assert.match(state.allocations[0].request_id,/supplement/);assert.equal(state.releases.length,0,'a completed Range response must not kill the next seek/reconnect');
});

test('current series permissions, backing visibility and parent adult policy are checked before source bytes',async()=>{
 const {state,api,play}=await fixture(),root=(await(await api('get_series')).json()).find(row=>row.name==='La que se avecina');
 const episode=(await(await api('get_series_info',{series_id:root.series_id})).json()).episodes['17'][0];
 state.user.permissions.series=false;assert.equal((await play(episode)).status,403);assert.equal((await api('get_series_info',{series_id:root.series_id})).status,403);
 state.user.permissions.series=true;state.row.visible=false;assert.equal((await play(episode)).status,404);
 state.row.visible=true;state.user.permissions.adults=false;state.adultParent=true;assert.equal((await play(episode)).status,403);
 assert.equal(state.media.length,0);assert.equal(state.allocations.length,0);assert.equal(state.providerPlays.length,0);
});

test('the supplement never binds to another provider title or an unrelated root identity',async()=>{
 const {exclusives,env,state}=await fixture(),details=providerDetails();
 details.info.name='An unrelated series now using the old provider ID';
 assert.equal(await exclusives.supplementInfo(env,details,reference,state.user.permissions),details);
 const wrong=providerDetails();assert.equal(await exclusives.supplementInfo(env,wrong,{...reference,seriesId:'500'},state.user.permissions),wrong);
});

test('the signed reseller series view keeps the authenticated account scope and rejects forged packets',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const trust={accountId:'fixture-reseller',keyId:'fixture-key-id',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')};
 const now=Date.now(),row=makeLqsaSupplement({...reference,name:'La que se avecina'});
 const history=(n,account,username)=>({id:String(n).padStart(64,'0'),account_id:account,line_id:'fixture-line-'+n,username,kind:'playback',
  started_at:now-10000,last_seen_at:now-1000,ended_at:now-1000,data:JSON.stringify({type:'series',title:'Episode one',seriesTitle:row.name,season:17,episode:1,
   content:{type:'series',id:row.id,name:row.name,episodeId:'lqsa-t17-e1',season:17,episode:1}})});
 const rows=[history(1,trust.accountId,'OwnViewer'),history(2,'foreign-account','ForeignViewer')];
 const store={async list(){return new Map(rows.map(item=>['client-history:'+item.id,item]));}},calls=[];
 const bridge=createResellerBridge(async(_,path,body)=>{calls.push({path,body});assert.equal(path,'/reseller-series-usage');return readSeriesUsage(store,null,body,[row],now);},trust);
 const packet=async(extra={})=>{
  const raw=new TextEncoder().encode(JSON.stringify({v:1,accountId:trust.accountId,keyId:trust.keyId,action:'history.clients',issuedAt:now,nonce:crypto.randomUUID(),
   body:{view:'series',accountId:'foreign-account',pageSize:10},...extra}));
  return {payload:Buffer.from(raw).toString('base64url'),signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,raw)).toString('base64url')};
 };
 const call=value=>bridge(new Request(origin+'/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),{});
 const report=await(await call(await packet())).json();assert.equal(report.accountId,trust.accountId);assert.equal(report.summary.sessions,1);
 assert.equal(report.rows[0].username,'OwnViewer');assert.ok(!JSON.stringify(report).includes('ForeignViewer'));assert.equal(calls[0].body.accountId,trust.accountId);
 for(const extra of [{accountId:'foreign-account'},{issuedAt:now-46000},{keyId:'another-key'}])assert.equal((await call(await packet(extra))).status,403);
 const forged=await packet();forged.signature=(forged.signature[0]==='A'?'B':'A')+forged.signature.slice(1);assert.equal((await call(forged)).status,403);
 assert.equal((await call({})).status,403);assert.equal(calls.length,1,'invalid signatures and stale/foreign packets never reach account data');
});

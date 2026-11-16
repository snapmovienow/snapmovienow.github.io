import test from 'node:test';
import assert from 'node:assert/strict';
import {LQSA_SUPPLEMENT_ID,LQSA_SUPPLEMENT_SERVER,LQSA_EPISODES,cleanSeriesSupplement,makeLqsaSupplement,matchesLqsaTitle,matchesSeriesSupplement,epToExclusiveId,supplementEpisode,supplementRangeRequestId,mergeSeriesSupplement} from '../src/series-supplement.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {exclusiveCatalogRoute,exportExclusives,restoreExclusives,validExclusiveBackup} from '../src/exclusive-catalog.mjs';

const context={server:'ccf',seriesId:'1245'};
const row=()=>({...makeLqsaSupplement({...context,name:'La que se avecina',poster:'https://images.snapcdn.net/cover.jpg',year:2007,plot:'Original plot'}),createdAt:1770000000000});
const data=()=>({info:{name:'La que se avecina',series_id:1245,category_id:'77',cover:'https://images.test/original.jpg',plot:'Provider plot'},
  seasons:[{season_number:16,id:96,name:'Season sixteen',episode_count:1},{season_number:17,id:97,name:'Season seventeen',episode_count:2}],
  episodes:{'16':[{id:'100',season:16,episode_num:1,title:'Existing season'}],
    '17':[{id:'201',season:17,episode_num:1,title:'Provider episode one'},{id:'204',season:17,episode_num:4,title:'Keep episode four'}]},extra:'retain'});

test('supplement contains only three exact stable backing episodes and explicit binding',()=>{
  const item=row();assert.equal(item.id,LQSA_SUPPLEMENT_ID);assert.deepEqual(item.supplement,context);
  assert.equal(item.type,'series');assert.equal(item.mode,'direct');assert.equal(item.episodes.length,3);
  assert.deepEqual(item.episodes.map(ep=>[ep.id,ep.season,ep.episode_num]),[['lqsa-t17-e1',17,1],['lqsa-t17-e2',17,2],['lqsa-t17-e3',17,3]]);
  assert.ok(LQSA_EPISODES.every(ep=>Number(ep.nativeId)<2147483647));
});
test('only exact normalized title and safe explicit target binding are accepted',()=>{
  assert.equal(matchesLqsaTitle('La que se avécina'),true);assert.equal(matchesLqsaTitle('La que se avecina documental'),false);
  for(const binding of [{server:'ccf',seriesId:'0'},{server:'https://provider.test',seriesId:'1'},{server:LQSA_SUPPLEMENT_SERVER,seriesId:'1'},{...context,extra:'bad'}])assert.throws(()=>cleanSeriesSupplement(binding));
  assert.throws(()=>makeLqsaSupplement({...context,name:'Other series'}));
  assert.deepEqual(cleanSeriesSupplement({server:'ccf',seriesId:1245}),context);
});
test('mapping never matches another series, hidden row, source or unregistered episode',()=>{
  const item=row();assert.equal(matchesSeriesSupplement(item,context),true);
  assert.equal(supplementEpisode(item,{...context,seriesId:'999'},990017001),null);
  assert.equal(supplementEpisode({...item,visible:false},context,990017001),null);
  assert.equal(supplementEpisode(item,context,'990017004'),null);assert.equal(epToExclusiveId('lqsa-t17-e1'),'lqsa-t17-e1');
  assert.equal(epToExclusiveId(990017003),'lqsa-t17-e3');assert.equal(epToExclusiveId('990017003?x'),null);
});
test('merges T17E1-3 once while retaining the series identity, category, earlier season and E4',()=>{
  const input=data(),snapshot=JSON.stringify(input),result=mergeSeriesSupplement(input,row(),context);
  assert.equal(JSON.stringify(input),snapshot,'provider input must not be mutated');
  assert.deepEqual(result.info,input.info);assert.equal(result.extra,'retain');
  assert.deepEqual(result.episodes['16'][0].id,'100');
  assert.deepEqual(result.episodes['17'].map(ep=>[ep.id,ep.episode_num]),[['990017001',1],['990017002',2],['990017003',3],['204',4]]);
  assert.equal(result.seasons.find(season=>season.season_number===17).id,97);
  assert.equal(result.seasons.find(season=>season.season_number===17).episode_count,4);
  assert.equal(result.episodes['17'][0].smn_profile.id,context.seriesId);assert.equal(result.episodes['17'][0].smn_profile.server,context.server);
  assert.equal(JSON.stringify(result).includes('archive.org'),false,'source URL must not enter public metadata');
  assert.equal(JSON.stringify(result).includes('lqsa-t17-e'),false,'private backing episode IDs remain internal');
  assert.deepEqual(mergeSeriesSupplement(result,row(),context),result,'repeated import/formatting must be idempotent');
});
test('adds season metadata when season 17 was absent and does not touch unrelated targets',()=>{
  const input=data();delete input.episodes['17'];input.seasons=input.seasons.filter(season=>season.season_number!==17);
  const result=mergeSeriesSupplement(input,row(),context);assert.equal(result.episodes['17'].length,3);
  assert.equal(result.seasons.find(season=>season.season_number===17).name,'Temporada 17');
  assert.equal(mergeSeriesSupplement(input,row(),{...context,server:'other'}),input);
});
test('reserved IDs never replace an unrelated provider episode and partial backing rows fail closed',()=>{
  const input=data();input.episodes['16'][0].id='990017001';
  assert.throws(()=>mergeSeriesSupplement(input,row(),context),/series_supplement_id_conflict/);
  const item=row();item.episodes.pop();assert.throws(()=>mergeSeriesSupplement(data(),item,context),/series_supplement_incomplete/);
});
test('provider root identity must still be the exact series before adding episodes',()=>{
  for(const name of ['Different series','La que se avecina documental',undefined]){
    const input=data();if(name===undefined)delete input.info.name;else input.info.name=name;
    assert.equal(mergeSeriesSupplement(input,row(),context),input);
  }
});

class Store{
  constructor(){this.values=new Map([['exclusive:index',{ids:[],revision:1,updatedAt:0}]]);}
  async get(key){return this.values.get(key);}
  async put(key,value){this.values.set(key,value);}
  async delete(key){this.values.delete(key);}
  async list({prefix=''}){return new Map([...this.values].filter(([key])=>key.startsWith(prefix)));}
  async transaction(work){return work(this);}
}
function serviceFixture(){
  const state={row:{...row(),revision:1,playbackRevision:1,profileServer:'exclusive'},authorized:true,calls:[],tickets:new Map(),guards:[],fetches:[]};
  const ordinary={id:'ordinary-movie',type:'movie',mode:'direct',name:'Ordinary movie',visible:true,adult:false,page:'https://media.snapcdn.net/movie.mp4',episodes:[],createdAt:1};
  const directory=async(env,path,body={})=>{
    state.calls.push({path,body});
    if(path==='/exclusive-read')return Response.json({revision:1,items:[state.row,ordinary]});
    if(path==='/exclusive-item-read')return body.id===state.row.id?Response.json(state.row):Response.json({error:'not_found'},{status:404});
    if(path==='/exclusive-acquire')return Response.json({lease_id:'fixture-lease'});
    if(path==='/heartbeat')return Response.json({ok:state.authorized},{status:state.authorized?200:410});
    return Response.json({ok:true});
  };
  const service=createExclusiveService({directory,sessionCall:async()=>Response.json({ok:state.authorized},{status:state.authorized?200:401}),
    ticket:async(env,value)=>{const id='fixture-ticket-'+state.tickets.size;state.tickets.set(id,structuredClone(value));return id;},
    unticket:async(env,id)=>state.tickets.get(id),requestConnectionClient:()=>({}),resolveGnula:async()=>{throw Error('Direct supplements do not need page resolution')},
    fetcher:async(url,init)=>{state.fetches.push({url,init});const range=new Headers(init.headers).get('Range');
      if(range==='bytes=999-')return new Response(null,{status:416,headers:{'Content-Range':'bytes */16'}});
      return new Response(init.method==='HEAD'?null:'ftyp',{status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(range?{'Content-Range':'bytes 0-3/16'}:{})}});
    },guardXtreamResponse:(response,check,release,ctx,signal,expires,options)=>{state.guards.push({check,release,signal,options});return response;}});
  return {service,state};
}
const session=(xtream=false)=>({sid:'fixture-session',uid:'fixture-user',version:1,exp:Date.now()+3600000,username:'fixture-user',xtream,permissions:{series:true,movies:true,adults:false}});

test('supplement bindings survive catalog saves and backups, and changing target revokes playback revision',async()=>{
  const store=new Store();const response=await exclusiveCatalogRoute(store,'/exclusive-save',{item:row(),revision:0,actor:'test'});
  assert.equal(response.status,200);const saved=(await response.json()).item;assert.deepEqual(saved.supplement,context);
  const item={...saved,name:'La que se avecina'};delete item.supplement;
  const preserved=(await (await exclusiveCatalogRoute(store,'/exclusive-save',{item,revision:1,actor:'test'})).json()).item;
  assert.deepEqual(preserved.supplement,context,'old editors cannot accidentally clear the placement binding');
  assert.equal(preserved.playbackRevision,1);
  const retarget=(await (await exclusiveCatalogRoute(store,'/exclusive-save',{item:{...preserved,supplement:{...context,seriesId:'999'}},revision:2,actor:'test'})).json()).item;
  assert.equal(retarget.playbackRevision,2,'changed target must invalidate previous signed playback');
  const backup=await exportExclusives(store);assert.equal(validExclusiveBackup(backup),true);
  const restored=new Store();await restoreExclusives(restored,backup);assert.deepEqual(await exportExclusives(restored),backup);
  const rejected=await exclusiveCatalogRoute(store,'/exclusive-save',{item:{...row(),id:'foreign-supplement'},revision:0,actor:'test'});assert.equal(rejected.status,400);
});
test('application own-content catalog hides the supplement while protected admin reads retain it',async()=>{
  const {service}=serviceFixture();
  const catalog=await service.catalog({},session().permissions,'https://api.snaptvnow.com');
  assert.deepEqual(catalog.items.map(item=>item.exclusive_id),['ordinary-movie']);
  const admin=await (await service.admin(new Request('https://api.snaptvnow.com'),{},{action:'exclusive-list'},'owner')).json();
  assert.ok(admin.items.some(item=>item.id===LQSA_SUPPLEMENT_ID));
  const merged=await service.supplementInfo({},data(),context,session().permissions);assert.equal(merged.episodes['17'].length,4);
  const input=data();assert.equal(await service.supplementInfo({},input,context,{series:false}),input);
});
test('native preparation uses exact root binding and permissions, preserving client request IDs',async()=>{
  const {service,state}=serviceFixture(),request=new Request('https://api.snaptvnow.com/api');
  assert.equal(await service.prepareSupplementNative(request,{},session(),{...context,id:'100'}),null);
  assert.equal(await service.prepareSupplementNative(request,{},session(),{...context,seriesId:'999',id:'990017001'}),null);
  await assert.rejects(()=>service.prepareSupplementNative(request,{}, {...session(),permissions:{series:false}}, {...context,id:'990017001'}),/title_not_allowed/);
  const prepared=await service.prepareSupplementNative(request,{},session(),{...context,id:'990017001'},{request_id:'client-request',revision:1});
  assert.equal(prepared.request_id,'client-request');assert.equal(prepared.lease_id,'fixture-lease');
  const signed=state.tickets.get(new URL(prepared.url).searchParams.get('t'));assert.equal(signed.exclusiveId,'lqsa-t17-e1');assert.equal(signed.supplementRange,true);
  assert.equal(state.calls.find(call=>call.path==='/exclusive-acquire').body.exclusiveId,'lqsa-t17-e1');
});
test('bound preparation validates current provider identity before allocating playback',async()=>{
  const {service,state}=serviceFixture(),request=new Request('https://api.snaptvnow.com/api');let checks=0;
  const options={validateRoot:async root=>{checks++;assert.deepEqual(root,context);return false;}};
  assert.equal(await service.prepareSupplementNative(request,{},session(),{...context,seriesId:'999',id:'990017001'},options),null);
  assert.equal(checks,0,'unbound requests never fetch current provider metadata');
  await assert.rejects(()=>service.prepareSupplementNative(request,{},session(),{...context,id:'990017001'},options),/title_not_allowed/);
  assert.equal(checks,1);assert.equal(state.calls.some(call=>call.path==='/playback-begin'||call.path==='/exclusive-acquire'),false);
  await service.prepareSupplementNative(request,{},session(),{...context,id:'990017001'},{validateRoot:async()=>true});
  assert.equal(state.calls.some(call=>call.path==='/exclusive-acquire'),true);
});
test('Xtream prepares stable scoped range requests; same ticket ranges/HEAD/416 do not release its lease',async()=>{
  const {service,state}=serviceFixture(),viewer=session(true),request=new Request('https://api.snaptvnow.com/series');
  const first=await service.prepareSupplementNative(request,{},viewer,{...context,id:'990017001'});
  const again=await service.prepareSupplementNative(request,{},viewer,{...context,id:'990017001'});
  assert.equal(first.request_id,again.request_id);assert.equal(first.request_id,supplementRangeRequestId(state.row,'lqsa-t17-e1'));
  for(const init of [{headers:{Range:'bytes=0-3'}},{method:'HEAD'},{headers:{Range:'bytes=999-'}}]){
    const response=await service.media(new Request(first.url,init),{},{});assert.equal(response.status,init.headers?.Range==='bytes=999-'?416:init.headers?206:200);await response.body?.cancel();
  }
  assert.equal(state.calls.filter(call=>call.path==='/release').length,0);
  assert.equal(state.guards[0].release,undefined);assert.equal(state.guards[0].options.allowBufferedPause,true);
  assert.equal(await state.guards[0].check(),true);state.authorized=false;assert.equal(await state.guards[0].check(),false,'session revocation remains enforced');
  state.authorized=true;const before=state.fetches.length;state.row={...state.row,playbackRevision:2};
  await assert.rejects(()=>service.media(new Request(first.url),{},{}),/title_not_allowed/);assert.equal(state.fetches.length,before);
});
test('progressive supplement timeout ends at headers while client cancellation remains connected',async()=>{
  const {service,state}=serviceFixture(),client=new AbortController(),request=new Request('https://api.snaptvnow.com/api',{signal:client.signal});
  const prepared=await service.prepareSupplementNative(request,{},session(),{...context,id:'990017001'},{request_id:'native-request'});
  const timers=new Map();let next=0;
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalTimeout=AbortSignal.timeout;
  globalThis.setTimeout=(callback,ms)=>{const id=++next;timers.set(id,{callback,ms});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  AbortSignal.timeout=ms=>{const control=new AbortController();setTimeout(()=>control.abort(new DOMException('timeout','TimeoutError')),ms);return control.signal;};
  try{
    const response=await service.media(new Request(prepared.url,{signal:client.signal}),{},{});
    const signal=state.fetches[0].init.signal;
    for(const timer of [...timers.values()].filter(timer=>timer.ms<=30000))timer.callback();
    assert.equal(signal.aborted,false,'the 20-second startup deadline must not cut an active progressive body');
    assert.equal(await response.text(),'ftyp');client.abort();assert.equal(signal.aborted,true,'client abort still reaches the origin after headers');
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;AbortSignal.timeout=originalTimeout;}
});

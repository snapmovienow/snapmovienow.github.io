import assert from 'node:assert/strict';
import {COMEDY_SERIES_DEFINITIONS as definitions} from '../src/comedy-series-catalog.mjs';
import {COMEDY_PROVIDER_KEY,providerComedyInventory,providerComedyItems,providerComedyContent,providerComedyTitle,comedyProviderRoute,createComedyProviderCompletion,publicProviderComedyStatus} from '../src/comedy-provider-completion.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {createComedySeriesXtream} from '../src/comedy-series-xtream.mjs';
import {comedyNativeCatalog} from '../src/comedy-native-catalog.mjs';
const defs=definitions.filter(d=>d.id!=='comedy-muertos-sl');
function fixture(def,index=1){let id=index*100000;return {candidate:{name:def.name,series_id:String(index),_server:'ccf'},detail:{info:{name:def.name,cover:'https://images.example.test/cover.jpg',plot:'Una comedia'},episodes:Object.fromEntries(Object.entries(def.seasons).map(([season,count])=>[season,Array.from({length:count},(_,n)=>({id:String(++id),episode_num:n+1,title:'Episodio '+(n+1),container_extension:'mp4'}))]))}};}
const fixtures=defs.map((def,i)=>fixture(def,i+1)),entries=fixtures.map((f,i)=>({...providerComedyInventory(defs[i],f.candidate,f.detail),verified:true}));
assert.deepEqual(entries.map(e=>e.episodes.length),[42,9]);
assert.equal(providerComedyTitle('Alpha Males',defs[0]),false,'English title is never selected as the Spanish source');
assert.equal(providerComedyTitle('[ESP] Machos alfa (2022)',defs[0]),true);
assert.equal(providerComedyTitle('Cuñados 2011',defs[1]),true);
assert.equal(providerComedyTitle('Machos alfa [ES] (2022) HD',defs[0]),true);
assert.equal(providerComedyTitle('Machos alfa ENG',defs[0]),false);
assert.equal(providerComedyInventory(defs[0],fixtures[0].candidate,{...fixtures[0].detail,episodes:{'1':fixtures[0].detail.episodes['1'].slice(0,5)}}),null);
const bad=structuredClone(fixtures[0]);bad.detail.episodes['1'][1].id=bad.detail.episodes['1'][0].id;assert.equal(providerComedyInventory(defs[0],bad.candidate,bad.detail),null);
const items=providerComedyItems({entries});assert.equal(items.length,2);assert.equal(providerComedyItems({entries:[{...entries[0],verified:false}]}).length,0);
assert.equal(items[0].episodes[0].container_extension,'mp4');
assert.equal(providerComedyContent({entries},'series|ccf|'+entries[0].episodes[0].upstreamId+'|mp4').id,defs[0].id);
assert.equal(providerComedyContent({entries},'series|other|'+entries[0].episodes[0].upstreamId+'|mp4'),null);
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve();}async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}}
let store=new Store(),probes=0,metadataReads=0;
const directory=async(env,path,body)=>comedyProviderRoute(store,path,body);
const bootstrap=createComedyProviderCompletion({directory,catalogFactory:()=>async(action,server,params)=>{metadataReads++;return action==='get_series'?fixtures.map(f=>f.candidate):fixtures.find(f=>f.candidate.series_id===params.series_id)?.detail;},probe:async(env,ctx,sample)=>{probes++;assert.equal(sample.type,'series');assert.equal(sample.server,'ccf');assert.equal(sample.ext,'mp4');return {ok:true,status:'healthy',reason:'ok'};}});
const env={ENVIRONMENT:'production',COMEDY_PROVIDER_COMPLETION_ENABLED:'true',PLAYBACK_CANARY_USERNAME:'owner-test'};
const work=[],ctx={waitUntil:p=>work.push(p)};bootstrap(env,ctx);bootstrap(env,ctx);await Promise.all(work);
assert.equal(probes,51);assert.equal(metadataReads,3);let status=await(await directory(env,'/comedy-provider-status')).json();assert.equal(status.state,'completed');assert.deepEqual(status.series.map(s=>s.verified),[42,9]);assert.equal(JSON.stringify(status).includes('https:'),false);assert.equal(JSON.stringify(status).includes('ccf'),false);
bootstrap(env,ctx);await Promise.all(work);assert.equal(probes,51,'completed finite proof never repeats');
const saved=await store.get(COMEDY_PROVIDER_KEY);assert.equal(saved.entries.length,2);
// A successful claim cannot be overwritten by a foreign or expired invocation.
assert.equal((await directory(env,'/comedy-provider-finish',{claim:'foreign',entries,results:[]})).status,409);
const native=comedyNativeCatalog({op:'series',rows:[{series_id:10,name:'Machos alfa'}],items,permissions:{series:true,adults:false},origin:'https://api.snaptvnow.com'});assert.equal(native.length,2);assert.equal(native[0].source,'gnula');assert.equal(native[0].series_id,defs[0].id);
let delegated=0;
const service=createExclusiveService({directory:async(env,path)=>path==='/exclusive-read'?Response.json({items:[]}):path==='/comedy-provider-read'?Response.json({entries}):Response.json({}),prepareProvider:async(req,env,session,row,ep)=>{delegated++;assert.equal(row.providerBinding.seriesId,'1');assert.equal(ep.upstreamId,entries[0].episodes[0].upstreamId);return {url:'https://api.snaptvnow.com/stream?t=opaque',lease_id:'lease',request_id:'request'};}});
const info=await service.episodes({},defs[0].id,{series:true,adults:false},'https://api.snaptvnow.com');assert.equal(Object.keys(info.episodes).length,5);assert.equal(info.episodes['1'][0].container_extension,'mp4');
await service.prepare(new Request('https://api.snaptvnow.com/'),{}, {permissions:{series:true,adults:false}},items[0].episodes[0].id);assert.equal(delegated,1);
await assert.rejects(service.prepare(new Request('https://api.snaptvnow.com/'),{}, {permissions:{series:false}},items[0].episodes[0].id),/title_not_allowed/);assert.equal(delegated,1);
const auth={user:{permissions:{series:true,adults:false}},session:{},username:'viewer',password:'fixture-only'},records=[];
const xtream=createComedySeriesXtream({read:async()=>({items}),prepare:async()=>({url:'https://api.snaptvnow.com/stream?t=opaque'}),media:async()=>new Response('routed')},{},{});
const detail=await(await xtream.details({record:{kind:'series_list',server:'smn-comedy-series',upstreamId:'2'},auth,base:'https://api.snaptvnow.com',register:async rows=>{records.push(...rows);return rows.map((_,i)=>i+1);},catalog:async()=>[]})).json();assert.equal(detail.episodes['1'][0].container_extension,'mp4');assert.match(detail.episodes['1'][0].direct_source,/\.mp4$/);assert.equal(records.filter(r=>r.kind==='episode').length,42);
// Missing/incomplete provider catalogues cannot become a fake completed series.
store=new Store();const incomplete=createComedyProviderCompletion({directory,catalogFactory:()=>async(action)=>action==='get_series'?[fixtures[0].candidate]:{info:{name:defs[0].name},episodes:{}},probe:()=>{throw Error('incomplete sources must not allocate a test session');}});const pending=[];incomplete(env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);status=publicProviderComedyStatus(await store.get(COMEDY_PROVIDER_KEY));assert.deepEqual(status.series.map(s=>s.state),['incomplete','not_found']);assert.equal(providerComedyItems(await store.get(COMEDY_PROVIDER_KEY)).length,0);
for(const config of [{...env,ENVIRONMENT:'staging'},{...env,COMEDY_PROVIDER_COMPLETION_ENABLED:'false'},{...env,PLAYBACK_CANARY_ENABLED:'false'}]){const tasks=[];bootstrap(config,{waitUntil:p=>tasks.push(p)});assert.equal(tasks.length,0);}
console.log('PASS finite provider completion: exact Spanish identities, all 51 media probes, bounded claims, real formats, current permissions, native/Xtream routing and stable usage identity.');

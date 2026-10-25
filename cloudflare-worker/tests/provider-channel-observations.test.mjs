import assert from 'node:assert/strict';
import {CHANNEL_OBSERVATION_POLICY as policy,canonicalChannelId,observationShard,channelObservation,recordChannelObservation,readChannelObservations,cachedChannelCatalog,summarizeChannelObservations,loadChannelObservations} from '../src/provider-channel-observations.mjs';
import {INITIAL_EVIDENCE_HEADER,initialMediaEvidence,consumeInitialEvidence} from '../src/initial-media-evidence.mjs';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
class Store{constructor(){this.data=new Map();this.gets=0}async get(k){this.gets++;return structuredClone(this.data.get(k))}async put(k,v){assert.ok(new TextEncoder().encode(JSON.stringify(v)).byteLength<128000);this.data.set(k,structuredClone(v))}}
const now=2*policy.windowMs,env={PLAYBACK_CANARY_USERNAME:'dieguito2026'},lease={mediaKey:'live|ccf|00012|ts',provider_id:'secret-account',username:'private-viewer',sid:'private-session'},ok={stage:'signal',ok:true,evidence:'bytes'},failed={stage:'signal',ok:false,httpStatus:503};
assert.equal(canonicalChannelId('00012'),'12');assert.equal(canonicalChannelId('https://private'),null);
assert.equal(channelObservation(lease,ok,env).cohort,'customer');assert.equal(channelObservation({...lease,canary:true},ok,env).cohort,'customer','untrusted canary label cannot reclassify a viewer');
assert.equal(channelObservation({...lease,username:'DIEGUITO2026'},ok,env).cohort,'owner_test');assert.equal(channelObservation({...lease,username:'dieguito2026',canary:true},ok,env).cohort,'canary');
for(const result of [{...ok,stage:'validation'},{...ok,evidence:'http_200'},{...failed,httpStatus:410},{...failed,httpStatus:409},{...failed,httpStatus:416},{...failed,httpStatus:429},{...failed,httpStatus:null},{...failed,httpStatus:'503'},{...failed,stage:'validation',httpStatus:403}])assert.equal(channelObservation(lease,result,env),null);
assert.equal(channelObservation(lease,{...failed,httpStatus:403},env).field,'failureAt','actual media rejection remains pending, not falsely counted as auth or byte failure');
for(const mediaKey of ['movie|ccf|12|mp4','live|other|12|ts','live|ccf|private-id|ts'])assert.equal(channelObservation({...lease,mediaKey},ok,env),null);
const store=new Store();await recordChannelObservation(store,lease,ok,env,now);assert.equal(store.gets,2,'one shard and tiny metadata only; no full persistence read on playback');
await recordChannelObservation(store,{...lease,mediaKey:'live|ccf|12|m3u8'},{...ok,evidence:'manifest'},env,now+1);
await recordChannelObservation(store,{...lease,provider_id:'other-secret'},failed,env,now+2);
await recordChannelObservation(store,{...lease,username:'dieguito2026'},ok,env,now+3);
await recordChannelObservation(store,{...lease,username:'dieguito2026',canary:true},ok,env,now+4);
await recordChannelObservation(store,{...lease,mediaKey:'live|ccf|99|ts'},ok,env,now+4);
let observations=await readChannelObservations(store,now+5);assert.equal(Object.keys(observations.rows).length,2);
const snapshot={status:'available',ids:['12','13'],total:2,savedAt:now,ageMs:5,scope:'cached_configured_ccf_catalog',providerInventoryVerified:false};
let summary=summarizeChannelObservations(observations,snapshot,now+5),customer=summary.groups[0];
assert.deepEqual([customer.observed,customer.successOnly,customer.failureOnly,customer.mixed,customer.unobserved,customer.coveragePercent,customer.outsideCatalog],[1,0,0,1,1,50,1]);
assert.equal(customer.bytesSuccess,1);assert.equal(customer.manifestSuccess,1);assert.equal(summary.groups[1].successOnly,1);assert.equal(summary.groups[2].successOnly,1);
assert.equal(summary.attribution,'pending');assert.equal(summary.audioVideoVerified,false);assert.equal(summary.catalog.ids,undefined);
const serialized=JSON.stringify([...store.data])+JSON.stringify(summary);for(const value of ['secret-account','other-secret','private-viewer','private-session','dieguito2026','00012','https://'])assert.ok(!serialized.includes(value),value);
observations=await readChannelObservations(store,now+policy.windowMs+1);summary=summarizeChannelObservations(observations,snapshot,now+policy.windowMs+1);assert.equal(summary.groups[0].failureOnly,1,'both successful timestamps expire independently of the later failure');
observations=await readChannelObservations(store,now+policy.windowMs+5);assert.deepEqual(observations.rows,{});
await readChannelObservations(store,now+policy.windowMs+5,{prune:true});assert.deepEqual((await store.get(observationShard('12'))).rows,{},'admin transactional cleanup physically removes expired observations');
const absent=await cachedChannelCatalog(async(...args)=>{assert.deepEqual(args,['get_live_streams','ccf',{}, {cachedOnly:true,withMetadata:true}]);return null},now);
summary=summarizeChannelObservations({rows:{12:{customer:{bytesAt:now}}}},absent,now+5);assert.equal(summary.groups[0].unobserved,null);assert.equal(summary.groups[0].coveragePercent,null);assert.equal(summary.groups[0].successOnlyPercent,null);
const ppv=await cachedChannelCatalog(async()=>({savedAt:now-10,data:[{stream_id:'12',_server:'ccf',name:'PPV OFFLINE EVENT'},{stream_id:'012',_server:'ccf'},{stream_id:13,_server:'other'}]}),now);assert.deepEqual(ppv.ids,['12'],'events stay included and numeric forms deduplicate');
assert.equal((await cachedChannelCatalog(async()=>({savedAt:now-12*3600000,data:[]}),now)).total,null);
assert.equal((await cachedChannelCatalog(async()=>({savedAt:now,data:[{stream_id:'private'}]}),now)).status,'invalid_snapshot');
// Exercise the real cachedOnly code path: missing catalog never discovers
// credentials, invokes a provider, or refreshes a catalog in the background.
let configReads=0,providerReads=0;const catalog=createProviderCatalog({directory:async()=>{configReads++;return Response.json([{source:'safe',origin:'https://configured.invalid'}])},registry:async()=>new Response(null,{status:404}),catalogCredentials:async()=>{providerReads++;throw Error('unexpected provider read')}},{TICKET_SECRET:'test-secret',PLAYBACK_SESSIONS:{}},null);
assert.equal((await cachedChannelCatalog(catalog)).status,'unavailable');assert.equal(configReads,1);assert.equal(providerReads,0);
const full=new Store(),target=observationShard('1'),ids=[];for(let id=1;ids.length<=policy.maxChannelsPerShard;id++)if(observationShard(String(id))===target)ids.push(String(id));
for(const id of ids)await recordChannelObservation(full,{...lease,mediaKey:'live|ccf|'+id+'|ts'},ok,env,now);
observations=await readChannelObservations(full,now+1);assert.equal(Object.keys(observations.rows).length,policy.maxChannelsPerShard);assert.equal(observations.incomplete,true);
summary=summarizeChannelObservations(observations,{...snapshot,ids,total:ids.length},now+1);assert.equal(summary.groups[0].coveragePercent,null);assert.equal(summary.groups[0].successOnlyPercent,null);assert.equal(summary.groups[0].unobserved,null);
await recordChannelObservation(full,{...lease,mediaKey:'live|ccf|'+ids[0]+'|ts'},failed,env,now+2);assert.equal((await readChannelObservations(full,now+3)).rows[ids[0]].customer.failureAt,now+2,'saturation does not discard an existing channel update');
await recordChannelObservation(full,lease,ok,env,now+policy.windowMs+3);assert.equal((await readChannelObservations(full,now+policy.windowMs+4)).incomplete,false);
const broken=new Store(),put=broken.put.bind(broken);broken.put=async(k,v)=>{if(k===observationShard('12'))throw Error('write-failed');return put(k,v)};assert.equal(await recordChannelObservation(broken,lease,ok,env,now),false);assert.equal((await readChannelObservations(broken,now+1)).incomplete,true);
const internal=new Response('bytes',{headers:{[INITIAL_EVIDENCE_HEADER]:'bytes','content-type':'video/mp2t'}}),clean=consumeInitialEvidence(internal);assert.equal(clean.headers.has(INITIAL_EVIDENCE_HEADER),false);assert.equal(initialMediaEvidence(clean),'bytes');assert.equal(await clean.text(),'bytes');assert.equal(initialMediaEvidence(new Response('200')) ,null,'HTTP 200 alone is not evidence');
for(const read of [async()=>{throw Error('storage error with private text')},async()=>Response.json({error:'failed'},{status:400}),async()=>Response.json({}),()=>new Promise(()=>{})]){
 const unavailable=await loadChannelObservations(read,5),view=summarizeChannelObservations(unavailable,snapshot,now);assert.equal(view.status,'unavailable');assert.equal(view.incomplete,true);assert.equal(view.groups[0].observed,null);assert.equal(view.groups[0].unobserved,null);assert.equal(view.groups[0].coveragePercent,null);assert.equal(view.groups[0].successOnlyPercent,null);assert.ok(!JSON.stringify(view).includes('private text'));
}
console.log('PASS: private passive unique-channel retention, cohorts, evidence levels, cached-only denominator, PPV inclusion, exact expiry, storage caps and incomplete reporting.');

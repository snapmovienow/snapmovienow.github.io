import assert from 'node:assert/strict';
import {BRANDING_TEST_CHANNEL as channel,PUBLIC_TV_CHANNELS} from '../src/public-tv-channels.mjs';
import {runBrandingTestImport,runBrandingTestWithdrawal,brandingTestImportStatus,BRANDING_TEST_WITHDRAWAL_REQUEST} from '../src/branding-test-import.mjs';
import {exclusiveCatalogRoute} from '../src/exclusive-catalog.mjs';
import {createLocalTvXtream,LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();this.inTransaction=false;this.failSaves=false;this.failedSaves=0;}
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){if(this.failSaves&&k==='exclusive:item:'+channel.id&&v.visible===false){this.failedSaves++;throw Error('synthetic write failure');}this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const p=this.queue.then(async()=>{const before=structuredClone(this.data);this.inTransaction=true;try{return await fn(this);}catch(error){this.data=before;throw error;}finally{this.inTransaction=false;}});this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},row={id:channel.id,type:'movie',name:'Manual demo title',source:'Manual source label',mode:'direct',page:channel.page,poster:'',plot:'Manual description',year:null,visible:true,adult:false,usageKind:'channel',episodes:[],profileServer:'exclusive',preferredEmbed:null,revision:4,playbackRevision:7,createdAt:1,updatedAt:2},other={...row,...PUBLIC_TV_CHANNELS[0],name:'Unrelated channel'},importKey='catalog-import:branding-test-owner-20261104-v1',oldJob={state:'completed',attempts:1,results:[{status:'added'}]};
let store=new Store([row,other]);await store.put(importKey,oldJob);const leases=await openLeaseStore(store);
await store.put('playback-lease:demo',{sid:'fixture-demo',uid:'fixture',request_id:'fixture-demo',exclusiveParentId:channel.id,playbackRevision:7,until:Date.now()+60000});await store.put('playback-lease:other',{sid:'fixture-other',uid:'fixture',request_id:'fixture-other',exclusiveParentId:other.id,playbackRevision:7,until:Date.now()+60000});
const logs=[],logger=console.log;console.log=value=>{assert.equal(store.inTransaction,false,'withdrawal logs only after commit');logs.push(value);};
await Promise.all([runBrandingTestWithdrawal(store,leases,env),runBrandingTestWithdrawal(store,leases,env)]);
const hidden=await store.get('exclusive:item:'+channel.id);assert.equal(hidden.visible,false);assert.equal(hidden.revision,5);assert.equal(hidden.playbackRevision,8);assert.equal(hidden.createdAt,row.createdAt);
for(const field of ['name','source','mode','page','poster','plot','year','adult','usageKind','episodes','profileServer','preferredEmbed'])assert.deepEqual(hidden[field],row[field],field);
assert.deepEqual(await store.get('exclusive:item:'+other.id),other);assert.deepEqual(await store.get(importKey),oldJob);assert.deepEqual((await store.get('exclusive:index')).ids,[channel.id,other.id]);assert.equal(await store.get('playback-lease:demo'),undefined);assert.ok(await store.get('playback-lease:other'));
let status=await brandingTestImportStatus(store);assert.equal(status.withdrawal.requestId,BRANDING_TEST_WITHDRAWAL_REQUEST);assert.equal(status.withdrawal.state,'completed');assert.equal(status.withdrawal.attempts,1);assert.equal(status.withdrawal.results[0].status,'withdrawn');assert.ok(!JSON.stringify(status.withdrawal).includes('https://'));assert.deepEqual(logs,[{event:'branding_test_withdrawal',status:'withdrawn',visible:false}]);
const after=structuredClone(store.data);await runBrandingTestWithdrawal(store,leases,env);await runBrandingTestImport(store,{},env,{probe:()=>{throw Error('retired demo cannot import');}});assert.deepEqual(store.data,after);assert.equal(logs.length,1);
// The existing category generator and playback guard automatically hide it.
const hooks=createLocalTvXtream({read:async()=>({items:[hidden]}),prepare:()=>{throw Error('hidden demo cannot prepare');}},{},null),auth={user:{permissions:{tv:true,adults:false}}};
assert.deepEqual(await hooks.list({action:'get_live_categories',rows:[],auth}),[]);assert.deepEqual(await hooks.list({action:'get_live_streams',rows:[],auth}),[]);
assert.equal((await hooks.play(new Request('https://api.snaptvnow.com/live/fixture/fixture/1.m3u8'),auth,{kind:'live',server:LOCAL_TV_SERVER,upstreamId:channel.xtreamId,ext:'m3u8'})).status,404);
// An explicit later owner restoration remains possible; withdrawal is one-shot.
const restored=await store.transaction(tx=>exclusiveCatalogRoute(tx,'/exclusive-save',{item:{...hidden,visible:true},revision:hidden.revision,actor:'synthetic-owner-restoration'}));assert.equal(restored.status,200);await runBrandingTestWithdrawal(store,leases,env);assert.equal((await store.get('exclusive:item:'+channel.id)).visible,true);
for(const [input,expected]of [[{...row,visible:false},'already_hidden'],[{...row,page:PUBLIC_TV_CHANNELS[0].page},'source_changed'],[{...row,mode:'gnula'},'source_changed'],[{...row,type:'series'},'source_changed']]){
 store=new Store([input,other]);const repo=await openLeaseStore(store),before=structuredClone(input);await runBrandingTestWithdrawal(store,repo,env);assert.deepEqual(await store.get('exclusive:item:'+channel.id),before);assert.deepEqual(await store.get('exclusive:item:'+other.id),other);assert.equal((await brandingTestImportStatus(store)).withdrawal.results[0].status,expected);
}
store=new Store();await store.delete('exclusive:index');await runBrandingTestWithdrawal(store,await openLeaseStore(store),env);assert.equal((await brandingTestImportStatus(store)).withdrawal.results[0].status,'not_found');assert.equal(await store.get('exclusive:index'),undefined,'missing demo never seeds another catalog');await runBrandingTestImport(store,{},env,{probe:()=>{throw Error('missing demo cannot reappear');}});assert.equal(await store.get('exclusive:item:'+channel.id),undefined);
// The first failed claim already blocks import; save retries stop at three.
store=new Store([row,other]);store.failSaves=true;const repo=await openLeaseStore(store);for(let n=0;n<4;n++){await runBrandingTestWithdrawal(store,repo,env);await runBrandingTestImport(store,{},env,{probe:()=>{throw Error('withdrawal marker blocks import');}});}
status=await brandingTestImportStatus(store);assert.equal(status.withdrawal.state,'completed');assert.equal(status.withdrawal.attempts,3);assert.equal(status.withdrawal.results[0].status,'save_failed');assert.equal(store.failedSaves,3);assert.deepEqual(await store.get('exclusive:item:'+channel.id),row);assert.deepEqual(await store.get('exclusive:item:'+other.id),other);
// An import whose probe started earlier cannot publish after withdrawal starts.
store=new Store();const concurrentRepo=await openLeaseStore(store);await runBrandingTestImport(store,{},env,{probe:async()=>{await runBrandingTestWithdrawal(store,concurrentRepo,env);return {ok:true};}});assert.equal(await store.get('exclusive:item:'+channel.id),undefined);assert.equal((await brandingTestImportStatus(store)).withdrawal.results[0].status,'not_found');
for(const config of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'}]){store=new Store([row]);const before=structuredClone(store.data);await runBrandingTestWithdrawal(store,{},config);assert.deepEqual(store.data,before);}
console.log=logger;
console.log('PASS: finite branding withdrawal, exact source guard, revisioned visibility only, targeted lease revocation, unchanged other rows/import ledger, one post-commit log, concurrency/repeat/no reimport, three save retries, automatic folder hide and explicit reversibility.');

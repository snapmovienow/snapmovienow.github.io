import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
const source=`
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {LOCAL_TV_CHANNELS} from '../src/official-live.mjs';
import {localStartupSummary} from '../src/local-startup-observations.mjs';
export class StartupDirectory{
 constructor(state){this.state=state;}
 async fetch(req){const path=new URL(req.url).pathname,body=await req.clone().json(),store=this.state.storage;
  if(path==='/seed'){const row={...LOCAL_TV_CHANNELS[0],type:'movie',mode:'gnula',visible:true,adult:false,playbackRevision:1},user={id:'runtime-user',username:'runtime',status:'active',version:1,permissions:{tv:true}},lease={sid:'runtime-session',uid:user.id,username:user.username,version:1,request_id:'runtime-request',exclusiveId:row.id,exclusiveParentId:row.id,playbackRevision:1,until:Date.now()+90000};await store.put('exclusive:item:'+row.id,row);await store.put('user:runtime',user);await store.put('playback:'+lease.sid,{request_id:lease.request_id});await(await openLeaseStore(store)).put('runtime-lease',lease);return Response.json({sid:lease.sid,lease_id:'runtime-lease',request_id:lease.request_id,exclusiveId:row.id,parentId:row.id,playbackRevision:1});}
  if(path==='/hide'){const row=await store.get('exclusive:item:'+body.id);await store.put('exclusive:item:'+body.id,{...row,visible:false});return Response.json({ok:true});}
  if(path==='/summary')return Response.json(await localStartupSummary(store));
  return accountsFetch(this.state,{},req);
 }
}
export default {fetch(req,env){return env.TEST.get(env.TEST.idFromName('startup')).fetch(req)}};`;
const built=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,platform:'browser',format:'esm',write:false});
const options={name:'local-startup-sqlite',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-03',durableObjects:{TEST:{className:'StartupDirectory',useSQLite:true}},durableObjectsPersist:false},mf=new Miniflare(convertV4MiniflareOptions(options));
try{
 await mf.ready;const call=async(path,body={})=>{const response=await mf.dispatchFetch('https://local.test'+path,{method:'POST',body:JSON.stringify(body)});return {status:response.status,data:await response.json()};},scope=(await call('/seed')).data;
 assert.equal((await call('/accounts/heartbeat',scope)).status,200);
 const claims=await Promise.all(Array.from({length:8},()=>call('/accounts/heartbeat',{...scope,localVideo:true})));assert.equal(claims.filter(r=>r.data.localVideoProbe).length,1,'SQLite serialization grants one probe despite parallel fragment requests');
 await Promise.all(Array.from({length:8},()=>call('/accounts/local-startup-observe',{...scope,stage:'firstVideoBytes',durationMs:1500})));
 assert.equal((await call('/summary')).data.channels[0].firstVideoBytes.samples,1,'duplicate reports remain idempotent in real transactions');
 await mf.unsafeEvictDurableObject('local-startup-sqlite','StartupDirectory',{name:'startup'});
 assert.equal((await call('/summary')).data.channels[0].firstVideoBytes.lastMs,1500,'bounded evidence survives an actual object restart');
 assert.equal((await call('/accounts/heartbeat',{...scope,localVideo:true})).data.localVideoProbe,undefined,'the claim also survives restart');
 await call('/hide',{id:scope.exclusiveId});assert.equal((await call('/accounts/heartbeat',scope)).data.error,'title_not_allowed','authoritative item changes invalidate the next request');
 console.log('PASS: real workerd/SQLite atomic media authorization, concurrent one-shot claims, idempotent reports, persistence/restart and immediate hide enforcement.');
}finally{await mf.dispose();}

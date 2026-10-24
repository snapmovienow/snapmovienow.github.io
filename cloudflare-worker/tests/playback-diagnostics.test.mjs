import assert from 'node:assert/strict';
import {ownPlaybackCanaryAdapter} from '../src/own-playback-canary.mjs';
import {runPlaybackCanary,cleanCanaryResult} from '../src/playback-canary.mjs';
import {applyObservations} from '../src/monitor.mjs';
import {prepareWebPlayback} from '../src/web-playback.mjs';
const secret='https://private.example/password=do-not-persist';
for(const operation of ['live','stream_token'])for(const error of ['provider_unavailable',secret]){
 const data=new Map(),storage={get:async key=>data.get(key),put:async(key,value)=>data.set(key,value),delete:async key=>data.delete(key)};
 const adapter=ownPlaybackCanaryAdapter({env:{PLAYBACK_CANARY_USERNAME:'owner-test'},storage,directory:async()=>Response.json({sample:null}),request:async request=>{
  const body=await request.json();
  if(body.op===operation)return Response.json({error,password:secret,url:secret},{status:503});
  assert.equal(body.op,'live');return Response.json([{stream_id:1,name:'Test channel'}]);
 }});
 const result=await runPlaybackCanary({username:'owner-test',type:'live'},{...adapter,authenticate:async()=>({sid:'probe',token:'opaque'}),release:async()=>{}});
 assert.equal(result.status,'failed');assert.deepEqual(result.failure,{phase:'catalog_prepare',code:'http_error',httpStatus:503,operation,...(error==='provider_unavailable'?{serviceError:error}:{})});
 assert.ok(!JSON.stringify(result).includes(secret));
 assert.deepEqual(cleanCanaryResult(result,'live').failure,result.failure,'the durable monitor sanitizer retains only the diagnostic allowlist');
 const now=Date.now(),state={createdAt:now,config:{channel:'panel'},checks:{},incidents:{},history:[],outbox:[]},snapshot={canary:{enabled:true,results:[{...result,at:now}]}};
 applyObservations(state,snapshot,now);assert.equal(Object.keys(state.incidents).length,0,'one failure does not generate a confirmed incident');
 snapshot.canary.results[0].at=now+300000;applyObservations(state,snapshot,now+300000);
 const incident=state.incidents['canary:live'];assert.match(incident.title,/preparar la reproducción/);assert.match(incident.detail,/HTTP 503/);assert.ok(incident.detail.includes(operation));assert.ok(!JSON.stringify(state).includes(secret));
}
const owned={managed:true,sid:'probe'},body={type:'live',id:1,ext:'ts'},deps={cleanExt:x=>x,directory:async()=>Response.json({ok:true}),json:(value,status)=>Response.json(value,{status})};
for(const [message,status,code] of [['provider_unavailable',503,'provider_unavailable'],['live_startup_timeout',504,'live_startup_timeout'],['playback_superseded',410,'playback_superseded'],[secret,502,'playback_preparation_failed']]){
 const r=await prepareWebPlayback(body,owned,'https://api.snaptvnow.com/',{},null,{...deps,managedPlayback:async()=>{throw Error(message)}});
 assert.equal(r.status,status);assert.deepEqual(await r.json(),{error:code},'real preparation failures cannot be mislabeled as missing provider configuration');
}
console.log('PASS: catalog vs preparation 503 diagnostics, allowlisted causes, honest incident phases, confirmation threshold and redacted preparation errors.');

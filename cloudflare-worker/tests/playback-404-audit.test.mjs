import assert from 'node:assert/strict';
import {auditLive404} from '../src/playback-404-audit.mjs';
import {ownPlaybackCanaryAdapter} from '../src/own-playback-canary.mjs';
import {compareOwnPlayback} from '../src/playback-comparison.mjs';
class Store{
 data=new Map();queue=Promise.resolve();
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}
 transaction(fn){const task=this.queue.then(()=>fn(this));this.queue=task.catch(()=>{});return task}
}
const sample={type:'live',server:'ccf',id:'987654321',ext:'ts'},failed={type:'live',status:'failed',failure:{phase:'media_headers',httpStatus:404}};
const store=new Store();let calls=0,finish;
const compare=async selected=>{calls++;assert.deepEqual(selected,sample);await new Promise(r=>{finish=r});return {verdict:'origin_not_found',origin:{ok:false,httpStatus:404},relay:{ok:false,httpStatus:404}}};
const first=auditLive404(store,failed,sample,compare);
await new Promise(r=>setTimeout(r,0));await auditLive404(store,failed,sample,compare);assert.equal(calls,1,'overlapping failures cannot duplicate the diagnosis');finish();await first;
await auditLive404(store,failed,sample,compare);assert.equal(calls,1,'later scheduled probes cannot restart this completed comparison');
assert.ok(!JSON.stringify([...store.data]).includes(sample.id),'stored/public outcomes cannot contain media IDs or source URLs');
for(const result of [{...failed,type:'series'},{...failed,status:'busy'},{...failed,failure:{phase:'catalog_prepare',httpStatus:404}},{...failed,failure:{phase:'media_headers',httpStatus:503}}])await auditLive404(new Store(),result,sample,()=>{assert.fail('unrelated outcomes must not run the audit')});
const broken=new Store();await auditLive404(broken,failed,sample,async()=>{throw Error('https://private/secret')});assert.ok(!JSON.stringify([...broken.data]).includes('secret'));
const storage=new Store(),controller=new AbortController(),prepared=[],selected=[],session={sid:'owned-probe',token:'fixture-private-token',comparison:true};let rejectRequested=false;
const adapter=ownPlaybackCanaryAdapter({env:{ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'configured-owner'},storage,directory:async()=>Response.json({sample:{type:'live',id:'111',server:'ccf',ext:'m3u8'}}),onSample:s=>selected.push(s),request:async req=>{
 const b=await req.json();assert.equal(b.op,'stream_token','a forced failure sample must never read another catalog');prepared.push(b);
 if(rejectRequested)return Response.json({error:'not_found'},{status:404});
 return Response.json({url:'https://api.snaptvnow.com/stream?t=fixture-ticket'});
}});
const target=await adapter.select(session,{type:'live',sample,transport:'ts'},{signal:controller.signal});assert.equal(target.type,'live');assert.equal(prepared.length,1);assert.equal(prepared[0].id,sample.id);assert.deepEqual(selected,[sample]);
rejectRequested=true;await assert.rejects(adapter.select(session,{type:'live',sample,transport:'ts'},{signal:controller.signal}),e=>e.status===404);assert.equal(prepared.length,2,'a missing audit target must not fall back to another channel');
await assert.rejects(adapter.select(session,{type:'live',sample:{...sample,id:'invalid'},transport:'ts'},{signal:controller.signal}),e=>e.status===400);
let checked=false,released=0;
const paired=await compareOwnPlayback({authenticate:async config=>{assert.equal(config.diagnostic,true);return session},select:async(s,config)=>{assert.deepEqual(config.sample,sample);checked=true;return target},open:async()=>new Response(null,{status:404}),release:async()=>{released++}},async()=>new Response(null,{status:404}),{username:'configured-owner',sample});
assert.equal(checked,true);assert.equal(released,1);assert.equal(paired.verdict,'origin_not_found');assert.ok(!JSON.stringify(paired).includes(sample.id));
console.log('PASS: single atomic 404 audit, exact matched channel/transport, no silent fallback, private target redaction, explicit direct/relay result and owned-session cleanup.');

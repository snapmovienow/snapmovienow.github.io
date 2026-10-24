import assert from 'node:assert/strict';
import {mediaFailureContext} from '../src/monitor-content-context.mjs';
import {OperationsMonitor} from '../src/monitor.mjs';
import worker from '../src/index.js';
const originalNow=Date.now,originalFetch=globalThis.fetch;let now=1800000000000;Date.now=()=>now;
const entry=(id='8471',extra={})=>({type:'live',server:'ccf',id,title:'Example sports channel',lastObservedAt:now-1000,httpStatuses:[404],password:'never-send',account:'private-account',url:'https://private.invalid',...extra});
const context=mediaFailureContext([entry(),entry(),entry('2',{type:'movie'}),entry('3',{lastObservedAt:now+1}),entry('4',{lastObservedAt:now-900001})],'live',null,now);
assert.match(context,/ID 8471/);assert.equal(context.split('\n').length,1);for(const s of ['never-send','private-account','private.invalid','ID 2','ID 3','ID 4'])assert.ok(!context.includes(s));
assert.equal(mediaFailureContext([entry()],'live','another-server',now),'');
assert.ok(!mediaFailureContext([entry('9',{title:'https://private.invalid/?password=secret'})],'live',null,now).includes('secret'));
assert.ok(new TextEncoder().encode(mediaFailureContext(Array.from({length:30},(_,i)=>entry(String(i),{title:'🎬'.repeat(80)})),'live',null,now)).length<=600);
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}}
let healthy=false,metadataReads=0,metadataFail=false;
const sent=[],env={ENVIRONMENT:'production',TICKET_SECRET:'context-test-secret',PLAYBACK_SESSIONS:{idFromName:x=>x,get:()=>({fetch:async url=>{
 const path=new URL(url).pathname;
 if(path==='/monitor-providers')return Response.json({providers:[]});
 if(path==='/operations/monitor')return Response.json({groups:[],timings:[{type:'live',platform:'other',requests:10,failures:healthy?0:3,stages:{total:{p95UpperMs:1000},origin:{p95UpperMs:1000}},statusCounts:healthy?{200:10}:{404:3,200:7}}]});
 if(path==='/accounts/backup-status')return Response.json({automaticStatus:'success',lastAutomaticAt:now});
 if(path==='/monitor-media-failures'){metadataReads++;if(metadataFail)throw Error('private-read-failure');return Response.json({items:[entry()]})}
 throw Error('unexpected path: '+path);
}})}};
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'mock-mail'})};
const monitor=new OperationsMonitor({storage:new Store()},env);
const call=(path,body={})=>monitor.fetch(new Request('https://private'+path,{method:'POST',body:JSON.stringify(body)}));
try{
 const publicResponse=await worker.fetch(new Request('https://example.test/monitor-media-failures',{method:'POST',body:'{}'}),env);assert.ok(publicResponse.status>=400,'private content metadata route must not be exposed over HTTP');
 await call('/settings',{enabled:true,channel:'email',from:'alerts@example.com',to:'owner@example.com',apiKey:'re_test_context_only'});
 await call('/tick');assert.equal(sent.length,1);assert.equal(metadataReads,1);
 assert.deepEqual(sent[0].to,['owner@example.com']);assert.equal(sent[0].from,'alerts@example.com');assert.match(sent[0].text,/ID 8471.*Example sports channel.*HTTP 404/);assert.match(sent[0].text,/no atribuye toda la alerta/);
 for(const value of ['never-send','private-account','private.invalid','test_context_only'])assert.ok(!sent[0].text.includes(value));
 now+=300000;healthy=true;await call('/tick');assert.equal(sent.length,2);assert.equal(metadataReads,1,'healthy snapshots do not need metadata reads');assert.match(sent[1].text,/RECUPERADO/);assert.match(sent[1].text,/Referencia del fallo anterior/);assert.match(sent[1].text,/no confirma la reparación de cada contenido/);assert.match(sent[1].text,/ID 8471/);
 now+=300000;healthy=false;metadataFail=true;await call('/tick');assert.equal(sent.length,3,'missing optional context must not suppress an alert');assert.ok(!sent[2].text.includes('private-read-failure'));assert.ok(!sent[2].text.includes('ID 8471'),'new incident cannot inherit an unrelated previous context');
 console.log('PASS: existing recipient preserved; bounded content metadata on alerts and historical recovery references; no probes, secrets, duplicate emails or blocked alerts on context failure.');
}finally{Date.now=originalNow;globalThis.fetch=originalFetch}

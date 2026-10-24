// Run with installed wrangler dependencies, or SMN_QA_MODULES=/path/node_modules.
// This measures local workerd reservation handling, never real provider video.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const dependency=name=>import(process.env.SMN_QA_MODULES?pathToFileURL(resolve(process.env.SMN_QA_MODULES,name,'dist',name==='esbuild'?'lib/main.js':'src/index.js')).href:name);
// esbuild publishes lib/main.js rather than dist/lib/main.js.
const esbuild=await import(process.env.SMN_QA_MODULES?pathToFileURL(resolve(process.env.SMN_QA_MODULES,'esbuild/lib/main.js')).href:'esbuild');
const {Miniflare,convertV4MiniflareOptions}=await dependency('miniflare');
const here=dirname(fileURLToPath(import.meta.url)),baseline=process.env.SMN_BASELINE_ACCOUNTS;
let source=await readFile(resolve(here,'lease-runtime-worker.mjs'),'utf8');
if(baseline)source=source.replace("'../src/accounts.mjs'",JSON.stringify(baseline));
const built=await esbuild.build({stdin:{contents:source,resolveDir:here,sourcefile:'lease-runtime-worker.mjs'},bundle:true,format:'esm',platform:'browser',write:false});
const options={name:'lease-runtime',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-03',bindings:{PLAYBACK_CANARY_USERNAME:'customer4'},durableObjects:{TEST_DIRECTORY:{className:'LeaseTestDirectory',useSQLite:true}},durableObjectsPersist:false};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
let sequence=0;
const call=async(object,path,body={})=>{
 const start=performance.now(),response=await mf.dispatchFetch('http://localhost'+path+'?object='+encodeURIComponent(object),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();return {status:response.status,data,ms:performance.now()-start};
};
const customer=(i,revision=1)=>({sid:'s'+i,uid:'u'+i,username:'customer'+i,version:1,xtream:true,request_id:'request-'+i+'-'+revision,revision,server:'ccf',mediaKey:'live|ccf|10|m3u8'});
async function parallel(items,concurrency,fn){const out=new Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}));return out}
const metrics=values=>{const sorted=[...values].sort((a,b)=>a-b),percent=p=>Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(3));return {operations:values.length,p50_ms:percent(.5),p95_ms:percent(.95),max_ms:percent(1)}};
const report={timestamp:new Date().toISOString(),version:baseline?'37-baseline':'38',scope:'local workerd SQLite reservation controller; synthetic users/accounts; no real video, upstream or production latency',runtime:'Miniflare/workerd',checks:[],scenarios:[]};
try{
 await mf.ready;
 if(!baseline){
  const object='migration',now=Date.now(),legacy={kept:{sid:'s0',uid:'u0',username:'customer0',version:1,provider_id:'0',until:now+45000,request_id:'request-0-1',mediaKey:'live|ccf|10|m3u8'},expired:{sid:'old',uid:'old',until:now-1}};
  await call(object,'/seed',{count:1,accounts:1,legacy});
  const begun=await call(object,'/accounts/playback-begin',customer(0));assert.equal(begun.status,200);
  const migrated=await call(object,'/inspect',{id:'kept'});assert.equal(migrated.data.count,1);assert.equal(migrated.data.legacy,null);assert.equal(migrated.data.row.request_id,legacy.kept.request_id);assert.equal(migrated.data.marker,2);
  assert.ok(migrated.data.plans.some(row=>/INDEX/.test(row.detail)));assert.ok(migrated.data.sessionPlan.some(row=>/smn_lease_session/.test(row.detail)));
  assert.equal((await call(object,'/accounts/heartbeat',{...customer(0),lease_id:'kept'})).status,200);
  const rollback=await call(object,'/rollback',{id:'kept'});assert.ok(rollback.data.row);assert.equal(rollback.data.kv,null,'SQL and KV writes roll back in one storage transaction');
  await call(object,'/accounts/playback-begin',customer(0,2));const retry=await call(object,'/accounts/acquire',customer(0,2));assert.equal(retry.data.lease_id,'kept');assert.equal(retry.data.reused,true);
  await call(object,'/accounts/release',{...customer(0),lease_id:'kept'});assert.equal((await call(object,'/inspect',{id:'kept'})).data.count,1,'old request cannot delete a replacement');
  assert.equal((await call(object,'/accounts/heartbeat',{...customer(0),lease_id:'kept'})).status,410);
  assert.equal((await call(object,'/accounts/heartbeat',{...customer(0,2),lease_id:'kept'})).status,200);
  await mf.unsafeEvictDurableObject('lease-runtime','LeaseTestDirectory',{name:object});
  const restarted=await call(object,'/inspect',{id:'kept'});assert.equal(restarted.data.count,1);assert.equal(restarted.data.row.request_id,'request-0-2');assert.ok(restarted.data.row.until>legacy.kept.until);assert.equal(restarted.data.legacy,null);assert.equal(restarted.data.marker,2);
  assert.equal((await call(object,'/accounts/heartbeat',{...customer(0,2),lease_id:'kept'})).status,200);
  await call(object,'/expire',{id:'kept'});assert.equal((await call(object,'/accounts/heartbeat',{...customer(0,2),lease_id:'kept'})).status,410);assert.equal((await call(object,'/inspect')).data.count,0);
  report.checks.push('real SQLite migration preserves live lease IDs/tickets and removes expired rows','primary-key/session indexes used','SQL/KV atomic rollback','same-media retry reuses one reservation','old cleanup/heartbeat cannot affect replacement','renewed lease and ownership survive Durable Object eviction/restart','expired heartbeat cannot resurrect lease');
  // Simultaneous requests for the same playback have one physical reservation.
  const race='race';await call(race,'/seed',{count:5,accounts:1});await call(race,'/accounts/playback-begin',customer(0));
  const repeated=await parallel(Array.from({length:30},(_,i)=>i),30,()=>call(race,'/accounts/acquire',customer(0)));assert.ok(repeated.every(r=>r.status===200));assert.equal(new Set(repeated.map(r=>r.data.lease_id)).size,1);
  const spare=await parallel([1,2,3,4],4,async i=>{await call(race,'/accounts/playback-begin',customer(i));return call(race,'/accounts/acquire',customer(i))});assert.equal(spare.filter(r=>r.status===200).length,2);assert.equal(spare.filter(r=>r.status===409).length,2);
  assert.equal((await call(race,'/accounts/heartbeat',{...customer(1),lease_id:repeated[0].data.lease_id})).status,410);
  assert.equal((await call(race,'/inspect')).data.count,3);await call(race,'/accounts/release-session',{sid:'s0'});assert.equal((await call(race,'/inspect')).data.count,2);
  report.checks.push('30 duplicate concurrent starts allocate one lease','three-slot provider capacity enforced under simultaneous starts','foreign ownership denied','session close frees exactly its own slot');
  const affinityObject='affinity';await call(affinityObject,'/seed',{count:4,accounts:2});
  const a=customer(0);await call(affinityObject,'/accounts/playback-begin',a);const pinned=await call(affinityObject,'/accounts/acquire',a);
  assert.equal(pinned.status,200);const originalProvider=pinned.data.provider_id;
  for(let revision=2;revision<10;revision++){
   const body={...customer(0,revision),mediaKey:'live|ccf|'+revision+'|'+(revision%2?'ts':'m3u8')};
   await call(affinityObject,'/accounts/playback-begin',body);const replacement=await call(affinityObject,'/accounts/acquire',body);
   assert.equal(replacement.data.provider_id,originalProvider);assert.equal((await call(affinityObject,'/inspect')).data.count,1);
   if(revision===2){await call(affinityObject,'/accounts/release',{...a,lease_id:pinned.data.lease_id});assert.equal((await call(affinityObject,'/inspect')).data.count,1);}
   await call(affinityObject,'/accounts/release',{...body,lease_id:replacement.data.lease_id});assert.equal((await call(affinityObject,'/inspect')).data.count,0);
   await mf.unsafeEvictDurableObject('lease-runtime','LeaseTestDirectory',{name:affinityObject});
  }
  report.checks.push('sticky CCF assignment across channels/formats and TS close gaps survives DO eviction without reserving idle capacity or accepting delayed old cleanup');
  const totalsObject='summary-pages',totalsAccount='summary-fixture';
  await call(totalsObject,'/seed',{count:201,accounts:70,resellerAccountId:totalsAccount});
  const summaryStarts=[customer(0),{...customer(0),sid:'second-device-0',request_id:'second-request-0'},customer(100),customer(200)];
  for(const playback of summaryStarts){assert.equal((await call(totalsObject,'/accounts/playback-begin',playback)).status,200);assert.equal((await call(totalsObject,'/accounts/acquire',playback)).status,200);}
  const totals=await call(totalsObject,'/accounts/reseller-playback-summary',{accountId:totalsAccount});assert.equal(totals.status,200);assert.equal(totals.data.connectionsUsed,4);assert.equal(totals.data.linesOnline,3);
  const liveRows=await call(totalsObject,'/accounts/reseller-live-connections',{accountId:totalsAccount,page:1,pageSize:50});assert.equal(liveRows.status,200);assert.equal(liveRows.data.rows.length,4);assert.equal(liveRows.data.connectionsUsed,4);assert.equal(liveRows.data.rows.filter(r=>r.username==='customer0').length,2);assert.ok(!JSON.stringify(liveRows.data).includes('request_id'));
  await call(totalsObject,'/accounts/release-session',{sid:'s0'});await call(totalsObject,'/accounts/release-session',{sid:'second-device-0'});
  const fewer=await call(totalsObject,'/accounts/reseller-playback-summary',{accountId:totalsAccount});assert.equal(fewer.data.connectionsUsed,2);assert.equal(fewer.data.linesOnline,2);
  report.checks.push('real SQLite dashboard totals span 201 paginated customers and distinguish concurrent devices from online users');
  const priority='customer-priority';await call(priority,'/seed',{count:5,accounts:1});
  const probe={...customer(4),canary:true};await call(priority,'/accounts/playback-begin',probe);
  const probing=await call(priority,'/accounts/acquire',probe);assert.equal(probing.status,200);assert.equal((await call(priority,'/inspect',{id:probing.data.lease_id})).data.row.canary,true);
  const firstCustomer=customer(0);await call(priority,'/accounts/playback-begin',firstCustomer);const firstArrival=await call(priority,'/accounts/acquire',firstCustomer);assert.equal(firstArrival.status,200);
  assert.equal((await call(priority,'/accounts/lease-check',{...probe,lease_id:probing.data.lease_id})).status,200,'a real SQLite allocation with spare capacity preserves the probe');
  const arrivals=[firstArrival,...await Promise.all([1,2].map(async i=>{const c=customer(i);await call(priority,'/accounts/playback-begin',c);return call(priority,'/accounts/acquire',c)}))];
  assert.ok(arrivals.every(r=>r.status===200),'three customers acquire capacity atomically while the probe yields');
  assert.equal((await call(priority,'/accounts/lease-check',{...probe,lease_id:probing.data.lease_id})).status,410);
  assert.equal((await call(priority,'/inspect')).data.count,3);
  await call(priority,'/accounts/release',{...probe,lease_id:probing.data.lease_id});assert.equal((await call(priority,'/inspect')).data.count,3,'late probe cleanup cannot release a customer');
  assert.equal((await call(priority,'/accounts/acquire',probe)).status,409,'a probe cannot displace full customer capacity');
  assert.equal((await call(priority,'/accounts/canary-identity',{username:'customer4'})).status,409,'a full provider defers the test before it can fetch catalogs');
  await call(priority,'/accounts/release',{...customer(2),lease_id:arrivals[2].data.lease_id});
  assert.equal((await call(priority,'/accounts/acquire',probe)).status,409,'a probe must leave the final free slot for customers');
  assert.equal((await call(priority,'/accounts/canary-identity',{username:'customer4'})).status,409);
  const spoof={...customer(3),canary:true};await call(priority,'/accounts/playback-begin',spoof);const forged=await call(priority,'/accounts/acquire',spoof);
  assert.equal(forged.status,200);assert.equal((await call(priority,'/inspect',{id:forged.data.lease_id})).data.row.canary,undefined,'only the configured owner can hold a background lease');
  const labels='deferred-labels';await call(labels,'/seed',{count:2,accounts:1});const owner=customer(0);
  await call(labels,'/accounts/playback-begin',owner);const labeled=await call(labels,'/accounts/acquire',owner),labelBody={...owner,lease_id:labeled.data.lease_id,activity:{title:'Verified channel'}};
  assert.equal((await call(labels,'/accounts/playback-activity',labelBody)).status,200);assert.equal((await call(labels,'/inspect',{id:labeled.data.lease_id})).data.row.activity.title,'Verified channel');
  assert.equal((await call(labels,'/accounts/playback-activity',{...labelBody,uid:'u1'})).status,410);
  const newer={...customer(0,2),mediaKey:'live|ccf|11|ts'};await call(labels,'/accounts/playback-begin',newer);await call(labels,'/accounts/acquire',newer);
  assert.equal((await call(labels,'/accounts/playback-activity',labelBody)).status,410,'a late catalog label cannot update a changed channel');
  report.checks.push('customer starts atomically preempt only the configured background canary, reserve its final slot and preserve all customer leases','deferred metadata attaches only to its current owned lease and cannot cross users or channel revisions');
  console.log('PASS workerd SQLite safety/migration/concurrency, customer priority and deferred metadata ownership checks');
 }
 const levels=process.env.SMN_SAFETY_ONLY?[]:baseline?[500,1000]:[100,250,500,1000];
 for(const count of levels){
  const object='load-'+(++sequence),accounts=Math.ceil(count/3),indexes=Array.from({length:count},(_,i)=>i),concurrency=50;
  await call(object,'/seed',{count:count+10,accounts});
  const start=performance.now();
  const allocated=await parallel(indexes,concurrency,async i=>{const b=customer(i);const t=performance.now();assert.equal((await call(object,'/accounts/playback-begin',b)).status,200);const r=await call(object,'/accounts/acquire',b);return {...r,ms:performance.now()-t}});
  assert.ok(allocated.every(r=>r.status===200),JSON.stringify(allocated.find(r=>r.status!==200)));
  const allocationDuration=performance.now()-start;
  const heartbeat=[];const heartStart=performance.now();
  for(let round=0;round<10;round++){
   const responses=await parallel(indexes,concurrency,i=>call(object,'/accounts/heartbeat',{...customer(i),lease_id:allocated[i].data.lease_id}));
   assert.ok(responses.every(r=>r.status===200),JSON.stringify(responses.find(r=>r.status!==200)));heartbeat.push(...responses.map(r=>r.ms));
  }
  const heartDuration=performance.now()-heartStart;
  const rejected=await parallel(Array.from({length:10},(_,i)=>count+i),10,async i=>{await call(object,'/accounts/playback-begin',customer(i));return call(object,'/accounts/acquire',customer(i))});
  assert.equal(rejected.filter(r=>r.status===200).length,accounts*3-count);assert.equal((await call(object,'/accounts/overview')).data.connections,accounts*3);
  const closeStart=performance.now();const closed=await parallel(Array.from({length:count+10},(_,i)=>i),concurrency,i=>call(object,'/accounts/release-session',{sid:'s'+i}));assert.ok(closed.every(r=>r.status===200));assert.equal((await call(object,'/accounts/overview')).data.connections,0);
  const scenario={active_reservations:count,provider_accounts:accounts,concurrency,allocation:{...metrics(allocated.map(r=>r.ms)),elapsed_ms:Number(allocationDuration.toFixed(2))},heartbeat:{...metrics(heartbeat),elapsed_ms:Number(heartDuration.toFixed(2)),operations_per_second:Number((heartbeat.length*1000/heartDuration).toFixed(2)),errors:0},close:{...metrics(closed.map(r=>r.ms)),elapsed_ms:Number((performance.now()-closeStart).toFixed(2)),remaining_reservations:0},capacity_enforced:true};
  report.scenarios.push(scenario);console.log(JSON.stringify(scenario));
 }
 if(process.env.SMN_LOAD_REPORT){await mkdir(dirname(resolve(process.env.SMN_LOAD_REPORT)),{recursive:true});await writeFile(process.env.SMN_LOAD_REPORT,JSON.stringify(report,null,2)+'\n')}
 console.log(process.env.SMN_SAFETY_ONLY?'PASS: local SQLite safety checks completed.':'PASS: local reservation load completed; results do not certify provider streaming capacity.');
}finally{await mf.dispose()}

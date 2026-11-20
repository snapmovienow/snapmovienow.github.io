import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleServiceMonitor,readServiceMonitor,recordServiceMetric,MONITOR_BINS,monitorPercentile} from '../src/service-monitor.mjs';
const now=1800000000000;
function fixture(){const values=new Map(),userReads={batches:[],lists:0},clone=v=>v===undefined?undefined:structuredClone(v);const store={async get(k){if(Array.isArray(k)){userReads.batches.push([...k]);return new Map(k.filter(key=>values.has(key)).map(key=>[key,clone(values.get(key))]));}return clone(values.get(k));},async put(k,v){values.set(k,clone(v));},async delete(k){for(const key of Array.isArray(k)?k:[k])values.delete(key);},async list({prefix,startAfter,limit=1000}={}){if(prefix==='user:')userReads.lists++;return new Map([...values].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([k,v])=>[k,clone(v)]));}};const active=new Map(),leases={async active(){return active;}};
const user=(id,account,status='active')=>({id,version:1,status,resellerBridge:{accountId:account,lineId:id}});values.set('user:alice',user('u1','panel-a'));values.set('user:bob',user('u2','panel-b'));values.set('user:expired',{...user('u3','panel-a'),expiresAt:now-1});
active.set('one',{uid:'u1',version:1,mediaKey:'live|ccf|100|ts'});active.set('two',{uid:'u1',version:1,mediaKey:'series|ccf|101|mp4'});active.set('other',{uid:'u2',version:1,mediaKey:'live|ccf|102|ts'});active.set('expired',{uid:'u3',version:1,mediaKey:'live|ccf|103|ts'});active.set('old-version',{uid:'u1',version:0,mediaKey:'live|ccf|104|ts'});return {values,store,leases,active,userReads};}
const metric={type:'live',quality:'other',server:'ccf',platform:'android',report_id:'report-00001',attempted:true,failedStart:false,watchMs:30000,stallMs:0,stalls:0,errors:0,decoded:30,dropped:0,startupMs:2200,started:true,bytes:3000000};
test('counts cover all owned leases, deduplicate users and isolate resellers/types',async()=>{const f=fixture();await sampleServiceMonitor(f.store,f.leases,['panel-a','panel-b'],now-300000);const all=await (await readServiceMonitor(f.store,f.leases,{accountId:'panel-a'},now)).json();assert.deepEqual(all.current,{connections:2,users:1});assert.ok(all.points.some(p=>p.connections===null),'unobserved history stays missing');assert.equal(all.points.filter(p=>p.connections!==null).length,2);const live=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-a',content:'live'},now)).json();assert.deepEqual(live.current,{connections:1,users:1});const b=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-b'},now)).json();assert.deepEqual(b.current,{connections:1,users:1});assert.equal(JSON.stringify(all).includes('alice'),false);assert.equal(JSON.stringify(all).includes('u1'),false);});
test('quality uses verified lease media and account; duplicate/rate-limited observations do not inflate totals',async()=>{const f=fixture(),lease=f.active.get('one'),user=f.values.get('user:alice');assert.equal(await recordServiceMetric(f.store,lease,user,metric,now),true);assert.equal(await recordServiceMetric(f.store,lease,user,metric,now+16000),false);assert.equal(await recordServiceMetric(f.store,lease,user,{...metric,report_id:'report-00002'},now+1000),false);const result=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-a'},now+20000)).json();assert.equal(result.summary.bytes,3000000);assert.equal(result.summary.reports,1);assert.equal(monitorPercentile(result.summary.histogram),3000);assert.equal(result.inputMeasured,false);const other=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-b'},now+20000)).json();assert.equal(other.summary.reports,0);const movie=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-a',content:'movie'},now+20000)).json();assert.equal(movie.summary.reports,0);});
test('seven-day reads stay bounded and retention removes only old monitor records',async()=>{const f=fixture();f.values.set('service-monitor-counts:panel-a:'+Math.floor((now-9*86400000)/3600000),{});f.values.set('unrelated:protected',{keep:true});await sampleServiceMonitor(f.store,f.leases,['panel-a','panel-b'],now);const r=await(await readServiceMonitor(f.store,f.leases,{accountId:'panel-a',hours:168},now)).json();assert.ok(r.points.length<=170);assert.deepEqual(r.bins,MONITOR_BINS);assert.equal([...f.values.keys()].some(k=>k.endsWith(':'+Math.floor((now-9*86400000)/3600000))),false);assert.deepEqual(f.values.get('unrelated:protected'),{keep:true});});
test('malformed query and unowned/invalid metrics are rejected',async()=>{const f=fixture();for(const body of [{hours:2},{content:'unknown'},{provider:'https://private/'},{accountId:'../other'}])assert.equal((await readServiceMonitor(f.store,f.leases,{accountId:'panel-a',...body},now)).status,400);assert.equal(await recordServiceMetric(f.store,f.active.get('one'),{id:'standalone'},metric,now),false);assert.equal(await recordServiceMetric(f.store,f.active.get('one'),f.values.get('user:alice'),{...metric,bytes:-1},now),false);});

test('monitor loads only active lease owners, including mixed case spelling, without scanning idle accounts',async()=>{
 const f=fixture(),names={u1:'ALIce',u2:'Bob',u3:'expired'};
 for(const lease of f.active.values())lease.username=names[lease.uid];
 for(let i=0;i<1000;i++)f.values.set('user:idle'+i,{id:'idle'+i,version:1,status:'active',resellerBridge:{accountId:'panel-a'}});
 f.active.set('invalid',{uid:'missing',version:1,mediaKey:'invalid'});
 const counts=await sampleServiceMonitor(f.store,f.leases,['panel-a'],now);
 assert.deepEqual(counts.get('panel-a').find(row=>row.type==='all'&&row.server==='all'),{type:'all',server:'all',connections:2,users:1});
 assert.deepEqual(f.userReads,{batches:[['user:alice','user:bob','user:expired']],lists:0});
 f.active.clear();
 const empty=await readServiceMonitor(f.store,f.leases,{accountId:'panel-a'},now);
 assert.deepEqual((await empty.json()).current,{connections:0,users:0});
 assert.deepEqual(f.userReads,{batches:[['user:alice','user:bob','user:expired']],lists:0});
});

test('stale and legacy lease names resolve using stable account IDs across storage pages',async()=>{
 const f=fixture();
 f.active.clear();
 for(let i=0;i<110;i++)f.values.set('user:middle'+i,{id:'unused'+i});
 f.values.set('user:z-renamed',f.values.get('user:alice'));
 f.values.delete('user:alice');
 f.active.set('renamed',{username:'bob',uid:'u1',version:1,mediaKey:'movie|ccf|100|mp4'});
 f.active.set('legacy',{uid:'u1',version:1,mediaKey:'live|ccf|101|ts'});
 const counts=await sampleServiceMonitor(f.store,f.leases,['panel-a','panel-b'],now);
 assert.equal(counts.get('panel-a').find(row=>row.type==='all'&&row.server==='all').connections,2);
 assert.deepEqual(counts.get('panel-b'),[]);
 assert.deepEqual(f.userReads,{batches:[['user:bob']],lists:2});
});

test('large active sets stay within the storage bulk read limit',async()=>{
 const f=fixture();
 f.active.clear();
 for(let i=0;i<210;i++){
  const username='active'+i;
  f.values.set('user:'+username,{id:username,version:1,status:'active',resellerBridge:{accountId:'panel-a'}});
  f.active.set(username,{username,uid:username,version:1,mediaKey:'live|ccf|102|ts'});
 }
 const counts=await sampleServiceMonitor(f.store,f.leases,['panel-a'],now);
 assert.equal(counts.get('panel-a').find(row=>row.type==='all'&&row.server==='all').users,210);
 assert.deepEqual(f.userReads.batches.map(batch=>batch.length),[100,100,10]);
 assert.equal(f.userReads.lists,0);
});

test('ordinary hourly pruning deletes just newly expired keys across known and retired scopes',async()=>{
 const f=fixture(),hour=3600000,base=Math.floor(now/hour)*hour,old=Math.ceil((base-7*86400000-hour)/hour);
 const kept='service-monitor-counts:retired:'+old;
 for(const prefix of ['service-monitor-counts:','service-monitor-quality:']){
  for(const account of ['panel-a','retired'])for(let i=old-1;i<=old+168;i++)f.values.set(prefix+account+':'+i,{});
 }
 const calls=[],list=f.store.list;
 f.store.list=async options=>{if(options.prefix.startsWith('service-monitor-'))calls.push(options.prefix);return list(options);};
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base);
 assert.ok(calls.length>0);
 assert.ok(f.values.has(kept),'strict cutoff keeps the boundary hour');
 calls.length=0;
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base+hour);
 assert.ok(f.values.has(kept),'exactly one hour does not trigger a second prune');
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base+hour+1);
 assert.deepEqual(calls,[],'routine prune does not read retained history');
 for(const prefix of ['service-monitor-counts:','service-monitor-quality:']){
  for(const account of ['panel-a','retired']){
   assert.ok(!f.values.has(prefix+account+':'+(old+1)));
   assert.ok(f.values.has(prefix+account+':'+(old+2)));
  }
 }
});

test('sparse, new and retired scopes survive clock changes and are pruned after missed schedules',async()=>{
 const f=fixture(),hour=3600000,base=Math.floor(now/hour)*hour,cutoff=Math.ceil((base-7*86400000-hour)/hour);
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base);
 await sampleServiceMonitor(f.store,f.leases,['panel-temporary'],base+300000);
 assert.ok(f.values.get('service-monitor-retention-scopes').includes('panel-temporary'));
 const user={...f.values.get('user:alice'),resellerBridge:{accountId:'legacy:retired'}};
 await recordServiceMetric(f.store,f.active.get('one'),user,metric,base+1000);
 assert.ok(f.values.get('service-monitor-retention-scopes').includes('legacy:retired'));
 const key='service-monitor-quality:legacy:retired:'+cutoff;
 f.values.set(key,{});
 const cursor=f.values.get('service-monitor-pruned');
 const del=f.store.delete;
 let failed=false;
 f.store.delete=async keys=>{if(Array.isArray(keys)&&!failed){failed=true;throw Error('interrupted');}return del(keys);};
 await assert.rejects(()=>sampleServiceMonitor(f.store,f.leases,['panel-a'],base+hour+1),/interrupted/);
 assert.equal(f.values.get('service-monitor-pruned'),cursor);
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base+hour+1);
 assert.equal(f.values.has(key),false);
 f.values.set(key,{});
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base-2*hour);
 assert.ok(f.values.has(key),'a backwards clock retains unexpired history');
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],base+30*hour);
 assert.equal(f.values.has(key),false,'long outages reconcile existing history');
});

test('long idle periods skip intermediate history writes and active sessions resume the five-minute sample',async()=>{
 const f=fixture(),step=300000,start=Math.floor(now/(3*step))*3*step;
 f.active.clear();
 for(let n=0;n<=4;n++)await sampleServiceMonitor(f.store,f.leases,['panel-a'],start+n*step);
 const records=()=>Object.values(f.values.get('service-monitor-counts:panel-a:'+Math.floor(start/3600000)));
 assert.deepEqual(records().map(row=>row.at),[start,start+3*step]);
 f.active.set('back',{username:'alice',uid:'u1',version:1,mediaKey:'live|ccf|101|ts'});
 await sampleServiceMonitor(f.store,f.leases,['panel-a'],start+5*step);
 assert.equal(records().at(-1).rows[0].connections,1);
});

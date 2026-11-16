import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {serverDiagnosticSnapshot} from '../src/server-diagnostic-snapshot.mjs';
import {INVENTORY_MAX_AGE_MS} from '../src/provider-inventory.mjs';

const now=Date.UTC(2026,10,16,22);
const line=(id,extra={})=>({id,key:'physical-'+id,server:'ccf',maxConnections:3,external:0,sourceIds:['private-source'],encrypted:'private-credential',username:'private-account',...extra});
class Store{
 constructor(values={},sql=true){
  this.data=structuredClone(values);this.reads=[];this.queries=[];
  if(sql){this.db=new DatabaseSync(':memory:');this.sql={exec:(query,...args)=>{this.queries.push(query);assert.match(query,/^SELECT /,'diagnostic SQL must be read-only');const rows=this.db.prepare(query).all(...args);return {toArray:()=>rows};}};}
 }
 async get(key){this.reads.push(key);return structuredClone(this.data[key]);}
 async put(){assert.fail('snapshot may not write storage');}
 async delete(){assert.fail('snapshot may not delete storage');}
 async list(){assert.fail('snapshot may not enumerate private records');}
 schema(){this.db.exec('CREATE TABLE smn_playback_leases(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,until INTEGER NOT NULL,data TEXT NOT NULL)');}
 lease(id,provider,until=now+90000){this.db.prepare('INSERT INTO smn_playback_leases VALUES(?,?,?,?)').run(id,provider,until,JSON.stringify({username:'private-viewer',password:'private-password',rotation:{secret:'private-proposal'}}));}
}
function fixture(lines=[line('a')]){
 return {providers:[{source:'private-source',username:'private-owner',encrypted:'private-panel-secret'}],pool:{lines,syncedAt:now-1000,attemptedAt:now-1000},'source-pools':{'private-source':{lines,syncedAt:now-1000,inventory:lines}},'provider-rotation-stats':{completed:4,lastCompletedAt:now-5000}};
}
const forbidden=['private-credential','private-account','private-source','private-owner','private-panel-secret','private-viewer','private-password','private-proposal','physical-'];
function privateProjection(snapshot){for(const secret of forbidden)assert.ok(!JSON.stringify(snapshot).includes(secret),secret+' must not be serialized');}

test('real SQLite counts saved reservations conservatively without initialization, identities or mutations',async()=>{
 const lines=[line('a',{key:'shared',maxConnections:3,external:1}),line('b',{key:'shared',maxConnections:2}),line('c')],values=fixture(lines),store=new Store(values);store.schema();
 store.lease('request-a','a');store.lease('request-b','b');store.lease('request-c','c');store.lease('request-unmatched','old-provider');store.lease('request-expired','c',now);store.lease('request-local','');
 const before=JSON.stringify(store.data),sqlBefore=store.db.prepare('SELECT * FROM smn_playback_leases ORDER BY id').all();
 const result=await serverDiagnosticSnapshot(store,{now,rotationEnabled:false});
 assert.equal(result.inventory.state,'available');assert.equal(result.inventory.physicalAccounts,2);assert.equal(result.inventory.eligibleAccounts,2);assert.equal(result.inventory.totalCapacity,5);assert.equal(result.inventory.reported,1);assert.equal(result.inventory.reserved,4);assert.equal(result.inventory.available,2);assert.equal(result.inventory.unmatchedProviderReservations,1);
 assert.deepEqual(result.rotation,{policy:{...result.rotation.policy,enabled:false},statsStatus:'available',completed:4,lastCompletedAt:now-5000});
 assert.equal(result.rotation.policy.confirmation,'account-and-media');assert.equal(result.readOnly,true);assert.equal(result.limitations.providerRequestsPerformed,false);assert.equal(result.limitations.playbackValidated,false);assert.equal(result.limitations.reservationsAreViewers,false);
 assert.deepEqual(result.readFailures,[]);assert.equal(JSON.stringify(store.data),before);assert.deepEqual(store.db.prepare('SELECT * FROM smn_playback_leases ORDER BY id').all(),sqlBefore);privateProjection(result);
});

test('missing SQL or schema is unknown, never an invented empty reservation count',async()=>{
 for(const sql of [false,true]){
  const store=new Store(fixture(),sql),result=await serverDiagnosticSnapshot(store,{now});
  assert.equal(result.leases.status,'unknown');assert.equal(result.leases.reason,sql?'schema_unavailable':'sql_unavailable');assert.equal(result.inventory.state,'partial');assert.equal(result.inventory.reserved,null);assert.equal(result.inventory.available,null);
  assert.equal(result.inventory.totalCapacity,3);assert.equal(result.inventory.freshnessVerified,true);
  if(sql)assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='smn_playback_leases'").get().n,0,'read must not create the lease table');
 }
});

test('unattributed inventory with stale or future timestamps cannot report a fresh available state',async()=>{
 for(const syncedAt of [now-INVENTORY_MAX_AGE_MS,now+1000]){
  const store=new Store({pool:{lines:[],syncedAt,attemptedAt:syncedAt}});store.schema();
  const result=await serverDiagnosticSnapshot(store,{now});assert.equal(result.inventory.state,'partial');assert.equal(result.inventory.freshnessVerified,false);
 }
});

test('stale, retained and missing source observations remain explicit and do not make all sources fresh',async()=>{
 const old=line('old'),fresh=line('fresh'),store=new Store({providers:[{source:'old'},{source:'fresh'},{source:'missing'}],pool:{lines:[old,fresh],syncedAt:now-INVENTORY_MAX_AGE_MS,attemptedAt:now,sourceBacked:true},'source-pools':{old:{lines:[old],syncedAt:now-INVENTORY_MAX_AGE_MS,attemptedAt:now},fresh:{lines:[fresh],syncedAt:now-1000}}});store.schema();
 const result=await serverDiagnosticSnapshot(store,{now});
 assert.equal(result.inventory.state,'partial');assert.equal(result.inventory.configuredSources,3);assert.equal(result.inventory.observedSources,2);assert.equal(result.inventory.freshSources,1);assert.equal(result.inventory.staleSources,1);assert.equal(result.inventory.missingSources,1);assert.equal(result.inventory.retainedAfterFailedRefresh,1);
 assert.equal(result.inventory.physicalAccounts,1,'expired source is removed only from the read-only view');assert.equal(result.inventory.available,3);assert.equal(store.data.pool.lines.length,2,'stored pool remains unchanged');assert.equal(result.health.status,'unobserved');assert.equal(result.rotation.statsStatus,'not_recorded');assert.equal(result.rotation.completed,null);
});

test('exact mapping checks aggregate roundtrip inconsistencies without disclosing registry records',async()=>{
 const store=new Store({...fixture(),'xtream-id:12':{id:12,kind:'live',server:'ccf',upstreamId:'987654321'},'xtream-map:live:ccf:987654321':12,'xtream-id:13':{id:13,kind:'live',server:'ccf',upstreamId:'987654322'},'xtream-map:live:ccf:987654322':99});store.schema();
 const result=await serverDiagnosticSnapshot(store,{now,queries:[{publicId:'12'},{publicId:'13'},{publicId:'14'}]});
 assert.deepEqual(result.mapping,{status:'available',checked:3,registered:1,inconsistent:1,notRegistered:1,samples:[{queryIndex:0,state:'registered',kind:'live',publicId:'12',upstreamId:'987654321'},{queryIndex:1,state:'registry_inconsistent',publicId:'13'},{queryIndex:2,state:'not_registered',publicId:'14'}],catalogCurrentVerified:false,mediaHealthVerified:false});
 assert.ok(!('references' in result.mapping));assert.ok(result.mapping.samples.every(sample=>!('server' in sample)));privateProjection(result);
});

test('mapping samples preserve validated numeric repair references without raw servers or malformed stored values',async()=>{
 const values={...fixture(),'xtream-map:episode:private_server:1234':88,'xtream-id:88':{id:88,kind:'episode',server:'private_server',upstreamId:'1234'},'xtream-id:89':{id:89,kind:'live',server:'ccf',upstreamId:'https://private-credential'}};
 const store=new Store(values);store.schema();const result=await serverDiagnosticSnapshot(store,{now,queries:[{kind:'episode',server:'private_server',upstreamId:'1234'},{publicId:'89'}]});
 assert.deepEqual(result.mapping.samples,[{queryIndex:0,state:'registered',kind:'episode',publicId:'88',upstreamId:'1234'},{queryIndex:1,state:'registry_inconsistent',publicId:'89'}]);
 assert.ok(!JSON.stringify(result).includes('private_server'));privateProjection(result);
});

test('invalid or oversized mapping requests cannot trigger arbitrary key scans',async()=>{
 for(const queries of [null,[{publicId:'../../secret'}],Array.from({length:11},(_,n)=>({publicId:String(n+1)})),[{publicId:'1',extra:'forbidden'}]]){
  const store=new Store(fixture()),result=await serverDiagnosticSnapshot(store,{now,queries});assert.equal(result.mapping.status,'invalid_queries');assert.ok(!store.reads.some(key=>key.startsWith('xtream-')));
 }
});

test('storage failures produce unavailable sections and bounded labels, not successful empty data',async()=>{
 const store=new Store(fixture());store.schema();store.get=async key=>{if(['pool','provider-health','provider-rotation-stats'].includes(key))throw Error('https://secret-provider/password');return structuredClone(store.data[key]);};
 store.sql.exec=()=>{throw Error('private-sql-error')};
 const result=await serverDiagnosticSnapshot(store,{now});
 assert.equal(result.inventory.state,'unavailable');assert.equal(result.inventory.physicalAccounts,null);assert.equal(result.inventory.available,null);assert.equal(result.health.status,'unavailable');assert.equal(result.rotation.statsStatus,'unavailable');assert.equal(result.leases.status,'unknown');assert.equal(result.leases.reason,'read_failed');assert.deepEqual(result.readFailures,['pool','health','rotation','leases']);
 assert.ok(!JSON.stringify(result).includes('secret-provider'));assert.ok(!JSON.stringify(result).includes('private-sql-error'));
});

test('active reservation grouping has a fixed upper bound and does not decode lease payloads',async()=>{
 const store=new Store(fixture());store.schema();const insert=store.db.prepare('INSERT INTO smn_playback_leases VALUES(?,?,?,?)');for(let n=0;n<1001;n++)insert.run(String(n),'provider-'+n,now+1,'invalid JSON must not be decoded');
 const result=await serverDiagnosticSnapshot(store,{now});assert.equal(result.leases.status,'unknown');assert.equal(result.leases.reason,'too_many_groups');assert.equal(result.inventory.available,null);assert.equal(result.inventory.reserved,null);assert.ok(store.queries.some(query=>query.endsWith('LIMIT 1001')));privateProjection(result);
});

test('health projection preserves evidence labels but never returns provider account or lease IDs',async()=>{
 const id='private-provider-id',media='live|ccf|123|ts',store=new Store({...fixture(),'provider-health':{['channel|'+media+'|'+id]:{at:now-1000,ok:false,httpStatus:504,errorOrigin:'local_deadline',serviceError:'live_startup_timeout',failures:3,openUntil:now+30000},['account|'+id]:{at:now-1000,ok:false,openUntil:now+30000,credentialKey:'private-credential-key'}}});store.schema();
 const result=await serverDiagnosticSnapshot(store,{now});assert.equal(result.health.status,'available');assert.equal(result.health.circuits.length,2);assert.equal(result.health.recentMediaFailures[0].failureCauses[0].errorOrigin,'local_deadline');assert.ok(!JSON.stringify(result).includes(id));assert.ok(!JSON.stringify(result).includes('private-credential-key'));privateProjection(result);
});

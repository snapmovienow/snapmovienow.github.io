// Passive infrastructure diagnostics. Read saved observations only: no account
// enumeration, lease migration/pruning, provider requests or business writes.
import {INVENTORY_MAX_AGE_MS,readInventoryPool} from './provider-inventory.mjs';
import {usableProvider} from './provider-assignment.mjs';
import {providerHealthSummary} from './provider-health.mjs';
import {ROTATION_POLICY} from './provider-rotation-state.mjs';
import {readXtreamReferences} from './xtream-reference-diagnostic.mjs';

const MAX_LEASE_GROUPS=1000;
const count=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;
const timestamp=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now?value:null;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const observed=(value,now)=>timestamp(value?.syncedAt,now)!==null&&Array.isArray(value?.lines);
const membership=line=>Array.isArray(line?.sourceIds)&&line.sourceIds.length>0&&line.sourceIds.every(value=>typeof value==='string'&&value.length>0);
const capacity=line=>Math.min(3,count(line?.maxConnections));
async function read(operation){try{return {ok:true,value:await operation()};}catch{return {ok:false};}}

async function reservationCounts(store,now){
 const unknown=reason=>({status:'unknown',reason,counts:null,reserved:null});
 if(!store.sql?.exec)return unknown('sql_unavailable');
 try{
  // A diagnostic must not call openLeaseStore: that can initialize/migrate it.
  const exists=store.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='smn_playback_leases' LIMIT 1").toArray();
  if(!exists.length)return unknown('schema_unavailable');
  const rows=store.sql.exec('SELECT provider_id,COUNT(*) AS total FROM smn_playback_leases WHERE until > ? AND provider_id <> ? GROUP BY provider_id LIMIT '+(MAX_LEASE_GROUPS+1),now,'').toArray();
  if(rows.length>MAX_LEASE_GROUPS)return unknown('too_many_groups');
  const counts=new Map();let reserved=0;
  for(const row of rows){
   if(typeof row.provider_id!=='string'||!row.provider_id||!Number.isSafeInteger(row.total)||row.total<0)return unknown('invalid_rows');
   counts.set(row.provider_id,row.total);reserved+=row.total;
   if(!Number.isSafeInteger(reserved))return unknown('invalid_rows');
  }
  return {status:'available',counts,reserved};
 }catch{return unknown('read_failed');}
}

function inventorySummary(results,reservations,now){
 const {pool:poolRead,configured:configuredRead,legacy:legacyRead,sources:sourcesRead}=results;
 const pool=poolRead.value,snapshots=object(sourcesRead.value)?sourcesRead.value:{};
 const configured=Array.isArray(configuredRead.value)?configuredRead.value:null;
 const legacy=object(legacyRead.value)?legacyRead.value:null;
 const configuredSources=configured?.length??(legacy?1:configuredRead.ok&&legacyRead.ok?0:null);
 const validPool=poolRead.ok&&object(pool)&&Array.isArray(pool.lines);
 let observedSources=0,freshSources=0,missingSources=0,staleSources=0,retainedAfterFailedRefresh=0;
 const selected=configured?configured.map(row=>snapshots[row?.source]):legacy?[!pool?.sourceBacked?pool:null]:[];
 for(const snapshot of selected){
  if(!observed(snapshot,now)){missingSources++;continue;}
  observedSources++;
  if(snapshot.syncedAt>now-INVENTORY_MAX_AGE_MS)freshSources++;else staleSources++;
  if(timestamp(snapshot.attemptedAt,now)>snapshot.syncedAt)retainedAfterFailedRefresh++;
 }
 // Count credentials once, even when a legacy aggregate repeats an account.
 const physical=new Map();
 if(validPool)for(const line of pool.lines){
  if(!object(line)||typeof line.id!=='string'||!line.id)continue;
  const identity=line.key||line.id,previous=physical.get(identity),entry={ids:new Set([line.id]),capacity:capacity(line),reported:count(line.external),eligible:usableProvider(line,now)&&capacity(line)>0,knownMembership:membership(line)};
  if(previous){previous.ids.add(line.id);previous.capacity=Math.min(previous.capacity,entry.capacity);previous.reported=Math.max(previous.reported,entry.reported);previous.eligible=previous.eligible&&entry.eligible;previous.knownMembership=previous.knownMembership&&entry.knownMembership;}
  else physical.set(identity,entry);
 }
 let eligibleAccounts=0,totalCapacity=0,reported=0,available=reservations.counts?0:null,unknownMembership=0,matchedReservations=0;
 for(const entry of physical.values()){
  if(!entry.knownMembership)unknownMembership++;
  const reserved=reservations.counts?[...entry.ids].reduce((sum,id)=>sum+(reservations.counts.get(id)||0),0):null;
  if(reserved!==null)matchedReservations+=reserved;
  if(!entry.eligible)continue;
  eligibleAccounts++;totalCapacity+=entry.capacity;reported+=entry.reported;
  if(available!==null)available+=Math.max(0,entry.capacity-entry.reported-reserved);
 }
 const readFailed=Object.values(results).some(result=>!result.ok);
 const freshnessVerified=validPool&&timestamp(pool.syncedAt,now)!==null&&pool.syncedAt>now-INVENTORY_MAX_AGE_MS;
 const state=!validPool?'unavailable':readFailed||missingSources||staleSources||retainedAfterFailedRefresh||unknownMembership||configuredSources===null||reservations.status!=='available'||!freshnessVerified?'partial':'available';
 return {state,configuredSources,observedSources:sourcesRead.ok?observedSources:null,freshSources:sourcesRead.ok?freshSources:null,missingSources:sourcesRead.ok?missingSources:null,staleSources:sourcesRead.ok?staleSources:null,retainedAfterFailedRefresh:sourcesRead.ok?retainedAfterFailedRefresh:null,
  syncedAt:timestamp(pool?.syncedAt,now),attemptedAt:timestamp(pool?.attemptedAt,now),physicalAccounts:validPool?physical.size:null,eligibleAccounts:validPool?eligibleAccounts:null,totalCapacity:validPool?totalCapacity:null,reported:validPool?reported:null,reserved:reservations.reserved,available:validPool?available:null,unknownMembership:validPool?unknownMembership:null,
  unmatchedProviderReservations:validPool&&reservations.counts?Math.max(0,reservations.reserved-matchedReservations):null,accounting:'conservative',freshnessVerified};
}

async function mappingSummary(store,queries,now){
 const base={status:'not_requested',checked:0,registered:0,inconsistent:0,notRegistered:0,samples:[],catalogCurrentVerified:false,mediaHealthVerified:false};
 if(Array.isArray(queries)&&!queries.length)return base;
 try{
  const result=await readXtreamReferences(store,queries,now);
  if(result.error)return {...base,status:'invalid_queries'};
  const counts={...base,status:'available',checked:result.references.length};
  const numeric=value=>/^[0-9]{1,16}$/.test(String(value??''))?String(value):null;
  for(const [queryIndex,row] of result.references.entries()){
   if(row.state==='registered')counts.registered++;else if(row.state==='registry_inconsistent')counts.inconsistent++;else if(row.state==='not_registered')counts.notRegistered++;
   const kind=row.reference?.kind??row.query?.kind,publicId=numeric(row.reference?.publicId??row.query?.publicId),upstreamId=numeric(row.reference?.upstreamId??row.query?.upstreamId);
   counts.samples.push({queryIndex,state:row.state,...(['live','movie','series_list','episode'].includes(kind)?{kind}:{}),...(publicId?{publicId}:{}),...(upstreamId?{upstreamId}:{})});
  }
  return counts;
 }catch{return {...base,status:'unavailable'};}
}

export async function serverDiagnosticSnapshot(store,{now=Date.now(),rotationEnabled=true,queries=[]}={}){
 const [pool,configured,legacy,sources,healthRead,statsRead,reservations,mapping]=await Promise.all([
  read(()=>readInventoryPool(store,now)),read(()=>store.get('providers')),read(()=>store.get('provider')),read(()=>store.get('source-pools')),
  read(()=>store.get('provider-health')),read(()=>store.get('provider-rotation-stats')),reservationCounts(store,now),mappingSummary(store,queries,now)
 ]);
 const results={pool,configured,legacy,sources},inventory=inventorySummary(results,reservations,now);
 const health=providerHealthSummary(healthRead.ok?healthRead.value:null,now);
 const validStats=object(statsRead.value)&&Number.isSafeInteger(statsRead.value.completed)&&statsRead.value.completed>=0;
 return {generatedAt:now,readOnly:true,inventory,leases:{status:reservations.status,...(reservations.reason?{reason:reservations.reason}:{}),reserved:reservations.reserved,unmatchedProviderReservations:inventory.unmatchedProviderReservations},
  health:{...health,status:!healthRead.ok?'unavailable':health.lastObservedAt===null?'unobserved':'available'},
  rotation:{policy:{...ROTATION_POLICY,enabled:rotationEnabled},statsStatus:!statsRead.ok?'unavailable':validStats?'available':'not_recorded',completed:validStats?statsRead.value.completed:null,lastCompletedAt:validStats?timestamp(statsRead.value.lastCompletedAt,now):null},mapping,
  limitations:{providerRequestsPerformed:false,providerInventoryVerified:false,playbackValidated:false,telemetryExhaustive:false,assignmentsScanned:false,reservationsAreViewers:false},readFailures:[...Object.entries({...results,health:healthRead,rotation:statsRead}).filter(([,result])=>!result.ok).map(([key])=>key),...(reservations.reason==='read_failed'?['leases']:[]),...(mapping.status==='unavailable'?['mapping']:[])]};
}

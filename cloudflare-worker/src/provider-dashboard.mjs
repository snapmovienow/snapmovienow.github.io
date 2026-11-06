// A read-only, administrator-only projection of the same inventory and leases
// used by allocation. Never serialize storage records or encrypted credentials.
import {openLeaseStore} from './lease-store.mjs';
import {cleanPlaybackActivity} from './playback-activity.mjs';
import {usableProvider} from './provider-assignment.mjs';
import {INVENTORY_MAX_AGE_MS,readInventoryPool} from './provider-inventory.mjs';
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
const inventoryStates=new Set(['active','expired','suspended','unavailable']);
function indexLines(lines){
 return {byId:new Map(lines.map(line=>[line.id,line])),byKey:new Map(lines.filter(line=>line.key).map(line=>[line.key,line]))};
}
function matchingLine(index,item){
 const sameId=index.byId.get(item.id);
 return (item.key&&index.byKey.get(item.key))||(!item.key||!sameId?.key||sameId.key===item.key?sameId:null);
}
function preferObservation(previous,next){
 return !previous||(previous.eligible!==next.eligible?next.eligible:next.syncedAt>=previous.syncedAt);
}
export async function providerDashboard(store,now=Date.now(),leases=null){
 leases??=await openLeaseStore(store);
 const provider=await store.get('provider'),configured=await store.get('providers');
 const providers=configured||(provider?[{...provider,source:(provider.mode==='panel'?'panel:':'single:')+String(provider.username).trim().toLowerCase()}]:[]);
 const pool=await readInventoryPool(store,now),pools=await store.get('source-pools')||{};
 const legacyPool=!configured&&provider?await store.get('pool'):null;
 const rows=new Map(),aggregate=indexLines(pool?.lines||[]),identities=new Map(aggregate.byKey),sources=[];
 for(const source of providers){
  // The legacy directory had only one source. Once a directory exists its
  // merged pool cannot establish which of the configured sources had a row.
  const snapshot=pools[source.source]||(!legacyPool?.sourceBacked?legacyPool:null);
  const own=Number.isFinite(snapshot?.syncedAt)&&snapshot.syncedAt>0&&(Array.isArray(snapshot.inventory)||Array.isArray(snapshot.lines));
  const complete=own&&Array.isArray(snapshot.inventory),syncedAt=own?snapshot.syncedAt:null;
  const localLines=own&&Array.isArray(snapshot.lines)?snapshot.lines:[];
  const inventory=complete?snapshot.inventory:localLines,local=indexLines(localLines),sourceRows=new Map();
  const info={source:source.source,name:source.name||source.username,inventoryStatus:!own?'missing':complete?'verified':'partial',
   syncedAt,stale:own&&(snapshot!==legacyPool&&!!snapshot.attemptedAt||syncedAt<=now-60000),receivedRows:complete?inventory.length:null,activeAccounts:own?0:null,usableAccounts:own?0:null};
  sources.push(info);
  for(const item of inventory){
   const line=matchingLine(aggregate,item),localLine=matchingLine(local,item),identity=(item.key&&identities.get(item.key))||line||item,id=identity.id;
   if(item.key)identities.set(item.key,identity);
   const status=item.expiresAt&&item.expiresAt<=now?'expired':inventoryStates.has(item.status)?item.status:item.status===undefined&&localLine?'active':'unavailable';
   const eligible=status==='active'&&syncedAt>now-INVENTORY_MAX_AGE_MS&&!!(usableProvider(localLine,now)&&usableProvider(line,now));
   const rowKey=identity.key?'key:'+identity.key:'id:'+id,observation={source:info.source,name:info.name,status,eligible};
   const next={id,username:line?.username||item.username||'Cuenta '+id,server:line?.server||item.server||'ccf',status,eligible,
    maxConnections:Math.min(3,count(line?.maxConnections??item.maxConnections)),reported:count(line?.external??item.reported??item.external),
    syncedAt,stale:info.stale,sources:[observation],reservations:[]};
   if(preferObservation(sourceRows.get(rowKey),next))sourceRows.set(rowKey,next);
  }
  for(const [rowKey,next] of sourceRows){
   if(next.status==='active')info.activeAccounts++;
   if(next.eligible)info.usableAccounts++;
   const old=rows.get(rowKey);
   // Keep each source's status. For the shared row prefer the source that
   // can actually serve it, otherwise show the newest saved observation.
   if(old)next.sources=[...old.sources,...next.sources];
   if(preferObservation(old,next))rows.set(rowKey,next);else old.sources=next.sources;
  }
 }
 const assignmentRows=new Map();
 for(const row of rows.values()){
  if(preferObservation(assignmentRows.get(row.id),row))assignmentRows.set(row.id,row);
 }
 const assignments=[],users=new Map(Array.from((await store.list({prefix:'user:'})).values()).map(u=>[u.id,u]));
 for(const lease of (await leases.active({},now)).values()){
  const user=users.get(lease.uid);if(lease.until<=now||!user||user.version!==lease.version||user.status!=='active'||(user.expiresAt&&user.expiresAt<=now))continue;
  const row=assignmentRows.get(lease.provider_id)||(rows.size===1&&!lease.provider_id?[...rows.values()][0]:null);if(!row)continue;
  const kind=String(lease.mediaKey||'').split('|')[0],assignment={username:user.username,accountId:row.id,accountUsername:row.username,server:row.server,type:['movie','series','live'].includes(kind)?kind:'unknown',client:lease.xtream?'xtream':'web',until:lease.until,lastSeenAt:Math.max(0,Math.min(now,lease.until-90000)),activity:cleanPlaybackActivity(lease.activity,kind)};
  row.reservations.push(assignment);assignments.push(assignment);
 }
 const accounts=[...rows.values()].map(row=>({...row,reserved:row.reservations.length,
  // Reported provider use may already include our connections. Allocation is
  // intentionally conservative; show its actual assignable capacity, rather
  // than pretending that report and reservations are disjoint physical uses.
  available:row.eligible?Math.max(0,row.maxConnections-row.reported-row.reservations.length):0
 })).sort((a,b)=>b.reserved-a.reserved||a.username.localeCompare(b.username));
 const active=accounts.filter(a=>a.status==='active'),usable=accounts.filter(a=>a.eligible);
 const receivedRows=sources.every(s=>s.inventoryStatus==='verified')?sources.reduce((total,s)=>total+s.receivedRows,0):null;
 return {generatedAt:now,accounts,assignments,sources,summary:{accounts:accounts.length,receivedRows,activeAccounts:active.length,usableAccounts:usable.length,totalCapacity:usable.reduce((n,a)=>n+a.maxConnections,0),reported:usable.reduce((n,a)=>n+a.reported,0),reserved:assignments.length,available:usable.reduce((n,a)=>n+a.available,0)},accounting:'conservative',stale:sources.some(s=>s.stale)};
}

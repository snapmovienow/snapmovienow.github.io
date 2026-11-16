export const INVENTORY_MAX_AGE_MS=12*3600000;
export const INVENTORY_REFRESH_MS=30000;
const sourceIdsKnown=line=>Array.isArray(line.sourceIds)&&line.sourceIds.length>0&&line.sourceIds.every(id=>typeof id==='string'&&id.length>0);

export function mergeInventories(pools,now=Date.now()){
 const snapshots=Object.entries(pools),fresh=snapshots.filter(([,p])=>p.syncedAt>now-INVENTORY_MAX_AGE_MS&&p.lines.length);
 const unique=new Map(),keys=new Map();
 for(const [source,snapshot] of fresh)for(const line of snapshot.lines){
  const id=keys.get(line.key)||line.id,previous=unique.get(id);
  // Membership follows the actual source snapshots, never an account's own
  // metadata. Shared credentials still expose one conservative capacity row.
  const sourceIds=[...new Set([...(previous?.sourceIds||[]),source])].sort();
  const next=previous?{...line,id:previous.id,maxConnections:Math.min(previous.maxConnections,line.maxConnections),external:Math.max(previous.external,line.external),sourceIds}:{...line,sourceIds};
  unique.set(id,next);if(line.key)keys.set(line.key,id);
 }
 const dated=fresh.length?fresh:snapshots;
 return {
  lines:[...unique.values()],
  syncedAt:dated.length?Math.min(...dated.map(([,p])=>p.syncedAt||0)):0,
  attemptedAt:snapshots.length?Math.min(...snapshots.map(([,p])=>p.attemptedAt??p.syncedAt??0)):0,
  sourceBacked:true
 };
}

export async function readInventoryPool(store,now=Date.now()){
 const pool=await store.get('pool');
 if(!pool)return null;
 const recent=pool.syncedAt>now-INVENTORY_MAX_AGE_MS;
 // Rebuild older aggregates from the original successful source timestamps.
 // Rebuild again at expiry so one aging source cannot hide another usable one.
 // Rebuild a pre-membership aggregate from its source snapshots until normal
 // sync persists sourceIds. Current aggregates keep the single-read fast path.
 const missingSources=pool.sourceBacked&&pool.lines.some(line=>!sourceIdsKnown(line));
 if(pool.attemptedAt===undefined||pool.sourceBacked&&!recent&&pool.lines.length||missingSources){
  const sources=await store.get('source-pools');
  if(sources&&Object.keys(sources).length)return mergeInventories(sources,now);
 }
 return recent||!pool.lines.length
  ?{...pool,attemptedAt:pool.attemptedAt??pool.syncedAt}
  :{...pool,lines:[],attemptedAt:pool.attemptedAt??pool.syncedAt};
}

// A read-only, administrator-only projection of the same inventory and leases
// used by allocation. Never serialize storage records or encrypted credentials.
import {openLeaseStore} from './lease-store.mjs';
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
export async function providerDashboard(store,now=Date.now(),leases=null){
 leases??=await openLeaseStore(store);
 const provider=await store.get('provider'),providers=await store.get('providers')||(provider?[{...provider,source:provider.mode+':'+provider.username}]:[]);
 const pool=await store.get('pool')||{lines:[],syncedAt:0},pools=await store.get('source-pools')||{};
 const rows=new Map(),byKey=new Map((pool.lines||[]).filter(l=>l.key).map(l=>[l.key,l])),byId=new Map((pool.lines||[]).map(l=>[l.id,l])),identities=new Map([...byKey].map(([key,line])=>[key,line.id]));
 for(const source of providers){const snapshot=pools[source.source]||{lines:pool.lines,syncedAt:pool.syncedAt};
  for(const item of snapshot.inventory||snapshot.lines||[]){const line=(item.key&&byKey.get(item.key))||byId.get(item.id),id=line?.id||(item.key&&identities.get(item.key))||item.id;if(item.key)identities.set(item.key,id);
   const old=rows.get(id),eligible=!!line&&(!item.expiresAt||item.expiresAt>now)&&snapshot.syncedAt>now-12*3600000;
   const next={id,username:line?.username||item.username||'Cuenta '+id,server:line?.server||item.server||'ccf',status:item.expiresAt&&item.expiresAt<=now?'expired':eligible?'active':item.status&&item.status!=='active'?item.status:'unavailable',eligible,maxConnections:Math.min(3,count(line?.maxConnections??item.maxConnections)),reported:count(line?.external??item.reported??item.external),syncedAt:snapshot.syncedAt||0,stale:!!snapshot.attemptedAt||!(snapshot.syncedAt>now-60000),sources:[...(old?.sources||[]),{source:source.source,name:source.name||source.username}],reservations:[]};
   if(!old||next.syncedAt>=old.syncedAt)rows.set(id,next);else old.sources=next.sources;
  }
 }
 // Legacy single-account configurations also have a useful read-only view.
 if(!rows.size&&provider&&provider.mode!=='panel')rows.set('legacy-single',{id:'legacy-single',username:provider.username,server:'ccf',status:'active',eligible:true,maxConnections:Math.min(3,count(provider.maxConnections)),reported:0,syncedAt:0,stale:true,sources:[{source:'legacy-single',name:provider.username}],reservations:[]});
 const assignments=[],users=new Map(Array.from((await store.list({prefix:'user:'})).values()).map(u=>[u.id,u]));
 for(const lease of (await leases.active({},now)).values()){
  const user=users.get(lease.uid);if(lease.until<=now||!user||user.version!==lease.version||user.status!=='active'||(user.expiresAt&&user.expiresAt<=now))continue;
  const row=rows.get(lease.provider_id)||(rows.size===1&&!lease.provider_id?[...rows.values()][0]:null);if(!row)continue;
  const kind=String(lease.mediaKey||'').split('|')[0],assignment={username:user.username,accountId:row.id,accountUsername:row.username,server:row.server,type:['movie','series','live'].includes(kind)?kind:'unknown',client:lease.xtream?'xtream':'web',until:lease.until};
  row.reservations.push(assignment);assignments.push(assignment);
 }
 const accounts=[...rows.values()].map(row=>({...row,reserved:row.reservations.length,
  // Reported provider use may already include our connections. Allocation is
  // intentionally conservative; show its actual assignable capacity, rather
  // than pretending that report and reservations are disjoint physical uses.
  available:row.eligible?Math.max(0,row.maxConnections-row.reported-row.reservations.length):0
 })).sort((a,b)=>b.reserved-a.reserved||a.username.localeCompare(b.username));
 const active=accounts.filter(a=>a.eligible);
 return {generatedAt:now,accounts,assignments,sources:providers.map(p=>({source:p.source,name:p.name||p.username})),summary:{accounts:accounts.length,activeAccounts:active.length,totalCapacity:active.reduce((n,a)=>n+a.maxConnections,0),reported:active.reduce((n,a)=>n+a.reported,0),reserved:assignments.length,available:active.reduce((n,a)=>n+a.available,0)},accounting:'conservative',stale:accounts.some(a=>a.stale)};
}

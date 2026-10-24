// Resolve administrator diagnostics from already retained catalog snapshots.
// Never fetch provider catalogs, media, credentials or a customer's session.
export async function cachedFailureNames(catalog,failures){
 const rows=Array.isArray(failures)?failures.slice(0,30):[],snapshots=new Map();
 // A series playback ID identifies an episode, not a series catalog row.
 const actions={live:'get_live_streams',movie:'get_vod_streams'};
 for(const type of new Set(rows.map(r=>r.type))){
  if(!actions[type])continue;
  try{const data=await catalog(actions[type],undefined,{}, {cachedOnly:true});snapshots.set(type,Array.isArray(data)?data:[])}catch{snapshots.set(type,[])}
 }
 return rows.map(row=>{
  const idField='stream_id';
  const match=(snapshots.get(row.type)||[]).find(item=>String(item[idField])===row.id&&String(item._server||'ccf')===row.server);
  const name=typeof match?.name==='string'?match.name.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160):'';
  return {...row,title:name&&!/(?:https?:\/\/|password=|username=|access_token=)/i.test(name)?name:null};
 });
}

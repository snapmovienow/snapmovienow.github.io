// Each playback is one row. Heartbeats never read or rewrite another lease.
// SQL indexes bound session/customer lookups; the KV adapter is for test stores.
const opened=new WeakMap();
const PREFIX='playback-lease:';
const filters=new Set(['sid','uid','provider_id','xtream']);
export async function openLeaseStore(storage){
 if(!opened.has(storage)){
  const opening=storage.transaction(async tx=>{
   const repo=new LeaseStore(tx,storage.sql);
   if(storage.sql)storage.sql.exec(`CREATE TABLE IF NOT EXISTS smn_playback_leases (
    id TEXT PRIMARY KEY, sid TEXT NOT NULL, uid TEXT NOT NULL,
    provider_id TEXT NOT NULL, until INTEGER NOT NULL, xtream INTEGER NOT NULL,
    data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS smn_lease_session ON smn_playback_leases(sid,until);
   CREATE INDEX IF NOT EXISTS smn_lease_customer ON smn_playback_leases(uid,until);
   CREATE INDEX IF NOT EXISTS smn_lease_provider ON smn_playback_leases(provider_id,until);
   CREATE INDEX IF NOT EXISTS smn_lease_expiry ON smn_playback_leases(until);`);
   if(!await tx.get('lease-schema-v2')){
    const legacy=await tx.get('leases')||{};
    for(const [id,lease]of Object.entries(legacy))if(lease.until>Date.now())await repo.put(id,lease);
    // The marker and deletion commit with the rows; failed migration rolls back.
    await tx.put('lease-schema-v2',2);await tx.delete('leases');
   }
   return new LeaseStore(storage,storage.sql);
  });
  opened.set(storage,opening);
  opening.catch(()=>{if(opened.get(storage)===opening)opened.delete(storage)});
 }
 return opened.get(storage);
}
function decode(row){return {...JSON.parse(row.data),until:row.until}}
export class LeaseStore{
 constructor(storage,sql){this.storage=storage;this.sql=sql}
 in(tx){return new LeaseStore(tx,this.sql)}
 where(filter={},now=Date.now()){
  const terms=['until > ?'],values=[now];
  for(const [key,value]of Object.entries(filter)){
   if(!filters.has(key))throw Error('invalid_lease_filter');
   terms.push(key+' = ?');values.push(key==='xtream'?Number(!!value):String(value??''));
  }
  return {text:terms.join(' AND '),values};
 }
 async get(id){
  if(!id)return undefined;
  if(!this.sql)return this.storage.get(PREFIX+id);
  const rows=this.sql.exec('SELECT data,until FROM smn_playback_leases WHERE id = ?',String(id)).toArray();
  return rows.length?decode(rows[0]):undefined;
 }
 async put(id,lease){
  if(!this.sql)return this.storage.put(PREFIX+id,lease);
  this.sql.exec(`INSERT INTO smn_playback_leases(id,sid,uid,provider_id,until,xtream,data)
   VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sid=excluded.sid,
   uid=excluded.uid,provider_id=excluded.provider_id,until=excluded.until,
   xtream=excluded.xtream,data=excluded.data`,String(id),String(lease.sid||''),String(lease.uid||''),
   String(lease.provider_id||''),lease.until,Number(!!lease.xtream),JSON.stringify(lease));
 }
 async renew(id,until){
  if(this.sql){this.sql.exec('UPDATE smn_playback_leases SET until = ? WHERE id = ?',until,String(id));return}
  const lease=await this.get(id);if(lease)await this.put(id,{...lease,until});
 }
 async remove(id){
  if(this.sql){this.sql.exec('DELETE FROM smn_playback_leases WHERE id = ?',String(id));return}
  await this.storage.delete(PREFIX+id);
 }
 async active(filter={},now=Date.now()){
  const where=this.where(filter,now);
  if(this.sql)return new Map(this.sql.exec('SELECT id,data,until FROM smn_playback_leases WHERE '+where.text,...where.values).toArray().map(row=>[row.id,decode(row)]));
  return new Map([...await this.storage.list({prefix:PREFIX})].filter(([,l])=>l.until>now&&Object.entries(filter).every(([k,v])=>k==='xtream'?!!l[k]===!!v:String(l[k]??'')===String(v??''))).map(([k,l])=>[k.slice(PREFIX.length),l]));
 }
 async count(filter={},now=Date.now()){
  if(!this.sql)return (await this.active(filter,now)).size;
  const where=this.where(filter,now);
  return this.sql.exec('SELECT COUNT(*) AS total FROM smn_playback_leases WHERE '+where.text,...where.values).one().total;
 }
 async providerCounts(now=Date.now()){
  if(this.sql)return new Map(this.sql.exec('SELECT provider_id,COUNT(*) AS total FROM smn_playback_leases WHERE until > ? GROUP BY provider_id',now).toArray().map(row=>[row.provider_id,row.total]));
  const counts=new Map();for(const l of (await this.active({},now)).values())counts.set(String(l.provider_id||''),(counts.get(String(l.provider_id||''))||0)+1);return counts;
 }
 async removeFor(filter,now=Date.now()){
  if(this.sql){const where=this.where(filter,now);this.sql.exec('DELETE FROM smn_playback_leases WHERE '+where.text,...where.values);return}
  for(const id of (await this.active(filter,now)).keys())await this.remove(id);
 }
 async prune(now=Date.now()){
  if(this.sql){this.sql.exec('DELETE FROM smn_playback_leases WHERE until <= ?',now);return}
  for(const [k,l]of await this.storage.list({prefix:PREFIX}))if(l.until<=now)await this.storage.delete(k);
 }
 async clear(){
  if(this.sql){this.sql.exec('DELETE FROM smn_playback_leases');return}
  for(const key of (await this.storage.list({prefix:PREFIX})).keys())await this.storage.delete(key);
 }
 async removeMatching(predicate){
  await this.prune();for(const [id,lease]of await this.active())if(predicate(lease))await this.remove(id);
 }
}

// Local-only test harness. This entry is never deployed; wrangler uses src/index.js.
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
export class LeaseTestDirectory{
 constructor(state,env){this.state=state;this.env=env}
 async fetch(req){
  const path=new URL(req.url).pathname,storage=this.state.storage;
  if(path==='/seed'){
   const b=await req.json(),count=b.count||0,lines=Array.from({length:b.accounts||Math.ceil(count/3)},(_,i)=>({id:String(i),username:'provider-'+i,key:'provider-'+i,server:'ccf',external:0,maxConnections:3,encrypted:'test-only'}));
   await storage.put('provider',{mode:'panel',username:'test-owner'});await storage.put('pool',{lines,syncedAt:Date.now()});
   for(let i=0;i<count;i++)await storage.put('user:customer'+i,{id:'u'+i,username:'customer'+i,version:1,status:'active'});
   if(b.legacy)await storage.put('leases',b.legacy);
   return Response.json({seeded:count});
  }
  if(path==='/inspect'){
   const b=await req.json(),leases=await openLeaseStore(storage),row=b.id?await leases.get(b.id):null;
   return Response.json({row,count:await leases.count(),legacy:await storage.get('leases')||null,marker:await storage.get('lease-schema-v2'),plans:storage.sql.exec('EXPLAIN QUERY PLAN SELECT data,until FROM smn_playback_leases WHERE id = ?','test').toArray(),sessionPlan:storage.sql.exec('EXPLAIN QUERY PLAN SELECT id,data,until FROM smn_playback_leases WHERE sid = ? AND until > ?','test',Date.now()).toArray()});
  }
  if(path==='/rollback'){
   const {id}=await req.json(),leases=await openLeaseStore(storage);
   try{await storage.transaction(async tx=>{await leases.in(tx).remove(id);await tx.put('must-rollback',true);throw Error('rollback-probe')})}catch{}
   return Response.json({row:await leases.get(id),kv:await storage.get('must-rollback')||null});
  }
  if(path==='/expire'){
   const b=await req.json(),leases=await openLeaseStore(storage);await leases.renew(b.id,Date.now()-1);return Response.json({ok:true});
  }
  return accountsFetch(this.state,this.env,req);
 }
}
export default{fetch(req,env){const u=new URL(req.url),name=u.searchParams.get('object')||'directory';return env.TEST_DIRECTORY.get(env.TEST_DIRECTORY.idFromName(name)).fetch(req)}};

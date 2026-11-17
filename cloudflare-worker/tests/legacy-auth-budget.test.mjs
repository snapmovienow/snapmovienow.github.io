import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyAuthBudget} from '../src/legacy-auth-budget.mjs';
import {accountsFetch} from '../src/accounts.mjs';

class Store{
 data=new Map();queue=Promise.resolve();scans=[];
 async get(key){return structuredClone(this.data.get(key));}
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async list(options={}){this.scans.push(options);let rows=[...this.data].filter(([k])=>(!options.prefix||k.startsWith(options.prefix))&&(!options.end||k<options.end)).sort(([a],[b])=>a.localeCompare(b));if(options.limit)rows=rows.slice(0,options.limit);return new Map(structuredClone(rows));}
 transaction(fn){const result=this.queue.then(async()=>{const previous=structuredClone(this.data);try{return await fn(this);}catch(error){this.data=previous;throw error;}});this.queue=result.catch(()=>{});return result;}
}
const env={TICKET_SECRET:'synthetic-legacy-budget-secret-never-deployed'},NOW=1800000000000,body={client:'192.0.2.51',username:'LegacyViewer'};
const take=(store,b=body,now=NOW)=>legacyAuthBudget(store,env,'/legacy-auth-begin',b,now);
const clear=(store,b=body,now=NOW)=>legacyAuthBudget(store,env,'/legacy-auth-success',b,now);
const consume=async pending=>{const response=await pending,status=response.status;await response.body.cancel();return status;};

test('atomic per-pair budget accepts ten attempts and denies concurrent excess without storing identifiers',async()=>{
 const store=new Store(),responses=await Promise.all(Array.from({length:30},(_,i)=>take(store,{...body,username:i%2?'legacyviewer':'LEGACYVIEWER'})));
 assert.equal(responses.filter(r=>r.status===200).length,10);
 assert.equal(responses.filter(r=>r.status===429).length,20);
 for(const r of responses){if(r.status===429)assert.equal(r.headers.get('Retry-After'),'900');await r.body.cancel();}
 const stored=JSON.stringify([...store.data]);for(const raw of [body.client,body.username,'legacyviewer',env.TICKET_SECRET])assert.equal(stored.includes(raw),false);
 assert.equal([...store.data.keys()].filter(k=>k.startsWith('legacy-auth-budget:')).length,2);
 assert.equal(await consume(take(store,{...body,client:'192.0.2.52'})),200,'other network remains independent');
 assert.equal(await consume(take(store,{...body,username:'AnotherViewer'})),200,'other customer on the same NAT remains independent');
});

test('per-client spray budget permits 120 different logins/minute and success only clears the pair',async()=>{
 const store=new Store();
 for(let i=0;i<120;i++){
  const b={...body,username:'viewer-'+i};assert.equal(await consume(take(store,b)),200);assert.equal(await consume(clear(store,b)),200);
 }
 const blocked=await take(store,{...body,username:'viewer-next'});assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'60');await blocked.body.cancel();
 assert.equal(await consume(take(store,{...body,client:'192.0.2.52'})),200);
 assert.equal(await consume(take(store,{...body,username:'viewer-next'},NOW+60000)),200);
});

test('success resets pair failures; expired pair recovers and old expiry indexes cannot delete renewed counters',async()=>{
 const store=new Store();for(let i=0;i<9;i++)assert.equal(await consume(take(store)),200);
 assert.equal(await consume(clear(store)),200);
 for(let i=0;i<10;i++)assert.equal(await consume(take(store)),200);
 assert.equal(await consume(take(store)),429);
 assert.equal(await consume(take(store,body,NOW+900000)),200);
 for(let i=0;i<9;i++)assert.equal(await consume(take(store,body,NOW+900001)),200);
 assert.equal(await consume(take(store,body,NOW+900002)),429);
 assert.ok(store.scans.every(scan=>scan.limit===20&&scan.prefix==='legacy-auth-expiry:'&&typeof scan.end==='string'));
});

test('expired cleanup is bounded and private auth routes do not initialize lease or business records',async()=>{
 const store=new Store();
 for(let i=0;i<60;i++){const b={...body,client:'synthetic-network-'+i};assert.equal(await consume(take(store,b,NOW-3600000)),200);}
 const before=store.data.size;
 assert.equal(await consume(take(store,body)),200);
 assert.ok(before-store.data.size<=40,'at most20 expiry entries plus their20 counters deleted');
 const privateStore=new Store(),state={storage:privateStore},call=path=>accountsFetch(state,env,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));
 assert.equal(await consume(call('/legacy-auth-begin')),200);
 assert.equal(await consume(call('/legacy-auth-success')),200);
 assert.ok([...privateStore.data.keys()].every(k=>k.startsWith('legacy-auth-')));
});

test('a stale expiry index cannot erase a renewed bucket',async()=>{
 const store=new Store();assert.equal(await consume(take(store)),200);
 const [key,row]=[...store.data].find(([k])=>k.startsWith('legacy-auth-budget:pair:'));
 const oldUntil=NOW-1,index='legacy-auth-expiry:'+String(oldUntil).padStart(16,'0')+':'+key.slice('legacy-auth-budget:'.length);
 await store.put(index,{key,until:oldUntil});assert.equal(await consume(take(store)),200);
 assert.equal((await store.get(key)).until,row.until);assert.equal((await store.get(key)).count,2);assert.equal(await store.get(index),undefined);
});

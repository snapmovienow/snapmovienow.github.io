import assert from 'node:assert/strict';
import {resellerPlaybackSummary} from '../src/reseller-presence.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{
 constructor(){this.data=new Map();this.pages=0;}
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}
 async transaction(f){return f(this);}
 async list({prefix,startAfter,limit=Infinity}){if(prefix==='user:')this.pages++;return new Map([...this.data].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,limit));}
}
const store=new Store(),leases=await openLeaseStore(store),now=Date.now(),accountId='juanito-summary';
for(let n=0;n<201;n++)await store.put('user:customer-'+String(n).padStart(3,'0'),{id:'uid-'+n,version:2,status:n===1?'suspended':'active',expiresAt:n===2?now:now+999999,resellerBridge:{accountId,lineId:'line-'+n},hash:'private-hash',salt:'private-salt'});
await store.put('user:foreign',{id:'foreign-user',version:2,status:'active',resellerBridge:{accountId:'martin-summary',lineId:'foreign-line'}});
for(const [uid,count]of [['uid-0',2],['uid-100',1],['uid-200',3],['uid-1',1],['uid-2',1],['foreign-user',4]])for(let n=0;n<count;n++)await leases.put(uid+'-'+n,{uid,version:2,sid:'private-session-'+uid+n,until:now+90000});
await leases.put('old',{uid:'uid-0',version:1,sid:'obsolete',until:now+90000});
await leases.put('expired',{uid:'uid-100',version:2,sid:'expired',until:now});
const response=await resellerPlaybackSummary(store,leases,{accountId,lines:[]},now),summary=await response.json();
assert.equal(response.status,200);assert.deepEqual(summary,{ok:true,checkedAt:now,connectionsUsed:6,linesOnline:3});assert.equal(store.pages,3,'totals must include customers after the first 100 records');
assert.ok(!/private|hash|salt|uid-|customer-|foreign/.test(JSON.stringify(summary)),'aggregate reply exposes no customer/session material');
await leases.remove('uid-200-0');assert.equal((await (await resellerPlaybackSummary(store,leases,{accountId},now)).json()).connectionsUsed,5);
assert.deepEqual(await (await resellerPlaybackSummary(store,leases,{accountId},now+90001)).json(),{ok:true,checkedAt:now+90001,connectionsUsed:0,linesOnline:0});
assert.equal((await resellerPlaybackSummary(store,leases,{accountId:'invalid/account'},now)).status,400);
console.log('PASS: whole-account totals across storage pages, distinct online users, simultaneous connections, stale/expired/suspended/foreign exclusion, cancellation and private aggregate output.');

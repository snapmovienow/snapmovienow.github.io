import assert from 'node:assert/strict';
import {resellerLiveConnections} from '../src/reseller-presence.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{
 data=new Map();
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}
 async delete(k){this.data.delete(k)}
 async transaction(f){return f(this)}
 async list({prefix,startAfter,limit=Infinity}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))}
}
const store=new Store(),leases=await openLeaseStore(store),now=Date.now(),accountId='juanito-test';
for(let i=0;i<151;i++){
 const username='customer'+String(i).padStart(3,'0');
 await store.put('user:'+username,{id:'u'+i,username,status:'active',version:2,expiresAt:now+999999,resellerBridge:{accountId:i===150?'martin-test':accountId,lineId:'line'+i},hash:'PRIVATE-HASH'});
 if(i>=95)await leases.put('PRIVATE-LEASE-'+i,{uid:'u'+i,version:2,sid:'PRIVATE-SESSION',provider_id:'PRIVATE-PROVIDER',username,until:now+90000,xtream:i%2===0,mediaKey:'live|ccf|123|m3u8',activity:{title:'Canal '+i}});
}
await leases.put('second',{uid:'u95',version:2,sid:'PRIVATE-OTHER',until:now+90000,mediaKey:'movie|ccf|456|mp4',activity:{title:'Película de prueba'}});
await leases.put('stale',{uid:'u95',version:1,until:now+90000});
await leases.put('expired',{uid:'u95',version:2,until:now});
await store.put('user:customer096',{...(await store.get('user:customer096')),status:'suspended'});
await store.put('user:customer097',{...(await store.get('user:customer097')),expiresAt:now});
const read=async(body={},time=now)=>{const r=await resellerLiveConnections(store,leases,{accountId,...body},time);return {status:r.status,body:await r.json()}};
let result=await read({page:2,pageSize:25});
assert.equal(result.status,200);assert.equal(result.body.linesOnline,53);assert.equal(result.body.connectionsUsed,54);assert.equal(result.body.rows.length,25);assert.equal(result.body.pagination.pages,3);
assert.ok(result.body.rows.every(row=>row.username!=='customer150'));
assert.ok(!/PRIVATE|mediaKey|provider_id|\.m3u8|hash|salt|session/i.test(JSON.stringify(result.body)));
result=await read({q:'pelicula'});assert.equal(result.body.rows.length,1);assert.equal(result.body.rows[0].username,'customer095');assert.equal(result.body.rows[0].stream.title,'Película de prueba');assert.equal(result.body.connectionsUsed,54,'search must not reduce whole-account totals');
result=await read({page:999,pageSize:25});assert.equal(result.body.pagination.page,3);assert.equal(result.body.rows.length,4);
await leases.remove('second');assert.equal((await read({q:'pelicula'})).body.pagination.total,0);
const unsafe=await leases.get('PRIVATE-LEASE-95');await leases.put('PRIVATE-LEASE-95',{...unsafe,activity:{title:'https://private.invalid/password=hidden'}});
assert.deepEqual((await read({q:'customer095'})).body.rows[0].stream.title,null);
assert.equal((await read({},now+90001)).body.connectionsUsed,0);
for(const input of [{accountId:'wrong/account'},{page:0},{page:'1'},{pageSize:1000},{q:'x'.repeat(101)}])assert.equal((await read(input)).status,400);
console.log('PASS: account-only live customers beyond 100 records, multiple playbacks, scoped pages/search/totals, safe content labels, obsolete/suspended/expired exclusion and private output.');

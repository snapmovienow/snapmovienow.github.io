import assert from 'node:assert/strict';
import {readXtreamReferences} from '../src/xtream-reference-diagnostic.mjs';
const entries=new Map([
 ['xtream-map:live:ccf:201',101],
 ['xtream-id:101',{id:101,kind:'live',server:'ccf',upstreamId:'201',activity:{name:'private name'},encrypted:'private token',url:'https://private.test/media'}],
 ['xtream-map:live:ccf:202',101],
 ['xtream-map:live:ccf:203','invalid'],
 ['xtream-id:109',{id:110,kind:'live',server:'ccf',upstreamId:'9'}]
]);
let reads=0;
const store={get:async key=>{reads++;return structuredClone(entries.get(key));},put:()=>{throw Error('write forbidden')},delete:()=>{throw Error('delete forbidden')},list:()=>{throw Error('scan forbidden')}};
const before=structuredClone(entries);
let r=await readXtreamReferences(store,[{publicId:'101'},{kind:'live',server:'ccf',upstreamId:201}],123);
assert.deepEqual(r.references.map(x=>x.reference),Array(2).fill({publicId:'101',kind:'live',server:'ccf',upstreamId:'201'}));
assert.equal(r.generatedAt,123);assert.equal(r.evidence,'stored_registry');assert.equal(r.catalogCurrentVerified,false);assert.equal(r.mediaHealthVerified,false);assert.equal(reads,4);
for(const secret of ['private name','private token','https://'])assert.ok(!JSON.stringify(r).includes(secret));
r=await readXtreamReferences(store,[{publicId:'321'},{kind:'episode',server:'ccf',upstreamId:'4'},{kind:'live',server:'ccf',upstreamId:'202'},{kind:'live',server:'ccf',upstreamId:'203'},{publicId:'109'}]);
assert.deepEqual(r.references.map(x=>x.state),['not_registered','not_registered','registry_inconsistent','registry_inconsistent','registry_inconsistent']);
for(const queries of [[],Array(11).fill({publicId:'101'}),[{publicId:'101',password:'x'}],[{publicId:'1:secret'}],[{kind:'live',server:'../secret',upstreamId:'8'}],[{kind:'movie',server:'ccf',upstreamId:'4',publicId:'101'}],null]){
 const n=reads;assert.deepEqual(await readXtreamReferences(store,queries),{error:'invalid_reference_queries'});assert.equal(reads,n,'reject complete batch before any read');
}
const n=reads;r=await readXtreamReferences(store,Array(10).fill({kind:'live',server:'ccf',upstreamId:'201'}));assert.equal(reads-n,20);
assert.deepEqual(entries,before,'no registry, catalog, account or audit mutation');
console.log('PASS exact forward/reverse mapping, mismatch detection, bounded key reads, invalid-batch rejection and private-field exclusion');

const {readFile}=await import('node:fs/promises');
const source=await readFile(new URL('../src/accounts.mjs',import.meta.url),'utf8');
const isolated=source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g,(all,names,path)=>path==='./xtream-reference-diagnostic.mjs'?'import {readXtreamReferences} from '+JSON.stringify(new URL('../src/xtream-reference-diagnostic.mjs',import.meta.url).href)+';':'const {'+names+'}=new Proxy({},{get:()=>()=>{throw Error("unexpected dependency or mutation")}});');
const {accountsFetch}=await import('data:text/javascript;base64,'+Buffer.from(isolated).toString('base64'));
const request=queries=>new Request('https://private/accounts/xtream-reference-diagnostic',{method:'POST',body:JSON.stringify({queries})});
const transactionStore={...store,transaction:fn=>fn(store)};
let response=await accountsFetch({storage:transactionStore},{},request([{publicId:'101'}]));
assert.equal(response.status,200);assert.equal((await response.json()).references[0].reference.upstreamId,'201');
response=await accountsFetch({storage:transactionStore},{},request([]));assert.equal(response.status,400);
assert.deepEqual(entries,before);
console.log('PASS private route executes without lease initialization, migration, catalog registration or account changes');

const vm=await import('node:vm');
const worker=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const start=worker.indexOf('async function adminRequest('),end=worker.indexOf('\nfunction publicTitle(',start);
assert.ok(start>=0&&end>start);
let session=null,sessionActive=false,registryCalls=0;
const adminRequest=vm.runInNewContext('('+worker.slice(start,end)+')',{
 readLimitedJSON:req=>req.json(),cookieToken:()=>'',unticket:async()=>session,
 sessionCall:async()=>({ok:sessionActive}),json:(data,status=200)=>Response.json(data,{status}),
 registry:async(env,path,body)=>{registryCalls++;return accountsFetch({storage:transactionStore},{},new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));}
});
const adminCall=queries=>adminRequest(new Request('https://api.test/admin',{method:'POST',body:JSON.stringify({action:'xtream-reference-diagnostic',queries})}),{},{});
for(const [candidate,active]of [[null,false],[{kind:'user',sid:'viewer'},true],[{kind:'admin',sid:'expired'},false]]){
 session=candidate;sessionActive=active;const before=reads;assert.equal((await adminCall([{publicId:'101'}])).status,401);assert.equal(reads,before);assert.equal(registryCalls,0);
}
session={kind:'admin',sid:'owner'};sessionActive=true;
response=await adminCall([{publicId:'101'}]);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await response.json()).references[0].reference.upstreamId,'201');assert.equal(registryCalls,1);
response=await adminCall([]);assert.equal(response.status,400);
assert.deepEqual(entries,before);
console.log('PASS actual administrator handler denies absent/viewer/expired sessions before registry reads and permits authenticated bounded reads');

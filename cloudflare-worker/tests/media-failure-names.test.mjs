import assert from 'node:assert/strict';
import {cachedFailureNames} from '../src/media-failure-names.mjs';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {encodeCatalog} from '../src/catalog-cache.mjs';
const failures=[{type:'live',server:'ccf',id:'8471'},{type:'live',server:'other',id:'8471'},{type:'movie',server:'ccf',id:'3'}];
let calls=0;
const named=await cachedFailureNames(async(action,server,params,options)=>{
 calls++;assert.equal(server,undefined);assert.deepEqual(params,{});assert.deepEqual(options,{cachedOnly:true});
 return action==='get_live_streams'?[{stream_id:8471,name:'Named channel',_server:'ccf'}]:[{stream_id:3,name:'https://secret.invalid/?password=hidden'}];
},failures);
assert.equal(calls,2,'one retained snapshot per type, not one lookup per failed item');
assert.equal((await cachedFailureNames(async()=>{throw Error('series lists are not episode identities')},[{type:'series',server:'ccf',id:'8471'}]))[0].title,null);
assert.equal(named[0].title,'Named channel');assert.equal(named[1].title,null,'do not match the same numeric ID on another server');assert.equal(named[2].title,null);
assert.equal((await cachedFailureNames(async()=>{throw Error('cache unavailable')},failures))[0].title,null);
assert.equal((await cachedFailureNames(async()=>[],Array.from({length:90},()=>failures[0]))).length,30);
let providerRequests=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{providerRequests++;throw Error('diagnostics must never fetch upstream')};
try{
 const bytes=await encodeCatalog([{stream_id:8471,name:'Retained channel',_server:'ccf'}]);
 const deps={directory:async()=>Response.json([{source:'ccf',encrypted:'fixture'}]),catalogCredentials:async()=>{providerRequests++;throw Error('must not discover credentials')},registry:async()=>new Response(bytes,{headers:{'x-catalog-saved-at':String(Date.now())}})};
 const make=overrides=>createProviderCatalog({...deps,...overrides},{PLAYBACK_SESSIONS:{},TICKET_SECRET:'diagnostic-cache-test-secret'},null,{timeoutMs:1500,cacheReadMs:300});
 assert.equal((await cachedFailureNames(make(),[failures[0]]))[0].title,'Retained channel');
 assert.equal((await cachedFailureNames(make({registry:async()=>new Response(null,{status:404})}),[failures[0]]))[0].title,null);
 assert.equal(providerRequests,0,'both populated and empty cache paths are strictly non-probing');
}finally{globalThis.fetch=originalFetch}
console.log('PASS: diagnostic titles use bounded retained snapshots only, preserve server scope and never request provider credentials or media.');

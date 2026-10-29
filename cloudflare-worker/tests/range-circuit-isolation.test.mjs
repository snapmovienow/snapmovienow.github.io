import assert from 'node:assert/strict';
import {recordProviderHealth,recentMediaFailures,providerCircuitState} from '../src/provider-health.mjs';
const now=2000000,id='fixture',key='movie|ccf|123|mp4';
for(const range of [null,{phase:'initial',method:'GET',incomingRange:{kind:'bytes',start:100,end:199},outgoingRange:{kind:'bytes',start:100,end:199},reportedTotal:100,ifRangePresent:false},{phase:'initial',method:'GET',incomingRange:{kind:'bytes',start:0,end:99},outgoingRange:{kind:'bytes',start:0,end:99},reportedTotal:100,ifRangePresent:true}]){
 let h={};for(let i=0;i<5;i++)h=recordProviderHealth(h,id,key,false,1,'signal',now+i,null,null,416,{rangeEvidence:range});
 assert.equal(providerCircuitState(h,id,key,now+5).blocked,false);
 const [r]=recentMediaFailures(h,now+5);assert.deepEqual(r.httpStatuses,[416]);assert.equal(r.sourcesObserved,1);assert.equal(r.rangeEvidenceIncomplete,!range);if(range)assert.deepEqual(r.rangeEvidence,[range]);
 for(const status of [404,502]){
  let old={};for(let i=0;i<3;i++)old=recordProviderHealth(old,id,key,false,1,'signal',now+i,null,null,status);
  const prior=structuredClone(old);h=recordProviderHealth(old,id,key,false,1,'signal',now+4,null,null,416,{rangeEvidence:range});
  assert.equal(providerCircuitState(h,id,key,now+5).blocked,true);assert.deepEqual(h['channel|'+key+'|'+id],prior['channel|'+key+'|'+id]);assert.deepEqual(old,prior);
  const [r]=recentMediaFailures(h,now+5);assert.equal(r.sourcesObserved,1);assert.deepEqual(r.httpStatuses,[416,status].sort((a,b)=>a-b));
 }
}
console.log('PASS: valid/invalid/unknown416 observational only, retained evidence,404/502 circuits untouched, source count deduplicated.');

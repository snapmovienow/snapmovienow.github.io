import assert from 'node:assert/strict';
import {markServiceVerification} from '../src/service-verification.mjs';
import {requestConnectionClient} from '../src/connection-monitor.mjs';
import {recordCustomerActivity} from '../src/reseller-presence.mjs';
import {recordClientAccess} from '../src/client-history.mjs';
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),trust={accountId:'scope-test',keyId:'test-key',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')};
async function proof(extra={}){const raw=Buffer.from(JSON.stringify({v:1,accountId:trust.accountId,keyId:trust.keyId,action:'probe',issuedAt:Date.now(),nonce:crypto.randomUUID(),body:{purpose:'access-verification',lineId:'line-test',username:'clienteprueba'},...extra}));return JSON.stringify({payload:raw.toString('base64url'),signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,raw)).toString('base64url')});}
function request(header,username='clienteprueba'){const req=new Request('https://api.test/',{method:'POST',headers:{'Content-Type':'application/json',...(header?{'X-SNAP-Service-Check':header}:{})},body:JSON.stringify({op:'auth',username,password:'fictitious-password'})});Object.defineProperty(req,'cf',{value:{timezone:'America/Chicago'}});return req;}
const normal=request();assert.equal(await markServiceVerification(normal,trust),false);assert.equal(requestConnectionClient(normal).timeZone,'America/Chicago');
const verified=request(await proof());assert.equal(await markServiceVerification(verified,trust),true);assert.equal(requestConnectionClient(verified).timeZone,undefined);assert.equal(requestConnectionClient(verified).serviceCheck,true);
for(const req of [request(await proof(),'anotherclient'),request(await proof({issuedAt:Date.now()-46000})),request(await proof({accountId:'foreign'})),request('unsigned')]){assert.equal(await markServiceVerification(req,trust),false);assert.equal(requestConnectionClient(req).timeZone,'America/Chicago');}
let writes=0;const store={get:async()=>null,put:async()=>{writes++;}};await recordCustomerActivity(store,'uid',Date.now(),requestConnectionClient(verified));await recordClientAccess(store,null,{username:'clienteprueba',resellerBridge:{accountId:'scope-test',lineId:'line-test'}},'login',requestConnectionClient(verified));assert.equal(writes,0);
console.log('PASS: authenticated checks do not replace a customer timezone/history; forged, expired and foreign proofs retain normal client handling.');

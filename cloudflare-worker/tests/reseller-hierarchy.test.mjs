import assert from 'node:assert/strict';
import test from 'node:test';
import {createResellerBridge} from '../src/reseller-bridge.mjs';
import {LUIS_ALONSO_ACCOUNT,verifyManagedPortalTarget} from '../src/reseller-hierarchy-scope.mjs';

const child='luis-subpanel-00000000-0000-4000-8000-000000000001';
const martin='ccf-account-3350';
test('managed portal results are limited to Luis, the requested direct child and that child’s rows',()=>{
 const result={actor:{id:LUIS_ALONSO_ACCOUNT},target:{id:martin,slug:'martin-vela'},lines:[{account_id:martin}],ledger:[{account_id:martin}],managedResellers:[{id:martin,slug:'martin-vela',name:'Martín',status:'active',balance:0,revision:1}]};
 const query={slug:'martin-vela'};
 assert.equal(verifyManagedPortalTarget(result,true,query),true);
 assert.equal(verifyManagedPortalTarget(result,false,query),false);
 assert.equal(verifyManagedPortalTarget(result,true,{}),false);
 assert.equal(verifyManagedPortalTarget({...result,actor:{id:'outside'}},true,query),false);
 assert.equal(verifyManagedPortalTarget({...result,lines:[{account_id:'outside'}]},true,query),false);
 assert.equal(verifyManagedPortalTarget({...result,managedResellers:[{...result.managedResellers[0],panelPassword:'not-allowed'}]},true,query),false);
});

test('a signed Luis request can reach an isolated subpanel; other signers and existing scopes cannot be impersonated',async()=>{
 const enc=new TextEncoder(),base64=value=>Buffer.from(value).toString('base64url');
 const pairs=await Promise.all([LUIS_ALONSO_ACCOUNT,martin].map(async accountId=>{
  const key=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  return {accountId,keyId:crypto.randomUUID(),publicKey:base64(await crypto.subtle.exportKey('raw',key.publicKey)),privateKey:key.privateKey};
 }));
 const seen=[];
 const bridge=createResellerBridge(async(_env,path,body)=>{seen.push({path,body});return Response.json({ok:true});},pairs);
 const call=async({accountId,keyId,privateKey},delegatedAccountId,action='presence')=>{
  const raw=enc.encode(JSON.stringify({v:1,accountId,keyId,issuedAt:Date.now(),nonce:crypto.randomUUID(),action,delegatedAccountId,body:{accountId:'malicious-body-override'}}));
  const packet={payload:base64(raw),signature:base64(await crypto.subtle.sign('Ed25519',privateKey,raw))};
  return bridge(new Request('https://api.snaptvnow.com/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)}),{});
 };
 const accepted=await call(pairs[0],child);
 assert.equal(accepted.status,200);assert.equal((await accepted.json()).accountId,child);
 assert.equal(seen[0].body.accountId,child);
 assert.equal((await call(pairs[1],child)).status,403);
 assert.equal((await call(pairs[0],martin)).status,403);
 assert.equal((await call(pairs[0],child,'owner.check')).status,403);
 assert.equal(seen.length,1);
});

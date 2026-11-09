import assert from 'node:assert/strict';
import {createResellerBridge} from '../src/reseller-bridge.mjs';
import {BOXPANEL_RESELLER_ACCOUNTS,RESELLER_SERVICE_ACTIONS,TRUSTED_RESELLERS} from '../src/reseller-trust.mjs';
const luis=TRUSTED_RESELLERS.find(panel=>panel.accountId==='839b2ee6-efac-45e3-ac2a-26fbcb5f6a2b');
assert.equal(luis?.actions,RESELLER_SERVICE_ACTIONS);
assert.ok(!BOXPANEL_RESELLER_ACCOUNTS.includes(luis.accountId));
assert.equal(new Set(TRUSTED_RESELLERS.map(panel=>panel.accountId)).size,TRUSTED_RESELLERS.length);
const keys=await Promise.all(TRUSTED_RESELLERS.map(()=>crypto.subtle.generateKey('Ed25519',true,['sign','verify']))),scopes=await Promise.all(keys.map(async(pair,i)=>({accountId:'reseller-'+i,keyId:'key-'+i,publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),...(i?{actions:RESELLER_SERVICE_ACTIONS}:{})})));
let written=[],ownerCalls=0;const bridge=createResellerBridge(async(env,path,body)=>{written.push({path,body});return Response.json({ok:true,lineId:body.lineId,version:body.version});},scopes,{ownerAccess:async()=>{ownerCalls++;return Response.json({ok:true})}});
async function request(index,action,body={},extra={}){const scope=scopes[index],payload=Buffer.from(JSON.stringify({v:1,accountId:scope.accountId,keyId:scope.keyId,action,issuedAt:Date.now(),nonce:crypto.randomUUID(),body,...extra})),signature=Buffer.from(await crypto.subtle.sign('Ed25519',keys[index].privateKey,payload)).toString('base64url');return bridge(new Request('https://own.test/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload:payload.toString('base64url'),signature})}),{});}
for(const i of scopes.keys()){const r=await request(i,'apply',{accountId:scopes[(i+1)%scopes.length].accountId,lineId:'line-'+i,version:1});assert.equal(r.status,200);assert.equal((await r.json()).accountId,scopes[i].accountId);assert.equal(written.at(-1).body.accountId,scopes[i].accountId);}
for(const i of scopes.keys())if(i!==0)for(const action of ['owner.consume','owner.check','owner.revoke','portal.key','portal.configure','native.list','native.record','native.claim','native.verify','native.recover','ccf.record','diagnostics'])assert.equal((await request(i,action)).status,403,action);
assert.equal(ownerCalls,0);assert.equal((await request(0,'owner.check')).status,200);assert.equal(ownerCalls,1);
assert.equal((await request(1,'probe',{}, {accountId:scopes[0].accountId,keyId:scopes[0].keyId})).status,403);assert.equal((await request(1,'probe',{}, {accountId:'foreign'})).status,403);assert.equal((await request(1,'probe',{}, {issuedAt:Date.now()-46000})).status,403);
console.log('PASS: configured reseller keys, signature and account isolation, and denial of owner, portal, native-import and provider-export privileges.');

import assert from 'node:assert/strict';
import {createResellerBridge,verifyResellerPacket} from '../src/reseller-bridge.mjs';
import {accountsFetch} from '../src/accounts.mjs';
import worker,{PlaybackSession} from '../src/index.js';
class Store {
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}
 async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r;}
}
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const trust={accountId:'juanito-local-only',keyId:'local-test-key',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')};
const storage=new Store(),state={storage},objects=new Map(),env={TICKET_SECRET:'local-bridge-ticket-secret'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession(id==='__smn_accounts_v1'?state:{storage:new Store()},env));return {fetch:(u,o)=>objects.get(id).fetch(new Request(u,o))};}};
const directory=(env,path,body)=>accountsFetch(state,env,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));
const bridge=createResellerBridge(directory,trust);
async function packet(action,body,extra={}){const raw=new TextEncoder().encode(JSON.stringify({v:1,accountId:trust.accountId,keyId:trust.keyId,action,issuedAt:Date.now(),nonce:crypto.randomUUID(),body,...extra}));return {payload:Buffer.from(raw).toString('base64url'),signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,raw)).toString('base64url')};}
async function call(action,body,extra){const r=await bridge(new Request('https://api.test/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(await packet(action,body,extra))}),env);return {status:r.status,data:await r.json()};}
const line={lineId:'local-line-1',username:'clienteficticio',version:1,revoke:false,password:'local-password-12345',legacy:false,name:'Cliente ficticio',comments:'Comentario privado',status:'active',expiresAt:Date.now()+86400000,createdAt:Date.now(),permissions:{movies:true,series:true,tv:true,adults:false},connections:3};
const reservation={lineId:line.lineId,username:line.username,operationKey:'a'.repeat(43),payloadHash:'a'.repeat(64)};
for(const extra of [{accountId:'martin'},{issuedAt:Date.now()-46000},{keyId:'wrong'}])assert.equal((await call('probe',{},extra)).status,403);
const forged=await packet('probe',{});forged.payload=forged.payload.slice(0,-1)+'A';await assert.rejects(()=>verifyResellerPacket(forged,trust));
assert.equal((await call('probe',{})).status,200);
const simultaneous=await Promise.all([call('reserve',reservation),call('reserve',{...reservation,lineId:'local-line-duplicate'})]);assert.ok(simultaneous.every(r=>r.status===200));assert.equal(simultaneous[0].data.lineId,simultaneous[1].data.lineId);line.lineId=simultaneous[0].data.lineId;
assert.equal((await call('reserve',{...reservation,payloadHash:'b'.repeat(64)})).status,409);
assert.equal((await call('reserve',{...reservation,operationKey:'b'.repeat(43),lineId:'local-other'})).status,409);
assert.equal((await call('apply',line)).status,200);assert.equal((await call('apply',line)).data.replayed,true);
assert.equal((await call('apply',{...line,name:'Conflicting replay'})).status,409);
const committedRelease=await call('release',{...reservation,lineId:line.lineId});assert.equal(committedRelease.status,200);assert.equal(committedRelease.data.released,false);assert.ok(await storage.get('user:'+line.username));
const canceled={lineId:'local-canceled-line',username:'clientecancelado',operationKey:'c'.repeat(43),payloadHash:'c'.repeat(64)};
assert.equal((await call('reserve',canceled)).status,200);
assert.equal((await call('release',{...canceled,payloadHash:'d'.repeat(64)})).status,409);
assert.ok(await storage.get('reseller-reservation:'+canceled.username));
assert.equal((await call('release',canceled)).data.released,true);
assert.equal(await storage.get('reseller-reservation:'+canceled.username),undefined);
assert.equal((await call('release',canceled)).data.released,false);
const replacement={...canceled,lineId:'local-replacement-line',operationKey:'d'.repeat(43),payloadHash:'d'.repeat(64)};
assert.equal((await call('reserve',replacement)).status,200);
assert.equal((await call('release',canceled)).data.released,false);
assert.equal((await storage.get('reseller-reservation:'+canceled.username)).lineId,replacement.lineId);
const presence=await call('presence',{lines:[{lineId:line.lineId,username:line.username}]});assert.equal(presence.status,200);assert.equal(presence.data.lines[0].connectionsUsed,0);assert.equal((await call('presence',{lines:[{lineId:'another-line',username:line.username}]})).status,403);
const summary=await call('presence.summary',{});assert.equal(summary.status,200);assert.equal(summary.data.connectionsUsed,0);assert.equal(summary.data.linesOnline,0);assert.equal(summary.data.accountId,trust.accountId);assert.equal((await call('presence.summary',{}, {accountId:'martin'})).status,403);
const diagnostic=await call('diagnostics',{lines:[{lineId:line.lineId,username:line.username}]});assert.equal(diagnostic.status,200);assert.ok(Array.isArray(diagnostic.data.recent.groups));assert.ok(!JSON.stringify(diagnostic.data).includes(line.password));assert.equal((await call('diagnostics',{lines:[{lineId:'another-line',username:line.username}]})).status,403);
const stored=await storage.get('user:'+line.username);assert.equal(stored.password,undefined);assert.notEqual(stored.hash,line.password);
assert.equal((await call('apply',{...line,lineId:'another-line',version:2})).status,409);
await storage.put('user:unrelatedclient',{id:'foreign',username:'unrelatedclient',version:1});assert.equal((await call('apply',{...line,lineId:'foreign-line',username:'unrelatedclient'})).status,409);
const root='https://api.test',request=async b=>{const r=await worker.fetch(new Request(root+'/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),env);return {status:r.status,data:await r.json()};};
const auth=await request({op:'auth',username:line.username,password:line.password});assert.equal(auth.status,200);const token=auth.data.access_token;assert.equal(auth.data.account_expires_at,line.expiresAt);
let native=await worker.fetch(new Request(root+'/player_api.php?'+new URLSearchParams({username:line.username,password:line.password})),env);assert.equal(native.status,200);assert.equal((await native.json()).user_info.auth,1);
assert.equal((await request({op:'session_info',access_token:token})).status,200);
const notes=await call('apply',{...line,version:2,comments:'Nueva nota'});assert.equal(notes.data.sessionsRevoked,false);assert.equal((await request({op:'session_info',access_token:token})).status,200);
// Per-customer capacity applies to web and native allocations together.
await storage.put('provider',{mode:'panel'});await storage.put('pool',{syncedAt:Date.now(),lines:[{id:'provider-1',external:0,maxConnections:12,encrypted:'test-only'}]});
const acquired=await Promise.all(Array.from({length:4},(_,i)=>directory(env,'/acquire',{sid:'local-sid-'+i,username:line.username,uid:stored.id,version:stored.version,xtream:i%2===1})));assert.equal(acquired.filter(r=>r.status===200).length,3);assert.equal(acquired.filter(r=>r.status===409).length,1);
assert.equal((await call('apply',{...line,version:3,status:'suspended'})).status,200);assert.equal((await request({op:'session_info',access_token:token})).status,401);assert.equal((await request({op:'auth',username:line.username,password:line.password})).status,401);
assert.equal((await call('apply',{...line,version:2})).status,409);
assert.equal((await call('apply',{...line,version:4,expiresAt:Date.now()-1})).status,200);assert.equal((await request({op:'auth',username:line.username,password:line.password})).status,401);
native=await worker.fetch(new Request(root+'/player_api.php?'+new URLSearchParams({username:line.username,password:line.password})),env);assert.equal(native.status,401);
assert.equal((await call('apply',{...line,version:5})).status,200);assert.equal((await request({op:'auth',username:line.username,password:line.password})).status,200);
assert.equal((await call('apply',{lineId:line.lineId,username:line.username,version:6,revoke:true})).status,200);assert.equal((await request({op:'auth',username:line.username,password:line.password})).status,401);
console.log('PASS: signed single-reseller scope, stale and forged requests, atomic reservation, safe replay, foreign-user isolation, private credential hashes, real web/Xtream login, shared three-slot capacity, notes, suspension, expiration and revoke.');

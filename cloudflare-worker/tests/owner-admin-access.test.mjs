import {createOwnerPortal} from '../src/owner-portal.mjs';
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {createOwnerAdminAccess,ownerAccessState,OWNER_ADMIN_ORIGIN} from '../src/owner-admin-access.mjs';
import {createResellerBridge} from '../src/reseller-bridge.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve();}async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}async deleteAll(){this.data.clear();}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r;}}
const objects=new Map(),env={TICKET_SECRET:'synthetic-owner-access-key',ADMIN_SETUP_SECRET:'synthetic-owner-access-setup-key-123456789',WEB_ORIGINS:'https://app.snaptvnow.com'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(u,o)=>objects.get(id).fetch(new Request(u,o))};}};
const sessionCall=(env,sid,path,body)=>env.PLAYBACK_SESSIONS.get(sid).fetch('https://private'+path,{method:'POST',body:JSON.stringify(body)});
const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.TICKET_SECRET)),'AES-GCM',false,['encrypt','decrypt']);
const ticket=async(env,data)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data)));return Buffer.concat([iv,Buffer.from(cipher)]).toString('base64url');};
const unticket=async(env,token)=>{try{const raw=Buffer.from(token,'base64url'),value=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.subarray(0,12)},key,raw.subarray(12))));return value.exp>Date.now()?value:null;}catch{return null;}};
const access=createOwnerAdminAccess({ticket,unticket,sessionCall});
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),trust={accountId:'synthetic-owner-site',keyId:'synthetic-owner-key',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')};
const bridge=createResellerBridge(()=>{throw Error('Unexpected directory request');},trust,{ownerAccess:(env,action,body)=>access.bridge(env,action,body)});
async function api(action,extra={},origin='https://app.snaptvnow.com'){return worker.fetch(new Request('https://api.snaptvnow.com/admin',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({action,...extra})}),env);}
async function signed(action,body){const raw=new TextEncoder().encode(JSON.stringify({v:1,action,body,accountId:trust.accountId,keyId:trust.keyId,nonce:crypto.randomUUID(),issuedAt:Date.now()}));return bridge(new Request('https://api.snaptvnow.com/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload:Buffer.from(raw).toString('base64url'),signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,raw)).toString('base64url')})}),env);}
assert.equal((await api('reseller-admin-launch')).status,401);
assert.equal((await api('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'synthetic-owner',password:'synthetic-owner-password'})).status,200);
const login=await (await api('login',{username:'synthetic-owner',password:'synthetic-owner-password'})).json(),access_token=login.access_token;
assert.equal((await api('reseller-admin-launch',{access_token},'https://evil.test')).status,403);
assert.equal((await api('reseller-admin-launch',{access_token},'')).status,403);
async function launch(){const response=await api('reseller-admin-launch',{access_token});assert.equal(response.status,200);const value=await response.json(),url=new URL(value.url);assert.equal(url.origin,'https://api.snaptvnow.com');assert.equal(url.pathname,'/owner-panel/enter');assert.ok(!url.href.includes(access_token));return url.searchParams.get('code');}
const code=await launch(),identityId='synthetic-sites-owner';
assert.equal((await signed('owner.check',{token:code,identityId})).status,403,'a launch cannot be used as a gate');
assert.equal((await signed('owner.consume',{token:code.slice(0,-3)+'abc',identityId})).status,403,'tampered encrypted launch denied');
const concurrent=await Promise.all(Array.from({length:12},()=>signed('owner.consume',{token:code,identityId})));assert.equal(concurrent.filter(r=>r.status===200).length,1,'exactly one concurrent consume wins');
const gate=await concurrent.find(r=>r.status===200).json();assert.ok(gate.token);assert.equal(gate.accountId,trust.accountId);assert.ok(gate.exp<=Date.now()+1800000);
assert.equal((await signed('owner.consume',{token:code,identityId})).status,403,'replay denied');
assert.equal((await signed('owner.check',{token:gate.token,identityId:'another-owner'})).status,403,'bound to Sites identity');
assert.equal((await signed('owner.check',{token:gate.token,identityId})).status,200);
assert.equal((await signed('owner.revoke',{token:gate.token,identityId})).status,200);
assert.equal((await signed('owner.check',{token:gate.token,identityId})).status,403,'explicit logout revokes gate');
// Exercise the public handoff using the actual administrator session and signed bridge.
let gatewayCalls=0;const portal=createOwnerPortal({getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'a'.repeat(64),siteToken:'synthetic-private-dispatch-token'}),fetcher:async(url,options)=>{gatewayCalls++;assert.equal(url,PORTAL_SOURCE+'/api/owner-portal');assert.equal(options.redirect,'manual');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer synthetic-private-dispatch-token');const b=JSON.parse(options.body);assert.equal(b.accountId,PORTAL_ACCOUNT);if(b.action==='enter')return signed('owner.consume',{token:b.token,identityId});const check=await signed('owner.check',{token:b.token,identityId});if(!check.ok)return Response.json({error:'owner_entry_required'},{status:401});if(b.action==='logout')return signed('owner.revoke',{token:b.token,identityId});return Response.json(b.action==='read'?{actor:{id:'owner',role:'owner'},target:{id:b.query.slug||'owner'},overview:!b.query.slug,accounts:[],lines:[]}:{ok:true,actorId:'owner'});}});
const request=(path,options={})=>portal(new Request('https://api.snaptvnow.com/owner-panel'+path,options),env);
assert.equal((await request('/')).status,403);assert.equal((await request('/api/panel')).status,401);assert.equal(gatewayCalls,0);
const entryCode=await launch(),entered=await request('/enter?code='+encodeURIComponent(entryCode));assert.equal(entered.status,303);assert.equal(entered.headers.get('Location'),'/owner-panel/');const setCookie=entered.headers.get('Set-Cookie'),ownerCookie=setCookie.split(';')[0];for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(setCookie.includes(flag));assert.equal((await request('/enter?code='+encodeURIComponent(entryCode))).status,403);
const protectedPage=await request('/',{headers:{Cookie:ownerCookie}});assert.equal(protectedPage.status,200);const html=await protectedPage.text();assert.ok(html.includes('data-portal-mode="owner"'));assert.ok(!html.includes(entryCode));assert.ok(!html.includes('synthetic-private-dispatch-token'));assert.ok(!html.includes(access_token));assert.equal(protectedPage.headers.get('Referrer-Policy'),'no-referrer');
const martin=await request('/api/panel?slug=martin-vela',{headers:{Cookie:ownerCookie}});assert.equal(martin.status,200);assert.equal((await martin.json()).target.id,'martin-vela');
const before=gatewayCalls;for(const origin of ['', 'https://evil.test'])assert.equal((await request('/api/panel',{method:'POST',headers:{Cookie:ownerCookie,'Content-Type':'application/json',Origin:origin},body:'{}'})).status,403);assert.equal(gatewayCalls,before);
assert.equal((await request('/api/panel?endpoint=https://evil.test',{headers:{Cookie:ownerCookie}})).status,400);assert.equal((await request('/api/panel',{headers:{Cookie:ownerCookie+'; '+ownerCookie}})).status,401);
const nextCode=await launch(),next=await (await signed('owner.consume',{token:nextCode,identityId})).json();
assert.equal((await api('logout',{access_token})).status,200);
assert.equal((await signed('owner.check',{token:next.token,identityId})).status,403,'main administrator logout revokes gate');assert.equal((await request('/',{headers:{Cookie:ownerCookie}})).status,403,'main logout also blocks the real public owner route');
assert.equal((await signed('owner.consume',{token:await ticket(env,{kind:'owner_launch',sid:'unknown',nonce:'forged',exp:Date.now()+120000}),identityId})).status,403);
const time=1000000,storage=new Store();const state=(path,body={},now=time)=>ownerAccessState(storage,'/owner-access/'+path,body,time+3600000,true,now);
const old=await (await state('issue')).json();assert.equal((await state('consume',{nonce:old.nonce,identityId},time+120001)).status,403,'expired launch denied');
const fresh=await (await state('issue',{},time+120001)).json(),idleGate=await (await state('consume',{nonce:fresh.nonce,identityId},time+120002)).json();assert.equal((await state('check',{gateId:idleGate.gateId,identityId},time+1020003)).status,403,'idle session denied after 15 minutes');
const limited=new Store();for(let i=0;i<6;i++)assert.equal((await ownerAccessState(limited,'/owner-access/issue',{},time+3600000,true,time)).status,200);assert.equal((await ownerAccessState(limited,'/owner-access/issue',{},time+3600000,true,time)).status,429);
assert.equal((await ownerAccessState(new Store(),'/owner-access/issue',{},time+3600000,false,time)).status,403,'customer session cannot mint owner grants');
assert.equal((await bridge(new Request('https://api.snaptvnow.com/reseller-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"owner.consume"}'}),env)).status,403,'unsigned bridge request denied');
console.log('PASS: authenticated owner launch, fixed destination, tamper resistance, atomic single use, identity binding, expiry, rate limit and main/logout revocation.');

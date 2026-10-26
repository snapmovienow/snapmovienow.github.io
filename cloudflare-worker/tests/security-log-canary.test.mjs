import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{PlaybackSession} from '../src/index.js';
import {SECURITY_CANARY_ID,SECURITY_CANARY_OBJECT,SECURITY_CANARY_START,SECURITY_CANARY_EXPIRES,SECURITY_CANARY_OLD,SECURITY_CANARY_NEW,securityCanaryAdmin,securityCanaryStatus,runSecurityCanary} from '../src/security-log-canary.mjs';
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve();}async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}async deleteAll(){this.data.clear();}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result;}}
const now=()=>SECURITY_CANARY_START+1000,siteToken='SYNTHETIC_SITE_TOKEN_NOT_FOR_LOGS',secret='SYNTHETIC_GATEWAY_SECRET_NOT_FOR_TRANSPORT';
const config={accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,siteToken,get gatewaySecret(){throw Error('MUST_NOT_ACCESS_REAL_GATEWAY_SECRET');}};
let calls=0,bodyReads=0,bodyCancels=0;
const fetcher=async(url,options)=>{
 calls++;assert.equal(url,PORTAL_SOURCE+'/api/portal');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.body,'{}');assert.ok(options.signal instanceof AbortSignal);
 const h=new Headers(options.headers);assert.equal(h.get('OAI-Sites-Authorization'),'Bearer '+siteToken);assert.equal(h.get('X-SNAP-Portal-Gateway'),SECURITY_CANARY_OLD);assert.equal(h.get('X-SNAP-Portal-Gateway-Token'),SECURITY_CANARY_NEW);assert.equal(h.has('Cookie'),false);assert.equal(h.has('Authorization'),false);assert.equal(JSON.stringify(options).includes(secret),false);
 return {status:404,headers:new Headers({'cf-ray':'0123456789abcdef-ORD','set-cookie':secret}),body:{cancel:async()=>{bodyCancels++;}},text:async()=>{bodyReads++;throw Error(secret);},json:async()=>{bodyReads++;throw Error(secret);}};
};
const store=new Store(),options={getConfig:async()=>config,fetcher,now};
assert.equal((await (await securityCanaryStatus(store,now())).json()).state,'ready');assert.equal(calls,0);
const responses=await Promise.all(Array.from({length:24},()=>runSecurityCanary(store,{},options)));
assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,23);assert.equal(calls,1);assert.equal(bodyReads,0);assert.equal(bodyCancels,1);
const complete=await (await securityCanaryStatus(store,now())).json();assert.equal(complete.state,'complete');assert.equal(complete.httpStatus,404);assert.equal(complete.expectedRejection,true);assert.equal(complete.consumed,true);
const snapshot=JSON.stringify([...store.data]);for(const x of [siteToken,secret,'set-cookie','OAI-Sites-Authorization'])assert.equal(snapshot.includes(x),false);
// Recreate the object/module caller with the same durable store: no reset.
assert.equal((await runSecurityCanary(store,{},options)).status,409);assert.equal(calls,1);
for(const time of [SECURITY_CANARY_START-1,SECURITY_CANARY_EXPIRES,SECURITY_CANARY_EXPIRES+1]){
 const expired=new Store();assert.equal((await runSecurityCanary(expired,{}, {...options,now:()=>time})).status,410);assert.equal(expired.data.size,0);
}
for(const storage of [{transaction:async()=>{throw Error(secret);}}, {transaction:async fn=>{const s=new Store();await fn(s);throw Error(secret);}}]){
 assert.equal((await runSecurityCanary(storage,{},options)).status,503);
}
assert.equal(calls,1,'uncertain storage never forwards');
const unavailable=new Store();const noConfig=await (await runSecurityCanary(unavailable,{}, {...options,getConfig:async()=>null})).json();assert.equal(noConfig.state,'configuration_unavailable');assert.equal((await runSecurityCanary(unavailable,{},options)).status,409);assert.equal(calls,1);
const uncertain=new Store();let attempts=0;
const failed=await runSecurityCanary(uncertain,{}, {...options,fetcher:async()=>{attempts++;throw Error(siteToken+secret);}});assert.equal((await failed.json()).state,'uncertain');assert.equal((await runSecurityCanary(uncertain,{},options)).status,409);assert.equal(attempts,1);assert.equal(calls,1);
const finalWriteFails=new Store();let puts=0;const originalPut=finalWriteFails.put.bind(finalWriteFails);finalWriteFails.put=async(k,v)=>{if(++puts>1)throw Error(secret);return originalPut(k,v);};
assert.equal((await runSecurityCanary(finalWriteFails,{},options)).status,503);assert.equal((await runSecurityCanary(finalWriteFails,{},options)).status,409);assert.equal(calls,2,'completed request is not repeated after result-persistence failure');
const redirect=new Store();let redirects=0;const redir=await (await runSecurityCanary(redirect,{}, {...options,fetcher:async()=>{redirects++;return new Response(null,{status:302,headers:{Location:'https://evil.test/'+secret}});}})).json();assert.equal(redirects,1);assert.equal(redir.httpStatus,302);assert.equal(redir.expectedRejection,false);assert.equal(JSON.stringify(redir).includes(secret),false);
let dispatched=0;const dispatch=async()=>{dispatched++;return Response.json({ok:true});};
const request=(origin='https://app.snaptvnow.com',extra={})=>new Request('https://api.snaptvnow.com/admin',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...extra},body:'{}'});
const valid={action:'security-log-canary-run',confirm:SECURITY_CANARY_ID};
for(const session of [null,{}, {kind:'session'}])assert.equal((await securityCanaryAdmin(request(),valid,session,dispatch)).status,401);
for(const origin of ['', 'https://evil.test','https://snaptvnow-resellers.juancanta89.chatgpt.site'])assert.equal((await securityCanaryAdmin(request(origin),valid,{kind:'admin'},dispatch)).status,403);
assert.equal((await securityCanaryAdmin(request(undefined,{'Sec-Fetch-Site':'cross-site'}),valid,{kind:'admin'},dispatch)).status,403);
for(const body of [{...valid,confirm:'wrong'},{...valid,url:'https://evil.test'},{...valid,token:secret},{...valid,headers:{}},{...valid,reset:true},{action:'security-log-canary-status',confirm:SECURITY_CANARY_ID}])assert.equal((await securityCanaryAdmin(request(),body,{kind:'admin'},dispatch)).status,400);
assert.equal(dispatched,0);
assert.equal((await securityCanaryAdmin(request(),{...valid,browser_cookie:true},{kind:'admin'},dispatch)).status,200);assert.equal(dispatched,1);
// Actual index.js authentication: no admin, forged token and a live non-admin
// session must be denied before contacting the diagnostic object or Sites.
const objects=new Map(),env={TICKET_SECRET:'synthetic-canary-test-signing-only',ADMIN_SETUP_SECRET:'synthetic-canary-setup-test-only-123456789',WEB_ORIGINS:'https://app.snaptvnow.com'};let canaryObjectAccess=0;
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(id===SECURITY_CANARY_OBJECT)canaryObjectAccess++;if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(u,o)=>objects.get(id).fetch(new Request(u,o))};}};
const api=body=>worker.fetch(new Request('https://api.snaptvnow.com/admin',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.snaptvnow.com'},body:JSON.stringify(body)}),env);
assert.equal((await api(valid)).status,401);assert.equal((await api({...valid,access_token:'forged'})).status,401);assert.equal(canaryObjectAccess,0);
assert.equal((await api({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'synthetic-canary-admin',password:'synthetic-canary-admin-password'})).status,200);
const login=await (await api({action:'login',username:'synthetic-canary-admin',password:'synthetic-canary-admin-password'})).json();assert.equal(typeof login.access_token,'string');
assert.equal((await api({action:'security-log-canary-status',access_token:login.access_token})).status,200);assert.equal(canaryObjectAccess,1);
assert.equal((await api({action:'logout',access_token:login.access_token})).status,200);
assert.equal((await api({action:'security-log-canary-status',access_token:login.access_token})).status,401);assert.equal(canaryObjectAccess,1,'revoked session never reaches diagnostic object');
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.ok(src.indexOf("if(action==='security-log-canary-status'")>src.indexOf('s?.kind!=="admin"'));assert.ok(src.includes("sessionCall(env,s.sid,\"/check\")"));
console.log('PASS: fixed marker-only transport; 24-way atomic claim, durable replay denial, expiry, storage uncertainty, zero response-body reads, no retries/redirects, administrator/CSRF/input restrictions.');

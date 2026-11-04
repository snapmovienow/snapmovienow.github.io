import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const clientSource=readFileSync(new URL('../session-client.js',import.meta.url),'utf8');
const token=username=>({username,access_token:'fixture-token-'+username});
function fixture({cookieMode=false,seed,blocked=false,quota=false,immutable=false,now=performance.now.bind(performance)}={}){
 const data=new Map(seed?[['smn_session',JSON.stringify(seed)]]:[]),fault={blocked,quota,immutable},calls=[],elements=new Map();
 function node(){const classes=new Set();return {value:'',textContent:'',hidden:false,disabled:false,children:[],listeners:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},addEventListener(type,fn){this.listeners[type]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}}}
 const document={body:node(),getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id)},createElement:()=>node()};
 document.getElementById('user').value='fixture-user';document.getElementById('pass').value='fixture-password';document.getElementById('sessionNotice').hidden=true;
 let auth=async body=>({user_info:{auth:1,username:body.username||seed?.username||'fixture-user'},access_token:token(body.username||seed?.username||'fixture-user').access_token,permissions:{movies:true,series:true,tv:true},session_expires_at:Date.now()+3600000,server_time:Date.now()});
 let remoteLogout=async()=>Response.json({ok:true});let catalogs=0,expiryArms=0,expiryInfo;
 const storage={getItem(k){if(fault.blocked)throw Error('SecurityError');return data.get(k)??null},setItem(k,v){if(fault.blocked||fault.quota||fault.immutable)throw Error('QuotaExceededError');data.set(k,v)},removeItem(k){if(fault.blocked||fault.immutable)throw Error('SecurityError');data.delete(k)}};
 const ctx=vm.createContext({document,performance,AbortSignal,Response,SMNConfig:{cookieMode},profileSync:null,profilePreferences:{},favorites:[],currentPlay:null,location:{pathname:'/',href:''},sessionExpiry:{cancel(){}},armSessionExpiry(){expiryArms++},loadUserFavorites(){},async loadCatalog(){catalogs++;document.getElementById('content').hidden=false;return false},saveContinue(){},stopPlayback(){},resetLiveDiagnostics(){},SMNConnection:{message:(_e,fallback)=>fallback,async requestJSON(_url,options){const body=JSON.parse(options.body);calls.push({kind:'api',body,credentials:options.credentials});return auth(body)}},async fetch(_url,options){calls.push({kind:'logout',body:JSON.parse(options.body),credentials:options.credentials});return remoteLogout(options)}});
 Object.defineProperty(ctx,'localStorage',{get(){if(fault.blocked)throw Error('SecurityError');return storage}});
 Object.defineProperty(ctx,'sessionStorage',{get(){if(fault.blocked)throw Error('SecurityError');return storage}});
 ctx.performance={now};
 vm.runInContext(clientSource,ctx);
 vm.runInContext(app.slice(0,app.indexOf('async function loadCatalog(')),ctx);
 vm.runInContext(app.slice(app.indexOf('async function logout('),app.indexOf('const searchPanel=')),ctx);
 const a=app.indexOf('async function restoreSession('),b=app.indexOf('function profileReference(',a);
 vm.runInContext(app.slice(a,b).replace(/restoreSession\(\);\s*$/,''),ctx);
 ctx.armSessionExpiry=info=>{expiryArms++;expiryInfo=info};
 return {ctx,data,fault,calls,document,client:ctx.SMNSessionClient,storage,get catalogs(){return catalogs},get expiryArms(){return expiryArms},get expiryInfo(){return expiryInfo},setAuth:fn=>auth=fn,setLogout:fn=>remoteLogout=fn,run:source=>vm.runInContext(source,ctx),state:()=>JSON.parse(vm.runInContext('JSON.stringify({authenticated,creds,authGeneration,pendingLogout})',ctx))};
}

for(const cookieMode of [false,true])for(const mode of ['quota','blocked'])test('valid login remains usable with '+mode+', cookies='+cookieMode,async()=>{
 const f=fixture({cookieMode,[mode]:true});await f.run('doLogin()');
 assert.equal(f.state().authenticated,true);assert.equal(f.catalogs,1);assert.equal(f.expiryArms,1);
 assert.equal(f.state().creds.access_token,cookieMode?'cookie':'fixture-token-fixture-user');
 assert.equal(Object.hasOwn(f.state().creds,'password'),false);assert.equal(f.data.has('smn_session'),false);
 assert.equal(f.document.getElementById('content').hidden,false);
 assert.equal(f.document.getElementById('sessionNotice').hidden,false);assert.match(f.document.getElementById('sessionNotice').textContent,/Sesión temporal/);
 assert.equal(f.document.getElementById('msg').textContent,'');assert.equal(f.document.getElementById('submit').disabled,false);
});

test('blocked access-notice storage does not interrupt startup',()=>{
 const f=fixture({blocked:true});const a=app.indexOf('const accessNotice='),b=app.indexOf('async function restoreSession(',a);
 assert.doesNotThrow(()=>f.run(app.slice(a,b)));assert.equal(f.state().creds,null);
});

test('invalid account and missing token never become temporary authenticated sessions',async()=>{
 for(const response of [{user_info:{auth:0}},{user_info:{auth:1,username:'fixture-user'}}]){
  const f=fixture({blocked:true});f.setAuth(async()=>response);await f.run('doLogin()');
  assert.equal(f.state().authenticated,false);assert.equal(f.state().creds,null);assert.equal(f.catalogs,0);
  assert.equal(f.document.getElementById('sessionNotice').hidden,true);assert.ok(f.document.getElementById('msg').textContent);
 }
});

test('normal persistence stores only username and token; cookie mode stores the sentinel',async()=>{
 for(const cookieMode of [false,true]){
  const f=fixture({cookieMode});await f.run('doLogin()');
  assert.deepEqual(JSON.parse(f.data.get('smn_session')),{username:'fixture-user',access_token:cookieMode?'cookie':'fixture-token-fixture-user'});
  assert.equal(f.document.getElementById('sessionNotice').hidden,true);
 }
});

test('restoration with immutable storage does not revoke its own valid token',async()=>{
 const f=fixture({seed:token('restored'),immutable:true});await f.run('restoreSession()');
 assert.equal(f.state().authenticated,true);assert.equal(f.catalogs,1);assert.equal(f.calls.filter(x=>x.kind==='logout').length,0);
});

test('a quota failure removes a previous saved token without extra server requests',async()=>{
 const f=fixture({seed:token('older'),quota:true});await f.run('doLogin()');
 assert.equal(f.state().authenticated,true);assert.equal(f.data.has('smn_session'),false);assert.equal(f.calls.filter(x=>x.kind==='logout').length,0);
});

test('immutable old bearer is revoked without cookies before accepting a different token',async()=>{
 for(const old of [token('older'),{username:'fixture-user',access_token:'fixture-older-token'}]){
  const f=fixture({seed:old,immutable:true});await f.run('doLogin()');
  assert.equal(f.state().authenticated,true);assert.equal(f.catalogs,1);
  assert.deepEqual(f.calls.filter(x=>x.kind==='logout').map(x=>({body:x.body,credentials:x.credentials})),[{body:{op:'logout',access_token:old.access_token},credentials:'omit'}]);
 }
});

test('unconfirmed old bearer cleanup is explicit and never blamed on the password',async()=>{
 const f=fixture({seed:token('older'),immutable:true});f.setLogout(async()=>Response.json({ok:false},{status:503}));await f.run('doLogin()');
 assert.equal(f.state().authenticated,false);assert.equal(f.catalogs,0);
 assert.match(f.document.getElementById('msg').textContent,/cerrar el acceso anterior/);
 assert.doesNotMatch(f.document.getElementById('msg').textContent,/Verifica tus datos/);
});

test('an already expired or revoked immutable bearer cannot block a valid new login',async()=>{
 const f=fixture({seed:token('expired'),immutable:true});
 f.setLogout(async()=>Response.json({error:'session_required'},{status:401}));await f.run('doLogin()');
 assert.equal(f.state().authenticated,true);assert.equal(f.catalogs,1);
});

test('only an explicit server acknowledgement or its exact invalid-session code confirms cleanup',async()=>{
 for(const response of [Response.json({}),Response.json({error:'auth'},{status:401}),Response.json({error:'session_required'},{status:403}),new Response('<html>blocked</html>',{status:401})]){
  const f=fixture({seed:token('older'),immutable:true});f.setLogout(async()=>response);await f.run('doLogin()');
  assert.equal(f.state().authenticated,false);assert.equal(f.catalogs,0);
 }
});

test('a cookie sentinel is never used to revoke the newly authenticated cookie',async()=>{
 const f=fixture({cookieMode:true,seed:{username:'older',access_token:'cookie'},immutable:true});await f.run('doLogin()');
 assert.equal(f.state().authenticated,true);assert.equal(f.calls.filter(x=>x.kind==='logout').length,0);
});

test('waiting for previous-session cleanup does not extend the signed access deadline',async()=>{
 let now=0;const f=fixture({seed:token('older'),immutable:true,now:()=>now});
 f.setLogout(async()=>{now=5000;return Response.json({ok:true})});await f.run('doLogin()');
 assert.equal(f.state().authenticated,true);assert.equal(f.expiryInfo.network_age_ms,5000);
});

test('late cleanup cannot overwrite a newer login or revive a logged-out session',async()=>{
 for(const newer of ['logout','login']){
  const f=fixture({seed:token('older'),immutable:true});let release;
  f.setLogout(()=>new Promise(resolve=>release=resolve));const pending=f.run('doLogin()');
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  f.fault.immutable=false;f.setLogout(async()=>Response.json({ok:true}));
  if(newer==='logout')await f.run('logout()');
  else {f.document.getElementById('user').value='newer';f.document.getElementById('pass').value='fixture-password';await f.run('doLogin()')}
  release(Response.json({ok:true}));await pending;
  assert.equal(f.state().authenticated,newer==='login');assert.equal(f.state().creds?.username,newer==='login'?'newer':undefined);
 }
});

test('logout revokes the server session even when both storage accessors fail',async()=>{
 const f=fixture();await f.run('doLogin()');f.fault.blocked=true;await f.run("logout('Tu acceso venció.')");
 assert.equal(f.state().authenticated,false);assert.equal(f.state().creds,null);assert.equal(f.state().pendingLogout,null);
 assert.equal(f.ctx.location.href,'/');assert.equal(f.calls.filter(x=>x.kind==='logout').length,1);
});

test('failed local removal and server logout stay logged out locally and allow an explicit retry',async()=>{
 const f=fixture();await f.run('doLogin()');f.fault.immutable=true;f.setLogout(async()=>{throw Error('offline')});await f.run('logout()');
 assert.equal(f.state().authenticated,false);assert.equal(f.state().creds,null);assert.equal(f.ctx.location.href,'');
 assert.match(f.document.getElementById('sessionNotice').textContent,/no pudimos confirmar/);
 assert.equal(f.document.getElementById('sessionNotice').children.at(-1).textContent,'Reintentar cierre');
 const before=f.calls.filter(x=>x.kind==='api').length;await f.run('doLogin()');assert.equal(f.calls.filter(x=>x.kind==='api').length,before);
 f.setLogout(async()=>Response.json({ok:true}));await f.run('logout()');assert.equal(f.ctx.location.href,'/');assert.equal(f.state().pendingLogout,null);
});

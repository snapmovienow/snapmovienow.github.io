import assert from 'node:assert/strict';
import {createResellerPortal,matchesResellerPortal,UNIFIED_PORTAL_HOST,UNIFIED_PORTAL_PREFIX,PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
import {PORTAL_SCRIPT} from '../src/reseller-panel-assets.mjs';
const origin='https://'+UNIFIED_PORTAL_HOST,secret='f'.repeat(64),sessions=new Map([['a'.repeat(64),'juanito-fixture'],['b'.repeat(64),'martin-fixture']]),calls=[];let owner=false,foreign=false;
const portal=createResellerPortal({getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:secret,siteToken:'fictional-site-token'}),fetcher:async(url,options)=>{
 assert.equal(url,PORTAL_SOURCE+'/api/portal');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['oai-authenticated-user-id'],undefined);assert.equal(options.headers['X-SNAP-Portal-Gateway'],secret);const body=JSON.parse(options.body);calls.push(body);assert.equal(body.accountId,PORTAL_ACCOUNT);assert.equal(body.mode,'unified');
 if(body.action==='login'){const token=body.username==='juanito'?'a'.repeat(64):body.username==='martinvela2326'?'b'.repeat(64):null;return token?Response.json({ok:true,token,accountId:sessions.get(token)}):Response.json({error:'portal_login',message:'Datos de acceso no válidos.'},{status:401});}
 if(body.action==='logout')return Response.json({ok:true});const id=sessions.get(body.token);if(!id)return Response.json({error:'portal_session'},{status:401});
 if(body.action==='write')return Response.json({ok:true,actorId:id});return Response.json({actor:{id,role:owner?'owner':'reseller'},target:{id},overview:false,accounts:[],lines:[{id:'fictional-line',account_id:foreign?'other':id}],ledger:[{account_id:id}],authMode:'password'});
}});
const request=(path='/',method='GET',body,headers={},base=origin)=>portal(new Request(base+path,{method,headers:{...(method==='POST'?{'Content-Type':'application/json',Origin:new URL(base).origin}:{}),...headers},body:body?JSON.stringify(body):undefined}),{});
const html=await request();assert.equal(html.status,200);assert.ok((await html.text()).includes('data-portal-mode="unified"'));assert.ok(html.headers.get('Strict-Transport-Security'));
assert.equal((await request('/api/panel')).status,401);assert.equal(calls.length,0);
const cookies=[];
for(const [username,id] of [['juanito','juanito-fixture'],['martinvela2326','martin-fixture']]){
 const login=await request('/api/portal/login','POST',{username,password:'00000123456789012',accountId:'owner',mode:'owner'});assert.equal(login.status,200);assert.deepEqual(await login.json(),{ok:true});assert.equal(calls.at(-1).username,username);assert.equal(calls.at(-1).mode,'unified');
 const cookie=login.headers.get('Set-Cookie');for(const value of ['__Host-SNAP_Resellers=','Path=/','Secure','HttpOnly','SameSite=Strict'])assert.ok(cookie.includes(value));const header=cookie.split(';')[0];cookies.push(header);
 const response=await request('/api/panel?view=lines','GET',undefined,{Cookie:header,'oai-authenticated-user-id':'forged-owner'}),view=await response.json();assert.equal(response.status,200);assert.equal(view.actor.id,id);assert.equal(view.lines[0].account_id,id);assert.equal(view.target.panelAccess.url,origin);assert.ok(!JSON.stringify(view).includes(header.split('=')[1]));
 assert.equal((await request('/api/panel','GET',undefined,{Cookie:header+'; '+header})).status,401);
}
assert.notEqual(cookies[0],cookies[1]);
assert.equal((await request('/api/panel','GET',undefined,{Cookie:cookies[0].replace('__Host-SNAP_Resellers','__Host-SNAP_Reseller')})).status,401);
owner=true;assert.equal((await request('/api/panel','GET',undefined,{Cookie:cookies[0]})).status,503);owner=false;foreign=true;assert.equal((await request('/api/panel','GET',undefined,{Cookie:cookies[0]})).status,503);foreign=false;
assert.equal((await request('/api/portal/login','POST',{username:'unknown',password:'00000123456789012'})).status,401);
assert.equal((await request('/api/portal/login','POST',{}, {Origin:'https://foreign.example'})).status,403);assert.equal((await request('/api/portal/login','POST',{}, {'Content-Type':'text/plain'})).status,415);
const fallback=await request('','GET',undefined,{},'https://api.snaptvnow.com'+UNIFIED_PORTAL_PREFIX);assert.ok((await fallback.text()).includes('data-portal-base="/resellers"'));
assert.ok(matchesResellerPortal(new Request(origin+'/')));assert.ok(matchesResellerPortal(new Request('https://api.snaptvnow.com/resellers')));assert.equal((await request('/admin')).status,404);
const logout=await request('/api/portal/logout','POST',{}, {Cookie:cookies[0]});assert.ok(logout.headers.get('Set-Cookie').includes('__Host-SNAP_Resellers=;'));assert.ok(logout.headers.get('Set-Cookie').includes('Max-Age=0'));
assert.ok(PORTAL_SCRIPT.includes('Panel de resellers'));for(const value of ['OAI-Sites-Authorization','SNAPTVNOW_PORTAL_GATEWAY_SECRET','LINE_CREDENTIAL_KEY'])assert.ok(!PORTAL_SCRIPT.includes(value));
console.log('PASS: common HTTPS portal accepts individual usernames, keeps session cookies separate, strips credentials and forged scope, rejects owner/foreign replies, preserves fallback and protects CSRF/logout.');

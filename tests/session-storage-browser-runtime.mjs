// Exercise the shipped page and login handlers in Chromium. All accounts,
// cookies and API replies are synthetic, and no external service is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd(),apiOrigin='http://127.0.0.1:8787';
const username='storage-user',password='synthetic-storage-password',token='synthetic-storage-token',oldToken='synthetic-old-storage-token';
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
 const ext=path.extname(file);
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[ext]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
let browser,base;

async function fixture({cookieMode=false,mode='normal',seed=false},run){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const state={validSession:seed,authCalls:0,restores:0,logouts:0,logoutFailure:false,previousActive:false,previousLogouts:0,previousCookie:null,operations:[],external:[]},errors=[];
 await context.addInitScript(({mode,seed,username,token,cookieMode})=>{
  const local=window.localStorage,session=window.sessionStorage;
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
  if(seed)set.call(local,'smn_session',JSON.stringify({username,access_token:cookieMode?'cookie':token}));
  let localFault=mode,sessionFault=false;const writes=[];
  window.__sessionStorageFixture={
   fault(localMode,blockSession=false){localFault=localMode;sessionFault=blockSession},
   seed(raw){set.call(local,'smn_session',raw)},
   snapshot(){return {persisted:get.call(local,'smn_session'),writes:[...writes]}},
  };
  const original=Object.getOwnPropertyDescriptor(window,'localStorage');
  Object.defineProperty(window,'localStorage',{configurable:true,get(){
   if(localFault==='getter')throw new DOMException('Fixture storage blocked','SecurityError');
   return original?.get?original.get.call(window):local;
  }});
  Storage.prototype.setItem=function(key,value){
   if(this===local){if(key==='smn_session')writes.push(String(value));if(localFault==='quota'||localFault==='immutable')throw new DOMException('Fixture quota exceeded','QuotaExceededError')}
   if(this===session&&sessionFault)throw new DOMException('Fixture session storage blocked','SecurityError');
   return set.call(this,key,value);
  };
  Storage.prototype.getItem=function(key){
   if(this===session&&sessionFault)throw new DOMException('Fixture session storage blocked','SecurityError');
   return get.call(this,key);
  };
  Storage.prototype.removeItem=function(key){
   if(this===local&&(localFault==='remove'||localFault==='immutable'))throw new DOMException('Fixture removal blocked','SecurityError');
   if(this===session&&sessionFault)throw new DOMException('Fixture session storage blocked','SecurityError');
   return remove.call(this,key);
  };
 },{mode,seed,username,token,cookieMode});
 if(seed&&cookieMode)await context.addCookies([{name:'SMN_STORAGE_TEST',value:token,url:apiOrigin,sameSite:'Lax',httpOnly:true}]);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===base){
   if(url.pathname==='/app-config.js'){
    await route.fulfill({contentType:'text/javascript',body:`globalThis.SMNConfig=Object.freeze(${JSON.stringify({version:'43',api:apiOrigin,cookieMode})});`});
   }else await route.continue();
   return;
  }
  if(url.href==='https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js'){
   await route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:fs.readFileSync(path.join(root,'node_modules/hls.js/dist/hls.min.js'))});return;
  }
  if(url.origin!==apiOrigin){state.external.push(url.origin);await route.abort();return}
  const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return}
  const body=request.postDataJSON()||{},op=body.op;state.operations.push(op);
  let status=200,value={ok:true},setCookie;
  const cookie=await request.headerValue('cookie')||'';
  const authorized=state.validSession&&(cookieMode?cookie.split(';').some(value=>value.trim()===`SMN_STORAGE_TEST=${token}`):body.access_token===token);
  if(op==='auth'){
   state.authCalls++;
   if(body.username!==username||body.password!==password){status=401;value={error:'auth'}}
   else{state.validSession=true;value={user_info:{auth:1,username},access_token:token,permissions:{movies:true,series:true,tv:true,adults:false},server_time:Date.now(),session_expires_at:Date.now()+3600000};if(cookieMode)setCookie=`SMN_STORAGE_TEST=${token}; Path=/; SameSite=Lax; HttpOnly`}
  }else if(op==='session_info'){
   state.restores++;
   if(!authorized){status=401;value={error:'auth'}}
   else value={user_info:{auth:1,username},access_token:token,permissions:{movies:true,series:true,tv:true,adults:false},server_time:Date.now(),session_expires_at:Date.now()+3600000};
  }else if(op==='logout'){
   if(state.logoutFailure){status=503;value={error:'service_unavailable'}}
   else if(body.access_token===oldToken){
    state.previousCookie=cookie;
    if(state.previousActive){state.previousLogouts++;state.previousActive=false}else{status=401;value={error:'auth'}}
   }else if(!authorized){status=401;value={error:'auth'}}
   else{state.logouts++;state.validSession=false;setCookie='SMN_STORAGE_TEST=; Max-Age=0; Path=/'}
  }else if(!authorized){status=401;value={error:'auth'}}
  else if(op==='vod')value=[{stream_id:42,name:'Película sintética',_server:'ccf'}];
  else if(op==='series')value=[{series_id:7,name:'Serie sintética',_server:'ccf'}];
  else if(op==='live')value=[{stream_id:8,name:'Canal sintético',category_id:'1',_server:'ccf'}];
  else if(op==='live_categories')value=[{category_id:'1',category_name:'Prueba',_server:'ccf'}];
  else if(op==='gnula_catalog')value=[];
  else if(op==='profile_get'||op==='profile_patch')value={records:[]};
  if(setCookie)headers['Set-Cookie']=setCookie;
  await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(base,{waitUntil:'load'});
  assert.deepEqual(errors,[],'the complete application boots with the configured storage fault');
  await run({page,state,cookieMode,mode});
  assert.deepEqual(errors,[],'storage failure does not create an uncaught page exception');
  assert.deepEqual(state.external,[],'only the local page and synthetic API are used');
 }finally{await context.close()}
}
async function login(page,secret=password){
 await page.locator('#heroLogin').click();await page.locator('#user').fill(username);await page.locator('#pass').fill(secret);await page.locator('#submit').click();
}
async function catalog(page){
 await page.waitForFunction(()=>authenticated&&allMovies.length===1&&allSeries.length===1&&allLive.length===1);
 assert.equal(await page.locator('#content').isVisible(),true);
 assert.equal(await page.locator('#movieRow .card b').first().textContent(),'Película sintética');
 assert.equal(await page.locator('#seriesRow .card b').first().textContent(),'Serie sintética');
 assert.equal(await page.locator('#liveGrid .channel').count(),1);
}
async function persistence(page,cookieMode,{temporary=false}={}){
 const snapshot=await page.evaluate(()=>__sessionStorageFixture.snapshot());
 for(const raw of snapshot.writes){
  const saved=JSON.parse(raw);assert.equal(Object.hasOwn(saved,'password'),false);assert.ok(!raw.includes(password));
  assert.deepEqual(saved,{username,access_token:cookieMode?'cookie':token});
 }
 if(temporary){
  assert.equal(await page.locator('#sessionNotice').isVisible(),true);
  assert.equal(await page.locator('#sessionNotice').getAttribute('role'),'status');
  assert.match(await page.locator('#sessionNotice').textContent(),/Sesión temporal/);
  assert.equal(snapshot.persisted,null);
 }else{
  assert.equal(await page.locator('#sessionNotice').isVisible(),false);
  assert.deepEqual(JSON.parse(snapshot.persisted),{username,access_token:cookieMode?'cookie':token});
 }
 assert.doesNotMatch(await page.locator('#msg').textContent(),/Verifica tus datos/);
}

try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 for(const cookieMode of [false,true]){
  for(const mode of ['quota','getter']){
   await fixture({cookieMode,mode},async({page,state})=>{
    await login(page);await catalog(page);await persistence(page,cookieMode,{temporary:true});assert.equal(state.authCalls,1);
    await page.reload({waitUntil:'load'});
    const restored=await page.evaluate(()=>authenticated);
    if(restored){assert.equal(cookieMode,true,'a memory-only token cannot survive a reload');assert.equal(state.validSession,true);await catalog(page);await persistence(page,cookieMode,{temporary:true})}
    else{assert.equal(await page.locator('#heroLogin').isVisible(),true);assert.equal(await page.locator('#sessionNotice').isVisible(),false,'an unauthenticated reload has no stale temporary-session warning')}
    assert.equal(state.authCalls,1,'reload never replays the password');
   });
   await fixture({cookieMode,mode},async({page,state})=>{
    await login(page,'wrong-synthetic-password');await page.waitForFunction(()=>document.getElementById('msg').textContent.length>0);
    assert.equal(await page.evaluate(()=>authenticated),false);assert.equal(state.validSession,false);
    assert.equal(await page.locator('#content').isVisible(),false);assert.equal(await page.locator('#sessionNotice').isVisible(),false);
   });
  }
  await fixture({cookieMode},async({page,state})=>{
   await login(page);await catalog(page);await persistence(page,cookieMode);
   await page.reload({waitUntil:'load'});await catalog(page);await persistence(page,cookieMode);
   assert.equal(state.authCalls,1);assert.ok(state.restores>=1,'normal persistence still restores the server-validated session');
  });
  await fixture({cookieMode,mode:'quota',seed:true},async({page,state})=>{
   await catalog(page);assert.equal(state.authCalls,0);assert.ok(state.restores>=1);
   assert.equal(await page.locator('#sessionNotice').isVisible(),true,'a failed restored-session write stays authenticated and reports its persistence limit');
  });
  await fixture({cookieMode},async({page,state})=>{
   await login(page);await catalog(page);
   await page.evaluate(()=>__sessionStorageFixture.fault('remove',true));
   const navigated=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());
   await page.evaluate(()=>{void logout('Cierre sintético de prueba.')});await navigated;await page.waitForLoadState('load');
   await page.waitForFunction(()=>typeof authenticated==='boolean'&&!authenticated&&creds===null);
   assert.equal(state.logouts,1,'storage failure cannot skip the server revocation');assert.equal(state.validSession,false);
   assert.equal(await page.locator('#sessionNotice').isVisible(),false);assert.equal(await page.locator('#heroLogin').isVisible(),true);
  });
  await fixture({cookieMode},async({page,state})=>{
   await login(page);await catalog(page);state.logoutFailure=true;
   await page.evaluate(()=>__sessionStorageFixture.fault('immutable',true));
   let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++});
   await page.evaluate(()=>{void logout('Cierre sintético de prueba.')});
   const retry=page.getByRole('button',{name:/Reintentar cierre/i});await retry.waitFor();
   assert.equal(await page.evaluate(()=>authenticated),false);assert.equal(navigations,0,'an unconfirmed logout must not reload a still-valid durable session');
   assert.equal(state.logouts,0);assert.equal(state.validSession,true);
   assert.match(await page.locator('#sessionNotice').textContent(),/cierre|cerrar|pendiente|reintenta/i);
   await page.evaluate(async({username,password})=>{document.getElementById('user').value=username;document.getElementById('pass').value=password;await doLogin()},{username,password});
   assert.equal(state.authCalls,1,'a new login cannot bypass pending logout confirmation');
   assert.equal(await page.evaluate(()=>authenticated),false);
   state.logoutFailure=false;
   const navigated=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());
   await retry.click();await navigated;await page.waitForLoadState('load');
   await page.waitForFunction(()=>typeof authenticated==='boolean'&&!authenticated&&creds===null);
   assert.equal(state.logouts,1);assert.equal(state.validSession,false);assert.equal(navigations,1);
   assert.equal(await page.locator('#sessionNotice').isVisible(),false);
  });
 }
 await fixture({},async({page,state})=>{
  state.previousActive=true;
  await page.context().addCookies([{name:'SMN_SENTINEL',value:'must-not-follow-token-revocation',url:apiOrigin,sameSite:'Lax'}]);
  await page.evaluate(({oldToken})=>{__sessionStorageFixture.seed(JSON.stringify({username:'old-storage-user',access_token:oldToken}));__sessionStorageFixture.fault('immutable')},{oldToken});
  await login(page);await catalog(page);
  assert.equal(state.previousLogouts,1,'an immutable saved bearer is revoked before accepting a different temporary bearer');
  assert.equal(state.previousActive,false);assert.equal(state.validSession,true,'previous-session cleanup cannot revoke the newly authenticated identity');
  assert.equal(state.previousCookie,'','explicit old-bearer revocation must omit ambient cookies');
  assert.equal(await page.locator('#sessionNotice').isVisible(),true);
  await page.reload({waitUntil:'load'});await page.waitForFunction(()=>!authenticated&&creds===null);
  assert.equal(state.authCalls,1,'the stale saved bearer cannot restore or replay the password');
 });
 console.log('PASS: Chromium full-page login, quota/getter failures, truthful temporary notice, cookie/token modes, rejected credentials, restore, secret-free persistence, old-bearer cleanup and confirmed/retryable logout despite storage failures.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}

import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {chromium} from 'playwright';
const root=process.cwd(),errors=[],requests=[];let browser;const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.join(root,pathname==='/'?'index.html':pathname.slice(1));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return}res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/plain');res.end(fs.readFileSync(file))});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:390,height:844}}),profile=new Map();
 await context.route('http://127.0.0.1:8787/**',async route=>{
  const request=route.request();if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'}});return}
  const b=request.postDataJSON()||{},op=b.op||b.action;requests.push(op);let value=[];
  if(op==='auth'||op==='session_info')value={user_info:{auth:1,username:'testuser'},access_token:'synthetic-ui-token',permissions:{movies:true,series:true,tv:true,adults:false},server_time:Date.now(),session_expires_at:Date.now()+3600000};
  if(op==='vod')value=[{stream_id:42,name:'Película de prueba',_server:'ccf'}];
  if(op==='vod_info')value={info:{plot:'Descripción de prueba'}};
  if(op==='profile_get')value={records:[...profile.values()]};
  if(op==='profile_patch'){for(const p of b.patches)profile.set(p.kind+':'+p.key,p);value={records:[...profile.values()]}}
  if(op==='status')value={configured:true};if(op==='login')value={access_token:'synthetic-admin-token'};
  if(op==='users')value=[{username:'testuser',name:'Prueba',status:'active',permissions:{movies:true,series:true,tv:true,adults:false}}];
  if(op==='overview')value={provider:null,connections:0};if(op==='xtream-settings')value={enabled:true,url:'https://api.snaptvnow.com',port:'443'};
  if(op==='provider-dashboard')value={sources:[],accounts:[],assignments:[],summary:{accounts:0,activeAccounts:0,totalCapacity:0,reported:0,reserved:0,available:0}};
  if(op==='security-status')value={mfaEnabled:false,recoveryRemaining:0};if(op==='playback-health')value={groups:[],alerts:[]};
  if(op==='mfa-confirm')value={recoveryCodes:Array.from({length:8},(_,i)=>'SYNTHETIC-RECOVERY-'+i)};
  if(op==='mfa-begin')value={seed:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',uri:'otpauth://test'};
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':base},body:JSON.stringify(value)});
 });
 await context.route('https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js',route=>route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:fs.readFileSync(path.join(root,'node_modules/hls.js/dist/hls.min.js'))}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(base);await page.evaluate(()=>ensureHls());await page.locator('header [data-action="menu"]').click();assert.equal(await page.locator('#drawer').evaluate(e=>e.classList.contains('open')),true);await page.locator('#drawer [data-action="menu"]').click();
 await page.locator('#heroLogin').click();await page.locator('#user').fill('testuser');await page.locator('#pass').fill('customer-password-test');await page.locator('#submit').click();await page.locator('#movieRow .card').first().waitFor();
 await page.waitForFunction(()=>document.body.classList.contains('authenticated')&&document.querySelector('#movieRow b')?.textContent==='Película de prueba');
 await page.locator('#movieRow .card').first().click();await page.locator('#heartBtn').click();await page.waitForTimeout(1500);assert.ok([...profile.values()].some(p=>p.kind==='favorite'&&!p.deleted));
 await page.locator('#detailClose').click();await page.locator('header [data-action="menu"]').click();await page.locator('#favoritesMenu').click();assert.equal(await page.locator('#favoritesResults .card').count(),1);await page.locator('#favoritesClose').click();
 const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(base+'/admin.html');await panel.locator('#loginForm [name="username"]').fill('owner');await panel.locator('#loginForm [name="password"]').fill('owner-password-test');await panel.locator('#loginForm button').click();await panel.locator('#securityState').filter({hasText:'desactivado'}).waitFor();
 await panel.locator('#rows button').filter({hasText:'Editar'}).click();assert.equal(await panel.locator('#userForm [name="adults"]').isChecked(),false);await panel.locator('#cancel').click();
 await panel.locator('#securityForm [name="password"]').fill('owner-password-test');await panel.locator('#mfaBegin').click();await panel.locator('#mfaSeed').filter({hasText:'AAAA'}).waitFor();assert.equal(await panel.locator('#mfaConfirm').isVisible(),true);
 await panel.locator('#exit').click();assert.equal(await panel.locator('#mfaSeed').textContent(),'');assert.equal(await panel.locator('#mfaEnrollment').isVisible(),false);
 await panel.locator('#loginForm [name="username"]').fill('owner');await panel.locator('#loginForm [name="password"]').fill('owner-password-test');await panel.locator('#loginForm button').click();await panel.locator('#securityState').filter({hasText:'desactivado'}).waitFor();await panel.locator('#securityForm [name="password"]').fill('owner-password-test');await panel.locator('#mfaBegin').click();await panel.locator('#mfaConfirm').waitFor();await panel.locator('#securityForm [name="code"]').fill('123456');await panel.locator('#mfaConfirm').click();await panel.locator('#mfaRecovery').waitFor();assert.equal(await panel.evaluate(()=>sessionStorage.getItem('smn_admin_token')),null);assert.equal((await panel.locator('#mfaCodes').inputValue()).split('\n').length,8);await panel.locator('#mfaSaved').click();assert.equal(await panel.locator('#mfaCodes').inputValue(),'');
 assert.deepEqual(errors,[],'frontend has no script or CSP errors');assert.ok(requests.includes('profile_patch')&&requests.includes('playback-health'));
 console.log('PASS: mobile Chromium login/menu, isolated favorite sync, adult editor, health dashboard, MFA enrollment and secret cleanup; no JavaScript/CSP errors.');
}finally{await browser?.close();server.close()}

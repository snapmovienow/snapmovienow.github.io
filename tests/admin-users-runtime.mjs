import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),errors=[],saves=[];let browser;
const users=['cliente-demo1','cliente-demo2','cliente-demo3'].map((username,i)=>({username,name:['Cliente de ejemplo 1','Cliente de ejemplo 2','Cliente de ejemplo 3'][i],comments:i?'':'Cliente mensual.\nUsa Fire TV Cube.',status:'active',expiresAt:Date.now()+86400000+12345,updatedAt:Date.now()+i,permissions:{movies:true,series:true,tv:true,adults:false}}));
const assignments=[{username:'cliente-demo1',accountUsername:'cuenta-demo1',type:'live',activity:{title:'ESPN 1 · 1080'}},{username:'cliente-demo2',accountUsername:'cuenta-demo2',type:'series',activity:{title:'El regreso',seriesTitle:'La casa de papel',season:2,episode:3}}].map(a=>({...a,client:'xtream',lastSeenAt:Date.now(),until:Date.now()+90000}));
const inventory={accounts:[],assignments,sources:[],generatedAt:Date.now(),summary:{accounts:10,activeAccounts:10,totalCapacity:30,reported:2,reserved:2,available:26}};
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/plain');res.end(fs.readFileSync(file))});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:1000}});
 await context.route('http://127.0.0.1:8787/**',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const body=request.postDataJSON()||{},action=body.action;let value=[];
  if(action==='status')value={configured:true};
  if(action==='login')value={access_token:'synthetic-admin-preview-only'};
  if(action==='users')value=users;
  if(action==='overview')value={provider:null,connections:2};
  if(action==='xtream-settings')value={enabled:true,url:'https://api.snaptvnow.com',port:'443'};
  if(action==='provider-dashboard')value=inventory;
  if(action==='security-status')value={mfaEnabled:false,recoveryRemaining:0};
  if(action==='backup-status')value={status:'unknown',automaticStatus:'unknown',automaticStale:true,recovery:{status:'unknown'},scheduleUTC:'05:17'};
  if(action==='playback-health')value={groups:[],alerts:[]};
  if(action==='alerts-status')value={settings:{enabled:false,channel:'panel',to:'',from:'',keyConfigured:false},incidents:[],history:[],delivery:{status:'not_configured'},pendingEmails:0};
  if(action==='save'){saves.push(body);const user=users.find(u=>u.username===body.username);Object.assign(user,{name:body.name,comments:body.comments,status:body.status,expiresAt:body.expiresAt,permissions:body.permissions,updatedAt:user.updatedAt+1});value={...user,sessionsRevoked:!!body.password};}
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/admin.html');await page.locator('#loginForm [name="username"]').fill('owner');await page.locator('#loginForm [name="password"]').fill('synthetic-preview-password');await page.locator('#loginForm button').click();await page.locator('#notice').filter({hasText:'Sesión iniciada'}).waitFor();
 assert.equal(await page.locator('#rows .admin-user-card').count(),3);
 assert.match(await page.locator('#providerAssignments').textContent(),/ESPN 1 · 1080/);assert.match(await page.locator('#providerAssignments').textContent(),/La casa de papel/);assert.match(await page.locator('#providerAssignments').textContent(),/Temporada 2 · Episodio 3/);
 const first=page.locator('.admin-user-card[data-username="cliente-demo1"]');
 for(const width of [360,390,1280]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await first.evaluate(card=>card.scrollWidth>card.clientWidth),false,'user card fits width '+width);
  assert.equal(await page.locator('body').evaluate(body=>body.scrollWidth>innerWidth),false,'panel fits width '+width);
  const buttons=await first.locator('.admin-user-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.ok(buttons.every(y=>Math.abs(y-buttons[0])<2),'actions share a horizontal row at '+width);
  assert.ok(await first.evaluate(card=>card.querySelector('.admin-user-permissions').getBoundingClientRect().top>card.querySelector('.admin-user-heading').getBoundingClientRect().bottom),'permissions are below the user');
 }
 await page.setViewportSize({width:390,height:1000});
 fs.mkdirSync('artifacts',{recursive:true});await page.locator('#providerAssignments').screenshot({path:'artifacts/admin-activity-mobile.png'});await page.locator('#rows').screenshot({path:'artifacts/admin-users-mobile.png'});
 await first.getByRole('button',{name:'Editar cliente-demo1',exact:true}).click();const form=page.locator('#userForm');
 const order=await form.locator('input[name="username"],input[name="password"],textarea[name="comments"],input[name="name"]').evaluateAll(nodes=>nodes.map(n=>n.name));assert.deepEqual(order,['username','password','comments','name']);
 assert.equal(await form.locator('[name="password"]').getAttribute('type'),'text');assert.equal(await form.locator('[name="password"]').inputValue(),'');assert.equal(await form.locator('[name="comments"]').inputValue(),users[0].comments);
 await form.locator('[name="password"]').fill('Ejemplo2026!TV');await page.locator('#editor').screenshot({path:'artifacts/admin-editor-mobile.png'});
 await page.locator('#cancel').click();await page.waitForFunction(()=>document.querySelector('#userForm [name="password"]').value==='');assert.equal(saves.length,0,'cancel never saves a visible password');
 await first.getByRole('button',{name:'Editar cliente-demo1',exact:true}).click();const originalExpiry=users[0].expiresAt;
 const comments='Cliente mensual.\nContactar por la tarde. <img src=x onerror="window.injected=true">';await form.locator('[name="comments"]').fill(comments);await form.getByRole('button',{name:'Guardar cambios'}).click();await page.locator('#notice').filter({hasText:'Su reproducción y sesiones se conservan'}).waitFor();
 assert.equal(saves.at(-1).comments,comments);assert.equal(saves.at(-1).password,'');assert.equal(saves.at(-1).expiresAt,originalExpiry,'editing notes preserves expiry seconds');
 await page.locator('.admin-user-card[data-username="cliente-demo1"]').getByRole('button',{name:'Editar cliente-demo1',exact:true}).click();assert.equal(await form.locator('[name="comments"]').inputValue(),comments);assert.equal(await page.evaluate(()=>window.injected),undefined,'comments remain text');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#editor').open);
 await first.locator('[data-permission="adults"]').check();await page.locator('#notice').filter({hasText:'Permisos guardados'}).waitFor();assert.equal(saves.at(-1).permissions.adults,true);assert.equal(saves.at(-1).comments,comments,'permission edits preserve notes');
 await page.locator('#filter').fill('CLIENTE-DEMO2');assert.equal(await page.locator('#rows .admin-user-card').count(),1);await page.locator('#filter').fill('');
 await first.getByRole('button',{name:'Editar cliente-demo1',exact:true}).click();await form.locator('[name="password"]').fill('another-synthetic-password');await form.locator('[name="comments"]').fill('unsaved comments');
 await page.evaluate(()=>document.querySelector('#exit').click());await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(await form.locator('[name="password"]').inputValue(),'');assert.equal(await page.locator('#rows .admin-user-card').count(),0);assert.equal(await page.locator('#providerAssignments article').count(),0);
 assert.deepEqual(errors,[],'no script errors');
 fs.writeFileSync('artifacts/admin-users-runtime.json',JSON.stringify({testedAt:new Date().toISOString(),data:'synthetic only',viewports:[360,390,1280],checks:['horizontal actions','below-user permissions','trusted titles and episodes','visible new password','notes persistence','expiry precision','cancel and logout cleanup','comment text safety','permissions preserve notes']},null,2)+'\n');
 console.log('PASS: mobile/desktop user cards, playback titles, visible password, comments, expiry precision, permission edits and private dialog/logout cleanup.');
}finally{await browser?.close();server.close();}

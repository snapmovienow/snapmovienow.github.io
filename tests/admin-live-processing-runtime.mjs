import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';
import {chromium} from 'playwright';import {DEFAULT_POLICY} from '../services/live-processing/policy.mjs';
const root=process.cwd(),errors=[],processingCalls=[],saves=[];let browser,revisionConflict=false,pendingStatus=null,holdStatus=false;
let policy=structuredClone(DEFAULT_POLICY);
const categories=[{id:'c:'+'a'.repeat(64),name:'Deportes'},{id:'c:'+'b'.repeat(64),name:'Noticias'}];
const channels=[{id:'l:'+'1'.repeat(64),name:'Canal <img src=x onerror="window.injected=1">',categoryId:categories[0].id,categoryName:'Deportes'},{id:'l:'+'2'.repeat(64),name:'Noticias de prueba',categoryId:categories[1].id,categoryName:'Noticias'}];
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/plain');res.end(fs.readFileSync(file));});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:1000}});
 await context.route('http://127.0.0.1:8787/**',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'};
  if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const b=req.postDataJSON()||{},a=b.action;let value=[],status=200;
  const responses={status:{configured:true},login:{access_token:'synthetic-processing-admin'},overview:{provider:null,connections:0},'xtream-settings':{enabled:true},'provider-dashboard':{accounts:[],assignments:[],sources:[],summary:{}},'security-status':{mfaEnabled:false,recoveryRemaining:0},'backup-status':{status:'unknown',recovery:{status:'unknown'}},'playback-health':{groups:[],alerts:[]},'alerts-status':{settings:{enabled:false},incidents:[],history:[],delivery:{status:'not_configured'}},'exclusive-list':{items:[],revision:0}};
  if(Object.hasOwn(responses,a))value=responses[a];
  if(a?.startsWith('live-processing-'))processingCalls.push(b);
  if(a==='live-processing-status'){if(holdStatus)await new Promise(r=>{pendingStatus=r;});value={policy,mode:'preparation',activationAvailable:false,serverConfigured:false,customerRouting:false};}
  if(a==='live-processing-catalog'){const q=b.query?.toLowerCase()||'',matches=channels.filter(c=>(c.name+' '+c.categoryName).toLowerCase().includes(q));value={state:'ready',channels:matches,categories,totalMatches:matches.length};}
  if(a==='live-processing-save'){saves.push(b);if(revisionConflict||b.expectedRevision!==policy.revision){status=409;value={error:'processing_changed'};}else if(b.policy.enabled){status=409;value={error:'processing_activation_pending'};}else{policy={...b.policy,revision:policy.revision+1};value={ok:true,policy,updatedAt:Date.now()};}}
  if(a==='live-processing-check')value={state:'not_configured',activationAvailable:false,customerRouting:false};
  await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin.html');
 await page.locator('#loginForm [name=username]').fill('owner');await page.locator('#loginForm [name=password]').fill('synthetic-private-password');await page.locator('#loginForm button').click();
 await page.locator('#dashboard').waitFor({state:'visible'});assert.equal(processingCalls.length,0,'ordinary admin refresh must not query providers or processor');
 await page.locator('#openLiveProcessing').click();const section=page.locator('#liveProcessingSection');await section.locator('[data-state]').filter({hasText:'Puedes guardar tu selección'}).waitFor();
 assert.equal(await section.locator('[data-activate]').isDisabled(),true);
 await section.locator('[data-catalog-refresh]').click();await section.getByRole('checkbox',{name:'Deportes',exact:true}).check();await section.getByRole('checkbox',{name:channels[0].name,exact:true}).check();assert.equal(await page.evaluate(()=>window.injected),undefined);
 await section.locator('[data-search]').fill('Noticias');await section.locator('[data-search-button]').click();await section.locator('[data-channels]').getByText('Noticias de prueba',{exact:true}).waitFor();
 await section.locator('[name=text]').fill('SNAPTVNOW - DIRECTO');await section.locator('[name=maxChannels]').fill('2');await section.getByRole('button',{name:'Guardar preparación',exact:true}).click();
 await section.locator('[data-state]').filter({hasText:'Preparación guardada.'}).waitFor();assert.equal(saves.length,1);assert.equal(saves[0].policy.enabled,false);assert.equal(saves[0].expectedRevision,0);assert.deepEqual(saves[0].policy.channels,[channels[0].id]);assert.deepEqual(saves[0].policy.categories,[categories[0].id]);assert.equal(saves[0].policy.text,'SNAPTVNOW - DIRECTO');
 await section.locator('[data-check]').click();await section.locator('[data-state]').filter({hasText:'Todavía no hay un servidor de video conectado'}).waitFor();assert.equal(await section.locator('[data-activate]').isDisabled(),true);
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:1000});assert.equal(await section.evaluate(el=>el.scrollWidth>el.clientWidth),false,'editor fits '+width);assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false,'admin fits '+width);}
 fs.mkdirSync('artifacts/live-processing',{recursive:true});await section.screenshot({path:'artifacts/live-processing/main-admin-desktop.png'});await page.setViewportSize({width:390,height:1000});await section.screenshot({path:'artifacts/live-processing/main-admin-mobile.png'});
 revisionConflict=true;await section.getByRole('button',{name:'Guardar preparación',exact:true}).click();await section.locator('[data-state]').filter({hasText:'Otro cambio modificó la preparación'}).waitFor();assert.equal(await section.locator('[name=text]').inputValue(),'SNAPTVNOW - DIRECTO');revisionConflict=false;
 holdStatus=true;await section.locator('[data-reload]').click();await page.waitForTimeout(50);await page.evaluate(()=>document.getElementById('exit').click());pendingStatus?.();await page.waitForTimeout(100);
 assert.equal(await section.locator('[data-editor]').isHidden(),true);assert.equal(await section.locator('[data-channels] input').count(),0);assert.equal(await section.locator('[name=text]').inputValue(),'SNAPTVNOW');assert.deepEqual(errors,[]);
 assert(processingCalls.every(c=>['live-processing-status','live-processing-catalog','live-processing-save','live-processing-check'].includes(c.action)));
 console.log('PASS: actual owner admin UI, lazy cached catalogue, selection across search, safe text, revision conflicts, mobile/desktop layout, activation gate and late-response logout cleanup.');
}finally{pendingStatus?.();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

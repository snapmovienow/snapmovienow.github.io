import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd(),now=Date.now(),calls=[],errors=[];let browser,mode='normal',release,heldStarted;
const customer=name=>({id:'account-'+name,username:name,name:'Nombre privado '+name,status:'active',expiresAt:now+86400000,permissions:{tv:true,movies:true,series:true}});
const data=name=>({schema:1,checkedAt:now,recordingSince:now-86400000,customer:customer(name),lists:[{type:'live',lastRequestedAt:now-3*86400000,lastRespondedAt:now-3*86400000+500,status:'delivered',httpStatus:200,itemCount:350,selection:'all',access:'xtream'}],check:{checkedAt:now,access:'active',permissions:{tv:true,movies:true,series:true},connections:{status:'observed',reserved:2,limit:3},source:{status:'unknown',observedAt:null,usableAccounts:null},playbackValidated:false},incidents:{rows:[{id:'issue-1',type:'manual',title:'<img src=x onerror="window.injected=true">',status:'open',firstSeenAt:now-5000,lastSeenAt:now-3000,updatedAt:now-2000,count:1,note:'<svg onload="window.injected=true">',revision:1,code:'https://private.invalid/secret'}],total:1,page:1,pages:1,retentionDays:30}});
const values={demo01:data('demo01'),demo02:data('demo02')};
const html='<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/admin-support.css"><body style="margin:0;background:#061625;color:white;font:16px Arial,sans-serif"><button id="outside">Abrir soporte</button><script type="module">import{mountAdminSupport}from"/admin-support.js";window.supportWidget=mountAdminSupport({api:async(action,body)=>{const result=await window.supportApi(action,body);if(result?.testError){const error=Error(result.testError);error.code=result.testError;throw error;}return result;}});window.ready=true;</script></body></html>';
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}if(!['/admin-support.js','/admin-support.css'].includes(pathname)){res.writeHead(404).end();return;}res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(root,pathname)));});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:1000}});page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('supportApi',async(action,body)=>{
  calls.push({action,body});
  if(mode==='hold-a'&&body.username==='demo01'||mode==='hold-b'&&body.username==='demo02')return new Promise(resolve=>{release=resolve;heldStarted?.();});
  if(mode==='unavailable')return {testError:'support_unavailable'};
  if(mode==='wrong-customer')return values.demo02;
  if(action==='client-support-check')return {...values[body.username],check:{...values[body.username].check,access:'expired'}};
  if(action==='client-support-incident-save'){
   if(mode==='conflict')return {testError:'support_conflict'};
   if(body.id){const row=values[body.username].incidents.rows.find(row=>row.id===body.id);Object.assign(row,{status:body.status,note:body.note,revision:row.revision+1});return {ok:true,incident:row};}
   const row={id:'manual-new',type:'manual',title:body.title,status:body.status,note:body.note,firstSeenAt:now,lastSeenAt:now,count:1,revision:1};values[body.username].incidents.rows.unshift(row);values[body.username].incidents.total++;return {ok:true,incident:row};
  }
  return values[body.username];
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 assert.equal(calls.length,0,'mounting the administrator widget never loads customer data');
 await page.evaluate(user=>window.supportWidget.open(user),customer('demo01'));
 const dialog=page.locator('#clientSupport');await dialog.waitFor({state:'visible'});
 assert.equal(calls.length,1);assert.equal(calls[0].action,'client-support-read');assert.equal(calls[0].body.username,'demo01');
 assert.match(await dialog.textContent(),/hace 3 días/);assert.match(await dialog.textContent(),/Respuesta generada/);assert.match(await dialog.textContent(),/Sin registro/);assert.match(await dialog.textContent(),/Sin comprobar/);assert.match(await dialog.textContent(),/no confirma que la app guardó/);assert.match(await dialog.textContent(),/Seguimiento actualizado:/);assert.match(await dialog.textContent(),/Evita contraseñas y enlaces/);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await dialog.locator('img,svg').count(),0,'manual text never creates markup');assert.ok(!(await dialog.textContent()).includes('private.invalid'),'unallowlisted diagnostic code is not rendered');
 for(const width of [360,390,768,1280]){await page.setViewportSize({width,height:1000});assert.equal(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth),false,'support dialog fits '+width);assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>innerWidth),false,'page fits '+width);assert.ok((await dialog.getByRole('button',{name:'Comprobar ahora'}).boundingBox()).height>=44);}
 await page.setViewportSize({width:390,height:1000});fs.mkdirSync('artifacts',{recursive:true});await dialog.screenshot({path:'artifacts/admin-support-mobile.png'});
 await dialog.getByRole('button',{name:'Comprobar ahora',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-check').textContent.includes('Cuenta vencida'));
 assert.equal(calls.at(-1).action,'client-support-check');assert.ok(calls.every(call=>['client-support-read','client-support-check'].includes(call.action)),'checking never plays streams or changes account state');
 const incident=dialog.locator('.support-incident').first();await incident.locator('select').selectOption('resolved');await incident.locator('textarea').fill('');await incident.getByRole('button',{name:'Guardar seguimiento'}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-status').textContent==='Seguimiento guardado.');
 const save=calls.find(call=>call.action==='client-support-incident-save');assert.equal(save.body.note,'','blank optional notes are accepted');assert.equal(save.body.expectedRevision,1);assert.equal(save.body.status,'resolved');assert.equal(await dialog.locator('.support-incident textarea').first().inputValue(),'');
 await dialog.locator('.support-new summary').click();await dialog.locator('.support-new input[name="title"]').fill('No aparece el canal');await dialog.locator('.support-new textarea').fill('');await dialog.locator('.support-new form').getByRole('button',{name:'Registrar incidencia',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-status').textContent==='Seguimiento guardado.');
 assert.equal(calls.filter(call=>call.action==='client-support-incident-save').at(-1).body.note,'');assert.match(await dialog.locator('.support-incidents').textContent(),/No aparece el canal/);
 mode='conflict';await dialog.locator('.support-incident').first().getByRole('button',{name:'Guardar seguimiento'}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-status').textContent.includes('otra sesión'));assert.equal(await dialog.isVisible(),true,'a conflict retains the open support view');mode='normal';
 await page.evaluate(()=>window.supportWidget.clear());assert.equal(await dialog.isVisible(),false);assert.ok(!(await dialog.textContent()).includes('Nombre privado'));
 await page.evaluate(user=>{window.supportWidget.open(user);window.supportWidget.clear();return window.supportWidget.open(user);},customer('demo02'));assert.equal(await dialog.isVisible(),true,'a queued close from the previous view cannot clear a newly opened customer');assert.match(await dialog.locator('h2').textContent(),/demo02/);
 mode='hold-a';const startedA=new Promise(resolve=>{heldStarted=resolve;});await page.evaluate(user=>{window.pendingSupport=window.supportWidget.open(user);},customer('demo01'));await startedA;
 await page.evaluate(user=>window.supportWidget.open(user),customer('demo02'));release(values.demo01);await page.evaluate(()=>window.pendingSupport);assert.match(await dialog.locator('h2').textContent(),/demo02/);assert.ok(!(await dialog.textContent()).includes('Nombre privado demo01'),'late old-account response cannot replace current customer');
 mode='hold-b';const startedB=new Promise(resolve=>{heldStarted=resolve;});await page.evaluate(user=>{window.pendingSupport=window.supportWidget.open(user);},customer('demo02'));await startedB;await page.evaluate(()=>window.supportWidget.clear());release(values.demo02);await page.evaluate(()=>window.pendingSupport);assert.equal(await dialog.isVisible(),false);assert.equal(await dialog.locator('.support-list-row,.support-incident').count(),0);assert.equal(await dialog.locator('.support-new textarea').inputValue(),'');assert.ok(!(await dialog.textContent()).includes('Nombre privado'));
 mode='wrong-customer';await page.evaluate(user=>window.supportWidget.open(user),customer('demo01'));assert.match(await dialog.locator('.support-status').textContent(),/No se pudo completar/);assert.equal(await dialog.locator('.support-list-row').count(),0,'a wrong-account response cannot populate the view');
 mode='unavailable';await page.evaluate(user=>window.supportWidget.open(user),customer('demo01'));assert.match(await dialog.locator('.support-status').textContent(),/no está disponible/);assert.equal(await dialog.locator('.support-body').isVisible(),false);
 await dialog.getByRole('button',{name:'Cerrar soporte'}).click();assert.equal(await dialog.isVisible(),false);assert.deepEqual(errors,[]);
 console.log('PASS: real browser mobile/desktop support dialog, private lazy loading, unknown states, plain-text safety, optional blank notes, owner status updates, conflict handling and user-switch/logout race isolation.');
}finally{await browser?.close();server.close();}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),errors=[],saves=[];let browser;
let items=Array.from({length:18},(_,i)=>({id:'gnula-title-'+i,name:i===0?'Película <img src=x onerror="window.injected=1">':'Película '+i,type:'movie',source:'GNULA',mode:'gnula',page:'https://www2.gnula.one/title-'+i,poster:'',year:2026,plot:'Descripción',visible:true,adult:false,episodes:[],revision:1}));
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/plain');res.end(fs.readFileSync(file));});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:1000}});
 await context.route('http://127.0.0.1:8787/**',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'};if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const body=request.postDataJSON()||{},action=body.action;let value=[],status=200;
  if(action==='status')value={configured:true};if(action==='login')value={access_token:'synthetic-exclusive-admin-only'};if(action==='overview')value={provider:null,connections:0};if(action==='xtream-settings')value={enabled:true};if(action==='provider-dashboard')value={accounts:[],assignments:[],sources:[],summary:{}};if(action==='security-status')value={mfaEnabled:false,recoveryRemaining:0};if(action==='backup-status')value={status:'unknown',recovery:{status:'unknown'}};if(action==='playback-health')value={groups:[],alerts:[]};if(action==='alerts-status')value={settings:{enabled:false},incidents:[],history:[],delivery:{status:'not_configured'}};
  if(action==='exclusive-list')value={items,revision:1};
  if(action==='exclusive-save'){saves.push(body);const old=items.find(x=>x.id===body.item.id);if(old&&old.revision!==body.revision){status=409;value={error:'exclusive_changed'};}else{const item={...body.item,revision:body.revision+1};items=items.filter(x=>x.id!==item.id).concat(item);value={ok:true,item};}}
  if(action==='exclusive-check')value={ok:true,message:'El enlace respondió como contenido multimedia.'};
  if(action==='exclusive-cover')value={poster:'/exclusive-cover/'+'a'.repeat(64)};
  await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin.html');await page.locator('#loginForm [name=username]').fill('owner');await page.locator('#loginForm [name=password]').fill('synthetic-admin-only');await page.locator('#loginForm button').click();
 const section=page.locator('#exclusiveSection');await section.locator('.exclusive-card').first().waitFor();assert.equal(await section.locator('.exclusive-card').count(),18);assert.equal(await page.evaluate(()=>window.injected),undefined);
 await section.locator('.exclusive-card').first().getByRole('button',{name:'Editar',exact:true}).click();const form=section.locator('[data-editor]');assert.equal(await form.locator('[name=page]').inputValue(),'https://www2.gnula.one/title-0');
 await form.locator('[name=name]').fill('Título editado');assert.equal(await form.locator('[data-check]').isDisabled(),true);await form.getByRole('button',{name:'Guardar cambios',exact:true}).click();await section.locator('[data-state]').filter({hasText:'18 títulos guardados'}).waitFor();assert.equal(saves.at(-1).revision,1);assert.equal(saves.at(-1).item.name,'Título editado');
 await form.getByRole('button',{name:'Comprobar enlace'}).click();await section.locator('[data-state]').filter({hasText:'respondió como contenido multimedia'}).waitFor();
 await section.locator('[data-add]').click();await form.locator('[name=name]').fill('Serie de prueba');await form.locator('[name=type]').selectOption('series');await form.locator('[name=mode]').selectOption('direct');await form.locator('[data-add-episode]').click();await form.locator('[name=title]').fill('Primer episodio');await form.locator('[name=episodePage]').fill('https://media.snapcdn.net/episode.mp4');
 // Movie fields must not retain disabled/required episode validation after a type change.
 await form.locator('[name=type]').selectOption('movie');assert.equal(await form.locator('[name=title]').isDisabled(),true);await form.locator('[name=type]').selectOption('series');assert.equal(await form.locator('[name=title]').isDisabled(),false);
 await form.locator('[name=coverFile]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeQAAAAASUVORK5CYII=','base64')});await section.locator('[data-state]').filter({hasText:'Portada preparada'}).waitFor();
 await form.getByRole('button',{name:'Guardar cambios',exact:true}).click();await section.locator('[data-state]').filter({hasText:'19 títulos guardados'}).waitFor();assert.equal(saves.at(-1).item.episodes.length,1);assert.equal(saves.at(-1).item.type,'series');assert.match(saves.at(-1).item.poster,/^\/exclusive-cover\//);assert.equal(saves.at(-1).revision,0);
 const card=section.locator('.exclusive-card').filter({has:page.getByRole('heading',{name:'Serie de prueba',exact:true})});await card.getByRole('button',{name:'Ocultar',exact:true}).click();await card.getByText('Oculto',{exact:false}).waitFor();assert.equal(saves.at(-1).item.visible,false);
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:1000});assert.equal(await section.evaluate(el=>el.scrollWidth>el.clientWidth),false,'exclusive editor fits '+width);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false,'admin fits '+width);}
 fs.mkdirSync('artifacts',{recursive:true});await section.screenshot({path:'artifacts/admin-exclusive-desktop.png'});await page.setViewportSize({width:390,height:1000});await section.locator('.exclusive-card').first().getByRole('button',{name:'Editar',exact:true}).click();await form.screenshot({path:'artifacts/admin-exclusive-mobile.png'});
 await page.evaluate(()=>document.querySelector('#exit').click());assert.equal(await section.locator('.exclusive-card').count(),0);assert.equal(await form.locator('[name=page]').inputValue(),'');assert.deepEqual(errors,[]);
 console.log('PASS: 18 seeded cards, editable URLs, text safety, optimistic saves, media checks, series episode validation, uploaded cover, hide action, mobile/desktop layout and logout cleanup.');
}finally{await browser?.close();server.close();}

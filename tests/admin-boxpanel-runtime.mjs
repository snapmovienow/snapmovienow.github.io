import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import {createResellerPortal,PORTAL_ACCOUNT,PORTAL_SOURCE} from '../cloudflare-worker/src/reseller-portal.mjs';
const root=process.cwd(),errors=[],operations=[];let browser;
const workspace={id:PORTAL_ACCOUNT,name:'Reseller <img src=x onerror="window.injected=1">',status:'active',revision:1};
let dns=[{id:'11111111-1111-4111-8111-111111111111',title:'Servidor principal',url:'https://provider.example.com/',revision:1}],ads=[];
function boxAction(body){
 operations.push(body);
 if(body.action==='boxpanel-list')return {workspaces:[workspace],candidates:[workspace.id]};
 if(body.action==='boxpanel-open')return {workspace,dns,ads,limits:{ads:8,dns:3,imageBytes:262144}};
 if(body.action==='boxpanel-workspace-save'){workspace.name=body.name;workspace.status=body.status;workspace.revision++;return {ok:true};}
 if(body.action==='boxpanel-dns-save'){const item={...body,id:body.id||'22222222-2222-4222-8222-222222222222',revision:body.revision+1};dns=dns.filter(x=>x.id!==item.id).concat(item);return {ok:true};}
 if(body.action==='boxpanel-ads-save'){ads=[{...body,id:'33333333-3333-4333-8333-333333333333',revision:1}];return {ok:true};}
 if(body.action==='boxpanel-ads-image')return {data:ads[0].data};
 if(body.action==='boxpanel-ads-delete'){ads=[];return {ok:true};}
 throw Error('Unexpected BoxPanel action '+body.action);
}
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/plain');res.end(fs.readFileSync(file));});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:1280,height:1000}});
 await context.route('http://127.0.0.1:8787/**',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'content-type'};if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const body=request.postDataJSON()||{},action=body.action;let value=[];
  if(action==='status')value={configured:true};if(action==='login')value={access_token:'synthetic-box-admin'};if(action==='overview')value={provider:null,connections:0};if(action==='xtream-settings')value={enabled:true};if(action==='provider-dashboard')value={accounts:[],assignments:[],sources:[],summary:{}};if(action==='security-status')value={mfaEnabled:false,recoveryRemaining:0};if(action==='backup-status')value={status:'unknown',recovery:{status:'unknown'}};if(action==='playback-health')value={groups:[],alerts:[]};if(action==='alerts-status')value={settings:{enabled:false},incidents:[],history:[],delivery:{status:'not_configured'}};if(action==='exclusive-list')value={items:[],revision:1};
  if(action?.startsWith('boxpanel-'))value=boxAction(body);
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin.html');await page.locator('#loginForm [name=username]').fill('owner');await page.locator('#loginForm [name=password]').fill('synthetic-owner');await page.locator('#loginForm button').click();await page.locator('#dashboard').waitFor({state:'visible'});
 assert.equal(operations.length,0,'BoxPanel has no background polling before opening');
 await page.locator('#openBoxPanel').click();const section=page.locator('#boxpanelSection');await section.locator('[data-workspaces] article').waitFor();assert.equal(await page.evaluate(()=>window.injected),undefined);
 await section.getByRole('button',{name:'Abrir',exact:true}).click();await section.getByText('Servidor principal',{exact:true}).waitFor();
 const df=section.locator('[data-dns-form]');await section.locator('[data-dns]').getByRole('button',{name:'Editar',exact:true}).click();await df.locator('[name=url]').fill('https://unsaved.example.com/');const count=operations.length;await df.getByRole('button',{name:'Regresar sin guardar'}).click();assert.equal(operations.length,count);assert.equal(dns[0].url,'https://provider.example.com/');
 await section.locator('[data-add-dns]').click();await df.locator('[name=title]').fill('DNS de respaldo');await df.locator('[name=url]').fill('https://backup.example.com');await df.getByRole('button',{name:'Guardar DNS',exact:true}).click();await section.getByText('DNS de respaldo',{exact:true}).waitFor();assert.equal(operations.find(x=>x.action==='boxpanel-dns-save').accountId,workspace.id);
 await section.locator('[data-add-ads]').click();const af=section.locator('[data-ads-form]');await af.locator('[name=title]').fill('Promoción');await af.locator('[name=duration]').fill('15');await af.locator('[name=file]').setInputFiles({name:'banner.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeQAAAAASUVORK5CYII=','base64')});await af.getByRole('button',{name:'Guardar imagen',exact:true}).click();await section.getByText('Promoción',{exact:true}).waitFor();const saved=operations.find(x=>x.action==='boxpanel-ads-save');assert.match(saved.data,/^data:image\/jpeg;base64,/);assert.ok(saved.data.length<349550);assert.equal(saved.duration,15);
 await section.getByRole('button',{name:'Ver imagen'}).click();await section.locator('[data-ads] img').waitFor({state:'visible'});
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:1000});assert.equal(await section.evaluate(el=>el.scrollWidth>el.clientWidth),false,'BoxPanel fits '+width);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false,'admin fits '+width);}
 fs.mkdirSync('artifacts',{recursive:true});await section.screenshot({path:'artifacts/boxpanel-admin-desktop.png'});await page.setViewportSize({width:390,height:1000});await section.screenshot({path:'artifacts/boxpanel-admin-mobile.png'});
 await section.locator('[data-add-dns]').click();await df.locator('[name=title]').fill('Never save');const closing=operations.length;await section.locator('[data-close]').click();assert.equal(operations.length,closing);assert.equal(await section.isHidden(),true);assert.equal(await df.locator('[name=title]').inputValue(),'');assert.equal(await section.locator('img').count(),0);
 await page.locator('#openBoxPanel').click();await section.locator('[data-workspaces] article').waitFor();await page.locator('#exit').click();assert.equal(await section.isHidden(),true);assert.equal(await section.locator('[data-workspaces] article').count(),0);
 // The actual reseller HTML/JS/CSP uses the existing cookie gateway and never
 // renders a reseller picker or a workspace creation form.
 const portal=createResellerPortal({getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'f'.repeat(64),siteToken:'synthetic-site-test'}),fetcher:async()=>Response.json({actor:{id:PORTAL_ACCOUNT,role:'reseller'},target:{id:PORTAL_ACCOUNT},overview:false,accounts:[],lines:[],ledger:[]}),boxpanel:async(_env,body,id)=>{assert.equal(id,PORTAL_ACCOUNT);return Response.json(boxAction(body));}});
 await context.addCookies([{name:'__Host-SNAP_Resellers',value:'a'.repeat(64),domain:'resellers.snaptvnow.com',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.route('https://resellers.snaptvnow.com/**',async route=>{const req=route.request(),response=await portal(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(req.method()==='POST'?{body:req.postData()}: {})}),{});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});});
 await page.goto('https://resellers.snaptvnow.com/boxpanel');const reseller=page.locator('#boxpanelSection');await reseller.getByText('DNS de respaldo',{exact:true}).waitFor();assert.equal(await reseller.locator('[data-owner]').isHidden(),true);assert.equal(await reseller.locator('[data-back]').isHidden(),true);assert.equal(await reseller.locator('[data-workspaces] article').count(),0);
 await page.setViewportSize({width:390,height:1000});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false);await reseller.screenshot({path:'artifacts/boxpanel-reseller-mobile.png'});assert.deepEqual(errors,[]);
 console.log('PASS: integrated owner button, on-demand reads, safe text, DNS save, image optimization/duration/preview, mobile layout, return without saving, logout cleanup and actual reseller page/CSP with existing scoped cookie auth.');
}finally{await browser?.close();server.close();}

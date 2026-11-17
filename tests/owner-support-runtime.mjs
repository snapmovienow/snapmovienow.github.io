// Real published portal bundle, synthetic accounts, and intercepted local routes.
// This check never authenticates a real customer or requests provider media.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PORTAL_ASSET_VERSION} from '../cloudflare-worker/src/reseller-panel-assets.mjs';
import {createOwnerPortal} from '../cloudflare-worker/src/owner-portal.mjs';
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from '../cloudflare-worker/src/reseller-portal.mjs';

const now=Date.now(),target={id:'fixture-support-panel',slug:'fixture-support-panel',name:'Panel ficticio',role:'reseller',status:'active',balance:5200,revision:0};
const lines=['FixtureUno','FixtureDos'].map((username,index)=>({id:'fixture-support-line-'+index,account_id:target.id,account_name:target.name,username,label:'Cliente ficticio '+index,status:'registered',password:'Synthetic-client-password',notes:'',revision:0,connections:3,created_at:now,expires_at:now+86400000,package_id:'months-1',package_name:'1 mes',adult_access:0,sourceMetadata:{expiryTimezone:'America/Chicago'}}));
const packages=[{id:'months-1',name:'1 mes',months:1,bonus_months:0,cost:100,connections:3,active:1,revision:1}];
let ownerMode=true,browser,runtime,heldLine=null,releaseHeld,failSupport=false;
const technicalReference='db7bc27a-9a81-4665-a10d-66eb1e3fc4d4';
const errors=[],supportCalls=[],unexpected=[];
const snapshot=()=>({actor:ownerMode?{id:'owner',role:'owner',name:'Propietario ficticio'}:target,target,authMode:ownerMode?'owner-portal':'password',portalBase:ownerMode?'/owner-panel':'',overview:false,accounts:ownerMode?[target]:[],lines,ledger:[],operations:[],packages,trialPolicy:{enabled:1,minutes:60,daily_limit:5,active_limit:3,revision:0},serverTime:now,stats:{total:2,expiring:0,suspended:0},integration:{connected:true,accountId:target.id,accountName:target.name,accounts:[{accountId:target.id}]}});
const supportData=line=>({schema:1,checkedAt:now,recordingSince:now,customer:{id:'synthetic-uuid-'+line.id,username:line.username,name:line.label,status:'active',expiresAt:line.expires_at,permissions:{tv:true,movies:true,series:true}},lists:[{type:'live',lastRequestedAt:now-2000,lastRespondedAt:now-1000,status:'delivered',httpStatus:200,itemCount:350,selection:'all',access:'xtream'}],check:{checkedAt:now,access:'active',permissions:{tv:true,movies:true,series:true},connections:{status:'observed',reserved:2,limit:3},source:{status:'unknown',observedAt:null,usableAccounts:null},playbackValidated:false},incidents:{rows:[{id:'issue-1',type:'manual',title:'Consulta ficticia '+line.username,status:'open',firstSeenAt:now,lastSeenAt:now,updatedAt:now,count:1,note:'',revision:1}],total:1,page:1,pages:1,retentionDays:30}});
const supportValues=new Map(lines.map(line=>[line.id,supportData(line)]));
const owner=createOwnerPortal({getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'f'.repeat(64),siteToken:'synthetic-only-not-a-real-token'}),fetcher:async()=>Response.json(snapshot())});

try{
 const artifact='cloudflare-worker/.wrangler/quality-release/index.js';
 assert.ok(fs.existsSync(artifact),'Build the production release before checking owner support.');
 const options={workers:[{name:'owner-support-release',modules:true,script:fs.readFileSync(artifact,'utf8'),compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],outboundService:()=>{throw Error('Owner support tests never use external services.');}}]};
 runtime=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);await runtime.ready;const worker=await runtime.getWorker('owner-support-release');
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:1000}});
 await context.addCookies([{name:'__Host-SNAP_Owner_Portal',value:'a'.repeat(64),domain:'api.snaptvnow.com',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());let response;
  if(!['api.snaptvnow.com','resellers.snaptvnow.com'].includes(url.hostname)){unexpected.push(url.origin);await route.abort();return;}
  if(url.pathname.endsWith('/api/client-support')){
   assert.equal(ownerMode,true);assert.equal(req.method(),'POST');const body=req.postDataJSON();supportCalls.push(body);
   assert.equal(body.accountId,target.id);assert.ok(lines.some(line=>line.id===body.lineId));assert.equal('username' in body,false);assert.equal('actor' in body,false);
   assert.ok(['client-support-read','client-support-check','client-support-incident-save'].includes(body.action));
   const data=supportValues.get(body.lineId);
   if(failSupport){
    response=Response.json({error:'support_initializing',message:'Detalle interno ficticio. Referencia: '+technicalReference+'. PRIVATE_RESPONSE_DETAIL'},{status:503});
   }else if(body.action==='client-support-incident-save'){
    assert.equal(body.id,'issue-1');assert.equal(body.note,'');assert.equal(body.expectedRevision,data.incidents.rows[0].revision);
    Object.assign(data.incidents.rows[0],{status:body.status,note:body.note,revision:body.expectedRevision+1});response=Response.json({ok:true,incident:data.incidents.rows[0]});
   }else{
    if(body.lineId===heldLine){await new Promise(resolve=>{releaseHeld=resolve;});}
    response=Response.json(data);
   }
  }else if(url.pathname.endsWith('/api/panel')){
   assert.equal(req.method(),'GET','support must not mutate customer accounts');
   response=Response.json(url.searchParams.has('lineId')?lines.find(line=>line.id===url.searchParams.get('lineId')):snapshot());
  }else{
   const request=new Request(req.url(),{method:req.method(),headers:await req.allHeaders()});
   response=ownerMode&&!url.pathname.includes('/assets/')?await owner(request,{}):await worker.fetch(request);
  }
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const ownerUrl='https://api.snaptvnow.com/owner-panel/?view=lines&slug='+target.slug;
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:1000});await page.goto(ownerUrl);
  const openSupport=page.getByRole('button',{name:'Soporte de '+lines[0].username,exact:true});await openSupport.waitFor({state:'visible'});
  assert.ok((await page.locator('script[src*="/assets/panel.js"]').getAttribute('src')).includes('v='+PORTAL_ASSET_VERSION));
  const before=supportCalls.length;await openSupport.click();const dialog=page.locator('#clientSupport');await dialog.waitFor({state:'visible'});
  await dialog.locator('.support-card').nth(2).waitFor({state:'visible'});assert.equal(await dialog.locator('.support-card').count(),3);
  assert.equal(supportCalls[before].lineId,lines[0].id);assert.equal(supportCalls[before].action,'client-support-read');
  assert.match(await dialog.innerText(),/Respuesta generada/);assert.match(await dialog.innerText(),/Sin registro/);assert.match(await dialog.innerText(),/Sin comprobar/);
  assert.equal(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth),false,'support dialog fits '+width);
  await dialog.getByRole('button',{name:'Comprobar ahora',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-toolbar button')?.disabled===false);
  assert.equal(supportCalls.at(-1).action,'client-support-check');
  const incident=dialog.locator('.support-incident').first();await incident.locator('select').selectOption('investigating');await incident.locator('textarea').fill('');
  await incident.getByRole('button',{name:'Guardar seguimiento',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#clientSupport .support-status')?.textContent==='Seguimiento guardado.');
  assert.equal(supportCalls.findLast(body=>body.action==='client-support-incident-save').note,'');
  if(width===390){fs.mkdirSync('artifacts',{recursive:true});await dialog.screenshot({path:'artifacts/owner-support-mobile.png'});}
  await dialog.getByRole('button',{name:'Cerrar soporte',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Acciones de '+lines[0].username,exact:true}).click();const actions=page.locator('dialog[open]').filter({has:page.getByRole('button',{name:'Consultar soporte',exact:true})});
  await actions.getByRole('button',{name:'Consultar soporte',exact:true}).click();await dialog.waitFor({state:'visible'});await dialog.locator('.support-card').nth(2).waitFor({state:'visible'});await dialog.getByRole('button',{name:'Cerrar soporte',exact:true}).click();
 }

 // A first-load server error shows a bounded reason and safe reference, not
 // nonexistent prior records. A later refresh can recover the same sheet.
 failSupport=true;await page.setViewportSize({width:390,height:1000});await page.goto(ownerUrl);
 const recoverOpen=page.getByRole('button',{name:'Soporte de '+lines[0].username,exact:true});await recoverOpen.waitFor({state:'visible'});await recoverOpen.click();
 const failedDialog=page.locator('#clientSupport');await failedDialog.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#clientSupport .support-status')?.textContent.includes('Referencia:'));
 const failureText=await failedDialog.locator('.support-status').innerText();
 assert.match(failureText,/aún no está disponible en el servidor/);assert.ok(failureText.includes('Referencia: '+technicalReference+'.'));
 assert.doesNotMatch(failureText,/datos anteriores|PRIVATE_RESPONSE_DETAIL|Detalle interno/);assert.equal(await failedDialog.locator('.support-body').isVisible(),false);
 assert.equal(supportCalls.at(-1).lineId,lines[0].id);assert.equal(supportCalls.at(-1).action,'client-support-read');
 failSupport=false;await failedDialog.getByRole('button',{name:'Actualizar ficha',exact:true}).click();await failedDialog.locator('.support-card').nth(2).waitFor({state:'visible'});
 assert.equal(await failedDialog.locator('.support-card').count(),3);assert.equal(await failedDialog.locator('.support-status').innerText(),'');assert.match(await failedDialog.innerText(),/Respuesta generada/);assert.ok(!(await failedDialog.innerText()).includes(technicalReference));
 await failedDialog.getByRole('button',{name:'Cerrar soporte',exact:true}).click();await failedDialog.waitFor({state:'hidden'});

 // An old request is released after another customer has been selected.
 heldLine=lines[0].id;const heldStarted=page.waitForRequest(req=>req.url().includes('/api/client-support')&&req.postDataJSON()?.lineId===heldLine);
 await page.getByRole('button',{name:'Soporte de '+lines[0].username,exact:true}).click();await heldStarted;
 const dialog=page.locator('#clientSupport');await dialog.getByRole('button',{name:'Cerrar soporte',exact:true}).click();
 await page.getByRole('button',{name:'Soporte de '+lines[1].username,exact:true}).click();await dialog.locator('.support-card').nth(2).waitFor({state:'visible'});
 assert.match(await dialog.locator('h2').innerText(),new RegExp(lines[1].username));
 assert.equal(typeof releaseHeld,'function');const oldResponse=page.waitForResponse(response=>response.url().includes('/api/client-support')&&response.request().postDataJSON()?.lineId===lines[0].id);releaseHeld();heldLine=null;
 await oldResponse;
 assert.match(await dialog.locator('h2').innerText(),new RegExp(lines[1].username));assert.ok(!(await dialog.innerText()).includes(lines[0].label));
 await dialog.getByRole('button',{name:'Cerrar soporte',exact:true}).click();

 ownerMode=false;await page.goto('https://resellers.snaptvnow.com/?view=lines');await page.getByRole('button',{name:'Acciones de '+lines[0].username,exact:true}).waitFor({state:'visible'});
 assert.equal(await page.getByRole('button',{name:/^Soporte de /}).count(),0,'a reseller cannot see owner support controls');
 await page.getByRole('button',{name:'Acciones de '+lines[0].username,exact:true}).click();assert.equal(await page.getByRole('button',{name:'Consultar soporte',exact:true}).count(),0);
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 console.log('PASS: actual owner portal bundle exposes private support from customer rows and More actions on mobile/desktop; exact account/line scope, optional blank notes, checks, first-load failure with safe reference and refresh recovery, late-response isolation and reseller exclusion; zero provider requests.');
}finally{releaseHeld?.();await browser?.close();await runtime?.dispose();}

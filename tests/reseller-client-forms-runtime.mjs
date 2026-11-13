// Browser coverage uses the actual production artifact and synthetic panel data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PORTAL_ASSET_VERSION} from '../cloudflare-worker/src/reseller-panel-assets.mjs';
import {createOwnerPortal} from '../cloudflare-worker/src/owner-portal.mjs';
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from '../cloudflare-worker/src/reseller-portal.mjs';
const target={id:'fixture-reseller',slug:'fixture-reseller',name:'Reseller ficticio',role:'reseller',status:'active',balance:5200,revision:0};
const now=Date.now(),line={id:'fixture-client',account_id:target.id,account_name:target.name,username:'clienteficticio',label:'Cliente ficticio',status:'registered',password:'Synthetic-client-password',notes:'',revision:0,connections:3,created_at:now,expires_at:now+86400000,package_id:'months-1',package_name:'1 mes',adult_access:0,sourceMetadata:{expiryTimezone:'America/Chicago'}};
const packages=[{id:'months-1',name:'1 mes',months:1,bonus_months:0,cost:100,connections:3,active:1,revision:1}];
let ownerMode=false,browser,runtime;const errors=[],writes=[];let trialPolicy={enabled:1,minutes:60,daily_limit:5,active_limit:3,revision:0};
const snapshot=()=>({actor:ownerMode?{id:'owner',role:'owner',name:'Propietario ficticio'}:target,target,overview:false,accounts:ownerMode?[target]:[],lines:[line],ledger:[],operations:[],packages,trialPolicy,serverTime:now,stats:{total:1,expiring:0,suspended:0},integration:{connected:true,accountId:target.id,accountName:target.name,accounts:[{accountId:target.id}]}});
const owner=createOwnerPortal({getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'f'.repeat(64),siteToken:'synthetic-only-not-a-real-token'}),fetcher:async()=>Response.json(snapshot())});
try{
 const artifact='cloudflare-worker/.wrangler/quality-release/index.js';
 assert.ok(fs.existsSync(artifact),'Build the production release before checking portal forms.');
 const options={workers:[{name:'client-forms-release',modules:true,script:fs.readFileSync(artifact,'utf8'),compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],outboundService:()=>{throw Error('No external services are used by client form tests.');}}]};
 runtime=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);await runtime.ready;const worker=await runtime.getWorker('client-forms-release');
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:1000}});
 await context.addCookies([{name:'__Host-SNAP_Owner_Portal',value:'a'.repeat(64),domain:'api.snaptvnow.com',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.route(/^https:\/\/(resellers|api)\.snaptvnow\.com\//,async route=>{
  const req=route.request(),url=new URL(req.url());let response;
  if(url.pathname.endsWith('/api/panel')){
   if(req.method()==='POST'){const body=req.postDataJSON();writes.push(body);assert.equal(body.expectedActorId,snapshot().actor.id);if(body.action==='trial.policy'){assert.equal(ownerMode,true);trialPolicy={enabled:body.enabled?1:0,minutes:body.minutes,daily_limit:body.dailyLimit,active_limit:body.activeLimit,revision:trialPolicy.revision+1};}response=Response.json({actorId:snapshot().actor.id,ok:true,id:body.lineId||'fixture-trial',trial:body.action==='line.trial',creditsSpent:0});}
   else response=Response.json(url.searchParams.has('lineId')?line:snapshot());
  }else{
   const request=new Request(req.url(),{method:req.method(),headers:await req.allHeaders()});
   response=ownerMode&&!url.pathname.includes('/assets/')?await owner(request,{}):await worker.fetch(request);
  }
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:1000});await page.goto('https://resellers.snaptvnow.com/?view=lines');
  assert.ok((await page.locator('script[src*="/assets/panel.js"]').getAttribute('src')).includes('v='+PORTAL_ASSET_VERSION),'page loads its matching production asset');
  await page.getByRole('button',{name:'Generar prueba',exact:true}).click();const dialog=page.locator('dialog[open]');
  const username='ClIeNtECase'+width;await dialog.locator('[name=label]').fill('Cliente ficticio');await dialog.locator('[name=username]').fill(username);
  for(const field of ['customer','notes']){
   const input=dialog.locator('[name='+field+']');assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>el.required),false);
  }
  assert.equal(await dialog.locator('form').evaluate(form=>form.checkValidity()),true,'blank optional fields pass native browser validation');
  if(width===390){fs.mkdirSync('artifacts',{recursive:true});await dialog.screenshot({path:'artifacts/reseller-optional-fields-mobile.png'});}
  const posted=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/api/panel')&&req.postDataJSON()?.action==='line.trial');
  await dialog.getByRole('button',{name:'Generar prueba · 0 créditos',exact:true}).click();const body=(await posted).postDataJSON();
  assert.equal(body.accountId,target.id);assert.equal(body.username,username);assert.ok(!body.customer);assert.ok(!body.notes);await dialog.waitFor({state:'hidden'});
 }
 ownerMode=true;await page.setViewportSize({width:390,height:1000});await page.goto('https://api.snaptvnow.com/owner-panel/?view=lines&slug=fixture-reseller');
 assert.ok((await page.locator('script[src*="/assets/panel.js"]').getAttribute('src')).includes('v='+PORTAL_ASSET_VERSION));
 await page.getByRole('button',{name:'Editar '+line.username,exact:true}).click();let dialog=page.locator('dialog[open]');
 assert.equal(await dialog.locator('[name=notes]').evaluate(el=>el.required),false);
 await dialog.getByRole('button',{name:'Cambiar vencimiento · administrador',exact:true}).click();dialog=page.locator('dialog[open]');
 await dialog.locator('[name=adminExpiryLocal]').fill('2030-06-30T21:45');await dialog.locator('[name=reason]').fill('Corrección ficticia');
 assert.equal(await dialog.locator('[name=confirmUsername]').count(),0,'selected client never needs a typed username confirmation for expiry');
 const posted=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/api/panel')&&req.postDataJSON()?.action==='line.admin-expiry');
 await dialog.getByRole('button',{name:'Guardar',exact:true}).click();const body=(await posted).postDataJSON();
 assert.equal(body.lineId,line.id);assert.ok(!body.confirmUsername);assert.equal(body.revision,0);assert.deepEqual(errors,[]);

 await dialog.waitFor({state:'hidden'});await page.setViewportSize({width:1280,height:1000});
 await page.getByRole('button',{name:'Reglas',exact:true}).click();await page.getByRole('button',{name:'Configurar pruebas',exact:true}).click();dialog=page.locator('dialog[open]');
 await page.setViewportSize({width:390,height:1000});
 assert.equal(await dialog.locator('[name=trialDurationAmount]').inputValue(),'1');assert.equal(await dialog.locator('[name=trialDurationUnit]').inputValue(),'hours');
 await dialog.locator('[name=trialDurationAmount]').fill('3');await dialog.locator('[name=trialDurationUnit]').selectOption('days');
 assert.equal(await dialog.locator('[name=minutes]').inputValue(),'4320');assert.equal(await dialog.locator('form').evaluate(form=>form.checkValidity()),true);
 const changed=page.waitForRequest(req=>req.method()==='POST'&&req.url().includes('/api/panel')&&req.postDataJSON()?.action==='trial.policy');
 await dialog.getByRole('button',{name:'Guardar',exact:true}).click();assert.equal((await changed).postDataJSON().minutes,4320);await dialog.waitFor({state:'hidden'});
 ownerMode=false;await page.setViewportSize({width:1280,height:1000});await page.goto('https://resellers.snaptvnow.com/?view=lines');
 await page.getByRole('button',{name:'Reglas',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Configurar pruebas',exact:true}).count(),0);
 await page.goto('https://resellers.snaptvnow.com/?view=lines');await page.setViewportSize({width:390,height:1000});await page.getByRole('button',{name:'Generar prueba',exact:true}).click();dialog=page.locator('dialog[open]');
 assert.equal(await dialog.locator('[name=trialDurationAmount],[name=trialDurationUnit],[name=minutes]').count(),0);
 assert.ok(await dialog.locator('input[readonly]').evaluateAll(inputs=>inputs.some(input=>input.value==='3 días desde la creación · automático')));
 assert.deepEqual(errors,[]);
 assert.equal(writes.filter(body=>body.action==='line.trial').length,2);
 console.log('PASS: production reseller assets submit empty contact/notes on mobile and desktop; owner expiry uses the selected client without typed confirmation; owner custom duration is inherited read-only by resellers.');
}finally{await browser?.close();await runtime?.dispose();}

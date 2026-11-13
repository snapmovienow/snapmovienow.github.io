// Local browser acceptance: owner UI and HLS Auto under shaped bandwidth.
// This is not acceptance of any customer's app or OVH's external network.
import assert from 'node:assert/strict';
import path from 'node:path';import {pathToFileURL} from 'node:url';import {mkdir,writeFile} from 'node:fs/promises';
import {createPilot} from './pilot.mjs';
const {chromium}=process.env.SNAP_PILOT_PLAYWRIGHT_MODULE?await import(pathToFileURL(process.env.SNAP_PILOT_PLAYWRIGHT_MODULE)):await import('playwright');
const hlsPath=process.env.SNAP_PILOT_HLS_FILE||path.resolve('node_modules/hls.js/dist/hls.min.js');
const adminToken='browser_pilot_synthetic_acceptance_'.repeat(2);
let pilot,browser;
try{
  pilot=await createPilot({adminToken,demo:true,catalog:[{id:'demo-sports',name:'Deporte de prueba',categoryId:'demo',categoryName:'Prueba privada',demo:true}]});
  await new Promise(r=>pilot.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+pilot.server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  await page.getByLabel('Clave privada del piloto').fill(adminToken);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByRole('heading',{name:'1. Seleccionar contenido'}).waitFor();
  await page.getByRole('checkbox',{name:'Prueba privada',exact:true}).check();
  await page.getByRole('checkbox',{name:'Incluir el logo configurado'}).uncheck();
  await page.getByRole('checkbox',{name:'Permitir procesar lo seleccionado'}).check();
  await page.getByRole('button',{name:'Guardar configuración'}).click();
  await page.getByText('Configuración guardada. Solo afecta a este piloto.',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile UI must fit viewport');
  if(process.env.SNAP_PILOT_SCREENSHOT){const filename=path.resolve(process.env.SNAP_PILOT_SCREENSHOT);await mkdir(path.dirname(filename),{recursive:true});await page.screenshot({path:filename,fullPage:true});}
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Generar enlace privado'}).click();await page.locator('#preview-result').waitFor({state:'visible'});
  const preview=await page.locator('#preview-url').inputValue();
  const player=await context.newPage();await player.route('**/acceptance-player',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><video id="v" autoplay muted playsinline width="1280" height="720"></video>'}));
  await player.goto(origin+'/acceptance-player');await player.addScriptTag({path:hlsPath});
  await player.evaluate(url=>{
    window.levels=[];window.fatal=[];const video=document.getElementById('v');
    window.hls=new Hls({enableWorker:false,startLevel:1,capLevelToPlayerSize:false,maxBufferLength:6,maxMaxBufferLength:8,liveSyncDurationCount:2,abrEwmaFastLive:1,abrEwmaSlowLive:2});
    hls.on(Hls.Events.LEVEL_SWITCHED,(_,d)=>levels.push(d.level));hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)fatal.push(d.details);});
    hls.loadSource(url);hls.attachMedia(video);video.play().catch(()=>{});
  },preview);
  await player.waitForFunction(()=>document.getElementById('v').videoHeight===720&&document.getElementById('v').currentTime>=2,{},{timeout:30000});
  const cdp=await context.newCDPSession(player);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:60,downloadThroughput:162500,uploadThroughput:1000000});
  await player.waitForFunction(()=>document.getElementById('v').videoHeight===480,{},{timeout:45000});
  const result=await player.evaluate(()=>({height:document.getElementById('v').videoHeight,position:document.getElementById('v').currentTime,levels,fatal}));
  assert(result.position>2);assert.equal(result.fatal.length,0);assert(result.levels.includes(1)&&result.levels.includes(0));assert.equal(errors.length,0);
  const report={at:new Date().toISOString(),scope:'local Chromium, synthetic video, shaped browser bandwidth; not all DNS apps or OVH capacity',ownerSelectionSaved:true,mobileFits:true,autoChangedFrom720To480:true,shapedDownloadMbps:1.3,playback:result,ovhCapacityMeasured:false,customerRouting:false};
  if(process.env.SNAP_PILOT_BROWSER_REPORT){const file=path.resolve(process.env.SNAP_PILOT_BROWSER_REPORT);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await pilot?.close();}

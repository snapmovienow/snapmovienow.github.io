// Optional real-browser regression: requires ffmpeg, hls.js@1.6.15,
// Playwright and a Chromium executable. It creates its own public test signal;
// no provider credentials, customer sessions or media URLs are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const require=createRequire(import.meta.url);
const modules=process.env.SMN_QA_MODULES;
const load=name=>modules?require(path.join(modules,name)):require(name);
let playwright;
try{playwright=load('playwright')}catch{
 playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'));
}
const hlsPath=modules?require.resolve(path.join(modules,'hls.js')):require.resolve('hls.js');
const Hls= require(hlsPath);
assert.equal(Hls.version,'1.6.15','this regression targets the pinned production engine');
const html=(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'));
const expression=html.match(/hlsEngine=new Hls\((\{.*?\})\);const engine=hlsEngine/)[1];
const liveConfig=JSON.parse(JSON.stringify(vm.runInNewContext('('+expression+')',{currentPlay:{type:'live'}})));
assert.equal(liveConfig.progressive,false,'production must feed complete segments');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'smn-live-audio-'));
let browser;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><video id="v" muted autoplay playsinline></video>');return;}
 const file=path.join(root,url.pathname);
 if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
 let data=fs.readFileSync(file);
 if(file.endsWith('.m3u8')){data=Buffer.from(data.toString().replace('#EXT-X-ENDLIST',''));res.setHeader('Content-Type','application/vnd.apple.mpegurl');}
 else res.setHeader('Content-Type','video/mp2t');
 res.setHeader('Content-Length',data.length);res.setHeader('Cache-Control','no-store');
 let offset=0;
 function send(){
  if(res.destroyed)return;
  const end=Math.min(data.length,offset+131072);res.write(data.subarray(offset,end));offset=end;
  if(offset>=data.length)res.end();else setTimeout(send,10);
 }
 send();
});
try{
 for(const codec of ['aac','libmp3lame']){
  const out=path.join(root,codec);fs.mkdirSync(out);
  const r=spawnSync(process.env.SMN_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=720x480:rate=30','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','60','-c:v','libx264','-preset','ultrafast','-profile:v','main','-b:v','1600k','-g','300','-keyint_min','300','-sc_threshold','0','-c:a',codec,'-b:a','128k','-ac','2','-f','hls','-hls_time','10','-hls_list_size','0','-hls_segment_filename',out+'/seg%02d.ts','-y',out+'/index.m3u8'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||String(r.error));
 }
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await playwright.chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
 const results=await Promise.all(['aac','libmp3lame'].flatMap(codec=>[true,false].map(async progressive=>{
  const page=await browser.newPage();
  await page.goto(base);await page.addScriptTag({path:hlsPath});
  await page.evaluate(({base,codec,config})=>{
   window.errors=[];window.tracks={};window.first=null;
   const v=document.getElementById('v');window.engine=new Hls(config);
   engine.on(Hls.Events.BUFFER_CREATED,(_,d)=>window.tracks=d.tracks);
   engine.on(Hls.Events.ERROR,(_,d)=>{errors.push({detail:d.details,fatal:d.fatal});if(errors.length>30)errors.shift()});
   v.addEventListener('playing',()=>{if(first===null)first=v.currentTime});
   engine.loadSource(base+'/'+codec+'/index.m3u8');engine.attachMedia(v);v.play().catch(()=>{});
  },{base,codec,config:{...liveConfig,progressive}});
  await page.waitForTimeout(12000);
  const result=await page.evaluate(()=>{
   const v=document.getElementById('v');
   function ranges(b){return Array.from({length:b?.length||0},(_,i)=>[b.start(i),b.end(i)])}
   const q=v.getVideoPlaybackQuality();
   return {position:v.currentTime,firstPosition:first,ready:v.readyState,seeking:v.seeking,decoded:q.totalVideoFrames,dropped:q.droppedVideoFrames,audio:ranges(tracks.audio?.buffer?.buffered),video:ranges(tracks.video?.buffer?.buffered),audioContainer:tracks.audio?.container,errors};
  });
  await page.close();return {codec,progressive,...result};
 })));
 const duration=r=>r.audio.reduce((total,[start,end])=>total+end-start,0);
 const broken=results.find(r=>r.codec==='libmp3lame'&&r.progressive);
 const fixed=results.find(r=>r.codec==='libmp3lame'&&!r.progressive);
 assert(duration(broken)<3,'original mode reproduces shortened MPEG audio buffers');
 assert(broken.errors.some(e=>e.detail==='bufferStalledError'),'original mode reproduces the customer error');
 for(const result of results.filter(r=>!r.progressive)){
  assert.equal(result.errors.length,0,'complete segments must not generate HLS errors');
  assert.equal(result.ready,4);assert.equal(result.seeking,false);
  assert(result.position-result.firstPosition>=8,'fixed player advances continuously');
  assert(duration(result)>=20,'fixed audio buffer covers complete media segments');
  assert(result.decoded>=200,'fixed video is actually decoded');
 }
 assert(duration(fixed)>10*duration(broken));
 const report={hlsVersion:Hls.version,browserVersion:browser.version(),productionProgressive:liveConfig.progressive,signal:'generated H.264 720x480 with AAC or MPEG Layer III audio, six 10-second TS segments',observedSeconds:12,results,limitations:['Synthetic fixtures reproduce the same audio-buffer failure; the authenticated customer channel and physical Android device are not exercised.']};
 if(process.env.SMN_LIVE_AUDIO_REPORT){fs.mkdirSync(path.dirname(process.env.SMN_LIVE_AUDIO_REPORT),{recursive:true});fs.writeFileSync(process.env.SMN_LIVE_AUDIO_REPORT,JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify({status:'PASS',hlsVersion:Hls.version,browserVersion:browser.version(),results:results.map(r=>({codec:r.codec,progressive:r.progressive,position:r.position,audioSeconds:duration(r),errors:r.errors.length,decoded:r.decoded}))}));
}finally{
 await browser?.close();server.close();fs.rmSync(root,{recursive:true,force:true});
}

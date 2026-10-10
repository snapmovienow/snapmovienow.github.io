// Real Chromium/MSE decoding of generated media, on loopback only.
// This is a delivery baseline, not a Cloudflare/provider concurrency certificate.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawnSync} from 'node:child_process';import {chromium} from 'playwright';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snap-video-capacity-')),levels=(process.env.SMN_VIDEO_LEVELS||'1,5,10,20').split(',').map(Number);
assert(levels.length<=6&&levels.every(n=>Number.isInteger(n)&&n>=1&&n<=30),'bounded local-only concurrency');
const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-b:v','250k','-g','30','-c:a','aac','-b:a','64k','-f','hls','-hls_time','2','-hls_list_size','0',path.join(dir,'index.m3u8')]);assert.equal(ffmpeg.status,0,ffmpeg.stderr.toString());
let tally={requests:0,bytes:0,failedRequests:0},browser;
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1);
 if(!name){res.setHeader('Content-Type','text/html');res.end('<!doctype html><video id="v" autoplay muted playsinline></video>');return;}
 if(!/^index(?:\d+\.ts|\.m3u8)$/.test(name)){res.writeHead(404);res.end();return;}
 const data=fs.readFileSync(path.join(dir,name)),run=tally;run.requests++;
 res.setHeader('Content-Type',name.endsWith('m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');res.setHeader('Content-Length',data.length);res.setHeader('Cache-Control','no-store');
 let done=false;res.on('finish',()=>{done=true;run.bytes+=data.length});res.on('close',()=>{if(!done)run.failedRequests++});res.end(data);
});
const report={at:new Date().toISOString(),scope:'generated H.264/AAC, Chromium/MSE, loopback HTTP; excludes Cloudflare/provider production, real spectators and billing',width:320,height:180,fps:15,scenarios:[]};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.SMN_BROWSER_EXECUTABLE?{executablePath:process.env.SMN_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
 for(const viewers of levels){
  tally={requests:0,bytes:0,failedRequests:0};const pages=[],begin=performance.now();
  const results=await Promise.all(Array.from({length:viewers},async()=>{
   const page=await browser.newPage();pages.push(page);await page.goto(base);await page.addScriptTag({path:path.join(process.cwd(),'node_modules/hls.js/dist/hls.min.js')});
   await page.evaluate(base=>{const v=document.querySelector('video');window.cutCount=0;window.mediaErrors=[];window.startedAt=null;const start=performance.now();let began=false;
    v.addEventListener('playing',()=>{if(!began){began=true;startedAt=performance.now()-start}});v.addEventListener('waiting',()=>{if(began)cutCount++});
    window.engine=new Hls({progressive:false,enableWorker:false});engine.on(Hls.Events.ERROR,(_,e)=>{if(e.fatal)mediaErrors.push(e.details)});engine.loadSource(base+'/index.m3u8');engine.attachMedia(v);v.play().catch(()=>{});
   },base);
   await page.waitForFunction(()=>document.querySelector('video').currentTime>=4,{},{timeout:25000});
   return page.evaluate(()=>{const v=document.querySelector('video'),q=v.getVideoPlaybackQuality();return {startupMs:startedAt,position:v.currentTime,decoded:q.totalVideoFrames,dropped:q.droppedVideoFrames,cuts:cutCount,errors:mediaErrors.length}});
  }));
  const sorted=results.map(r=>r.startupMs).sort((a,b)=>a-b),seconds=(performance.now()-begin)/1000;
  assert(results.every(r=>r.position>=4&&r.decoded>=15&&r.errors===0),'every synthetic viewer must decode and advance');
  report.scenarios.push({viewers,startupP95Ms:Number(sorted[Math.ceil(sorted.length*.95)-1].toFixed(1)),seconds:Number(seconds.toFixed(2)),...tally,cuts:results.reduce((n,r)=>n+r.cuts,0),decoded:results.reduce((n,r)=>n+r.decoded,0),dropped:results.reduce((n,r)=>n+r.dropped,0),fatalErrors:results.reduce((n,r)=>n+r.errors,0)});
  await Promise.all(pages.map(p=>p.close()));console.log('PASS local video delivery: '+viewers+' concurrent synthetic viewers.');
 }
 if(process.env.SMN_VIDEO_REPORT){const file=path.resolve(process.env.SMN_VIDEO_REPORT);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}

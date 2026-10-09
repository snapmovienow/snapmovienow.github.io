import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../live-diagnostics.js', import.meta.url), 'utf8'), context);
const ranges = pairs => ({length:pairs.length,start:i=>pairs[i][0],end:i=>pairs[i][1]});
function fixture() {
 let clock=0,tick,cleared=0,active=true,hidden=false;
 const listeners=new Map(),videoListeners=new Map();
 const video={currentTime:60,paused:false,seeking:false,readyState:3,videoWidth:1920,videoHeight:1080,buffered:ranges([[50,81]]),addEventListener:(k,f)=>videoListeners.set(k,f),removeEventListener:k=>videoListeners.delete(k),getVideoPlaybackQuality:()=>({totalVideoFrames:1800,droppedVideoFrames:32})};
 const events=Object.fromEntries(['ERROR','BUFFER_CREATED','BUFFER_CODECS','LEVEL_LOADED','LEVEL_PTS_UPDATED','FRAG_LOADING','FRAG_LOADED','FRAG_BUFFERED'].map(k=>[k,k]));
 const engine={config:{progressive:true},on:(k,f)=>listeners.set(k,f),off:k=>listeners.delete(k)};
 const diag=context.createLiveDiagnostics(video,{engine,events,quality:'1080',errorTypes:{NETWORK:'networkError'},errorDetails:{LOAD:'fragLoadError',STALL:'bufferStalledError'},now:()=>clock,schedule:fn=>(tick=fn,1),unschedule:()=>cleared++,active:()=>active,hidden:()=>hidden});
 return {diag,video,fire:(k,d)=>listeners.get(k)?.(k,d),advance:ms=>{clock+=ms;tick()},setActive:v=>active=v,setHidden:v=>hidden=v,listeners,videoListeners,cleared:()=>cleared};
}
{
 const f=fixture();
 const secret='https://secret.test/stream?username=someone&password=secret&ticket=private';
 f.fire('BUFFER_CODECS',{video:{codec:'avc1.64002a',metadata:{width:1920,height:1080},url:secret,initSegment:new Uint8Array([1,2])},audio:{codec:secret}});
 f.fire('BUFFER_CREATED',{tracks:{audio:{buffer:{buffered:ranges([[50,81]])}},video:{buffer:{buffered:ranges([[50,79]])}}}});
 f.fire('LEVEL_LOADED',{details:{live:true,startSN:100,endSN:106,targetduration:10,totalduration:70,url:secret},stats:{loaded:500,loading:{start:100,first:1000,end:1100}}});
 const frag={type:'main',sn:103,cc:0,start:60,duration:10,url:secret,stats:{loaded:200000,total:3000000,retry:0,chunkCount:2,loading:{start:1100,first:2100,end:0}}};
 f.fire('FRAG_LOADING',{frag});
 f.fire('ERROR',{type:'networkError',details:'bufferStalledError',fatal:false,response:{code:403,url:secret,text:secret},error:new Error(secret),frag,networkDetails:{headers:{Authorization:secret}}});
 f.advance(8000);
 const r=f.diag.report();
 assert.equal(r.reason,'timeline_stall');assert.equal(r.state.position,60);assert.equal(r.state.buffered[0][1],81);
 assert.equal(r.state.audioBuffered[0][1],81);assert.equal(r.state.videoBuffered[0][1],79);
 assert.equal(r.state.pending.bytes,200000);assert.equal(r.state.pending.firstByteMs,1000);assert.equal(r.state.pending.loadMs,null);
 assert.equal(r.codecs.video.codec,'avc1.64002a');assert.equal(r.codecs.audio.codec,'unknown');
 assert.equal(r.events.at(-1).fatal,false,'nonfatal errors are captured');assert.equal(r.events.at(-1).status,403);
 assert(!JSON.stringify(r).match(/secret|ticket|password|username|https/),'report contains no URLs, credentials, headers, payloads or raw error text');
 f.video.currentTime=80;f.video.buffered=ranges([[70,100]]);f.advance(1000);f.diag.stop();
 assert.equal(f.diag.report().state.position,60,'recovery and cleanup cannot overwrite the frozen cut');
 assert.equal(f.listeners.size,0);assert.equal(f.videoListeners.size,0);assert.equal(f.cleared(),1);f.diag.stop();assert.equal(f.cleared(),1);
}
{
 const f=fixture();
 f.fire('BUFFER_CODECS',{audio:{container:'audio/mpeg',codec:''},video:{container:'video/mp4',codec:'avc1.64001e'}});
 const r=f.diag.report();
 assert.equal(r.codecs.audio.container,'audio/mpeg');assert.equal(r.codecs.audio.codec,'mpeg-audio');
 assert.equal(r.codecs.video.container,'video/mp4');
 f.fire('BUFFER_CODECS',{audio:{container:'https://private.test/?ticket=secret',codec:''}});
 assert.equal(f.diag.report().codecs.audio.container,'unknown');
 assert(!JSON.stringify(f.diag.report()).includes('secret'));f.diag.stop();
}
{
 const f=fixture();
 for(let i=0;i<250;i++){
  f.video.currentTime++;
  f.fire('LEVEL_LOADED',{details:{live:true,startSN:i,endSN:i+5,targetduration:10}});
  f.fire('ERROR',{type:'private',details:'arbitrary-secret',fatal:false,reason:'password'});
  f.advance(2000);
 }
 const r=f.diag.report();assert.equal(r.reason,'manual');assert.equal(r.events.length,32);assert.equal(r.samples.length,16);
 assert(!JSON.stringify(r).includes('arbitrary-secret'));assert.equal(r.events.at(-1).detail,'unknown');
 f.video.paused=true;f.advance(60000);assert.equal(f.diag.report().reason,'manual','intentional pause is not a stall');
 f.video.paused=false;f.setHidden(true);f.advance(60000);assert.equal(f.diag.report().reason,'manual','background is not a stall');
 f.setActive(false);f.advance(1000);assert.equal(f.cleared(),1);assert.equal(f.listeners.size,0);assert.equal(f.videoListeners.size,0);
}
{
 const f=fixture();
 const frag={type:'main',sn:104,duration:10,stats:{loaded:3000000,total:3000000,retry:1,chunkCount:4,loading:{start:1000,first:7000,end:8500}},elementaryStreams:{video:{startPTS:60,endPTS:70,startDTS:59.9,endDTS:69.9}}};
 f.fire('FRAG_LOADING',{frag});f.fire('FRAG_LOADED',{frag});f.fire('FRAG_BUFFERED',{frag});
 const r=f.diag.report();assert.equal(r.state.pending,null);assert.equal(r.events[1].firstByteMs,6000);assert.equal(r.events[1].loadMs,7500);assert.equal(r.events[2].endPTS,70);
 f.fire('ERROR',{type:'networkError',details:'fragLoadError',fatal:true,response:{code:502}});
 assert.equal(f.diag.report().reason,'fatal_error');f.diag.stop();
}

// Phone clipboard restrictions fall back to selectable text; each channel starts
// a fresh history and cleanup records the cut before destroying the HLS engine.
{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const nodes=Object.fromEntries(['liveDiagnosticPanel','liveDiagnosticStatus','liveDiagnosticText','copyLiveDiagnostic'].map(id=>[id,{hidden:false,value:'',textContent:'',focus(){this.focused=true},select(){this.selected=true},addEventListener(){}}]));
 const code=html.slice(html.indexOf('let stopLiveWatchdog='),html.indexOf('function stopPlayback('));
 let copied;
 const ui={document:{getElementById:id=>nodes[id]},window:{Hls:{version:'1.6.15'}},navigator:{clipboard:{writeText:async t=>{copied=t}}}};
 vm.createContext(ui);vm.runInContext(code,ui);
 vm.runInContext('liveDiagnosticHistory=[{reason:"timeline_stall",state:{position:60}}]',ui);
 await ui.copyLiveDiagnostic();assert.equal(JSON.parse(copied).reports[0].state.position,60);assert.equal(JSON.parse(copied).webVersion,'42');
 ui.navigator.clipboard.writeText=async()=>{throw new Error('blocked')};
 await ui.copyLiveDiagnostic();assert.equal(nodes.liveDiagnosticText.hidden,false);assert(nodes.liveDiagnosticText.selected);assert.equal(nodes.liveDiagnosticText.value,copied);
 ui.resetLiveDiagnostics('live');assert.equal(nodes.liveDiagnosticPanel.hidden,false);assert.equal(nodes.liveDiagnosticText.value,'');
 copied=null;await ui.copyLiveDiagnostic();assert.equal(copied,null);assert.match(nodes.liveDiagnosticStatus.textContent,/Primero reproduce/);
 ui.resetLiveDiagnostics();assert.equal(nodes.liveDiagnosticPanel.hidden,true);
 assert(html.includes('()=>diagnostic?.stop(),()=>watchdog?.(),()=>engine?.destroy()'));
 assert(html.includes('liveDiagnostics?.capture("watchdog_recovery")'));
}
console.log('PASS: real HLS event-shaped data, nonfatal and fatal errors, pending download timing, separate audio/video buffers, frozen cuts, privacy, bounded memory, cleanup and phone clipboard fallback.');

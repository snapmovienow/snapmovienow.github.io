// Real FFmpeg/ffprobe acceptance on synthetic video. No customer/provider calls.
import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {createPilot} from './pilot.mjs';import {DEFAULT_POLICY} from './policy.mjs';
const temporary=await mkdtemp(path.join(os.tmpdir(),'snap-pilot-smoke-')),token='local_synthetic_acceptance_'.repeat(2);
let pilot;
try{
  const logoPath=path.join(temporary,'logo.bmp');
  const logo=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x00d1d4:s=96x48','-frames:v','1','-y',logoPath],{encoding:'utf8'});
  assert.equal(logo.status,0,'synthetic logo fixture');
  let clock=Date.now();
  pilot=await createPilot({adminToken:token,logoPath,demo:true,now:()=>clock,
    catalog:[{id:'demo-sports',name:'Video sintético',categoryId:'demo',categoryName:'Prueba',demo:true}],
    initialPolicy:{...DEFAULT_POLICY,enabled:true,channels:['demo-sports'],idleSeconds:10},startTimeoutMs:30000});
  await new Promise(r=>pilot.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+pilot.server.address().port;
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const issued=await fetch(origin+'/api/preview',{method:'POST',headers,body:JSON.stringify({channelId:'demo-sports'})}),preview=await issued.json();assert.equal(issued.status,200);
  const begin=performance.now(),response=await fetch(origin+preview.url),master=await response.text();assert.equal(response.status,200,master);
  const results=[];
  for(const uri of master.split('\n').filter(l=>l&&!l.startsWith('#'))){
    const playlistUrl=new URL(uri,origin+preview.url),r=await fetch(playlistUrl),playlist=await r.text();assert.equal(r.status,200);
    const segment=playlist.split('\n').find(l=>l&&!l.startsWith('#')),data=Buffer.from(await (await fetch(new URL(segment,playlistUrl))).arrayBuffer()),file=path.join(temporary,`output-${results.length}.ts`);await writeFile(file,data);
    const probe=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'});assert.equal(probe.status,0);
    const streams=JSON.parse(probe.stdout).streams,video=streams.find(s=>s.codec_type==='video'),audio=streams.find(s=>s.codec_type==='audio');
    assert.equal(video.codec_name,'h264');assert.equal(audio.codec_name,'aac');assert.equal(video.height,results.length===0?480:720);
    const decode=spawnSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:10*1024*1024});assert.equal(decode.status,0);
    // The opaque turquoise fixture must survive scaling in the top-right logo region.
    const scale=video.width/1280,x=Math.floor((1280-18-48)*scale),y=Math.floor(42*video.height/720),offset=(y*video.width+x)*3,pixel=[...decode.stdout.subarray(offset,offset+3)];
    assert(pixel[0]<70&&pixel[1]>140&&pixel[2]>140,'logo pixels must be present');
    results.push({width:video.width,height:video.height,video:video.codec_name,audio:audio.codec_name,logoPixel:pixel,segmentBytes:data.length});
  }
  const status=await (await fetch(origin+'/api/status',{headers})).json();assert.equal(status.starts,1);assert.equal(status.active.length,1);
  clock+=10001;await pilot.sweep();const after=await (await fetch(origin+'/api/status',{headers})).json();assert.equal(after.active.length,0);
  const report={at:new Date().toISOString(),scope:'synthetic video, loopback, local executor; not OVH capacity, no real provider or customers',hlsReadyMs:Math.round(performance.now()-begin),oneEncoderShared:true,idleStopped:true,profiles:results,host:status.host,ovhCapacityMeasured:false,customerRouting:false};
  if(process.env.SNAP_PILOT_REPORT){const output=path.resolve(process.env.SNAP_PILOT_REPORT);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
  if(process.env.SNAP_PILOT_FRAME){const output=path.resolve(process.env.SNAP_PILOT_FRAME);await mkdir(path.dirname(output),{recursive:true});const frame=spawnSync('ffmpeg',['-v','error','-i',path.join(temporary,'output-1.ts'),'-frames:v','1','-y',output]);assert.equal(frame.status,0);}
  console.log(JSON.stringify(report,null,2));
}finally{await pilot?.close();await rm(temporary,{recursive:true,force:true});}

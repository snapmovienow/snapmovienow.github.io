// Aggregate counters only: diagnostic traces and media URLs stay on the device.
globalThis.createPlaybackMetrics=function(video,{send,type='live',quality='other',server='ccf',now=performance.now.bind(performance),schedule=setInterval,cancel=clearInterval,hidden=()=>document.hidden}={}){
 let started=false,reportedStart=false,reportedAttempt=false,reportedFailure=false,stopped=false,last=now(),start=last,waiting=false,watch=0,stall=0,stalls=0,errors=0,startup=null,bytes=null;
 let active=false,remoteAvailable=true,pending=null,running=null,previousFrames=video.getVideoPlaybackQuality?.()||{totalVideoFrames:0,droppedVideoFrames:0};
 const listeners=[];
 const sample=()=>{const t=now(),dt=Math.max(0,Math.min(5000,t-last));last=t;if(active){watch=Math.min(300000,watch+dt);if(waiting)stall=Math.min(watch,stall+dt)}active=started&&!hidden()&&!video.paused&&!video.seeking};
 const on=(name,fn)=>{video.addEventListener(name,fn);listeners.push([name,fn])};
 on('waiting',()=>{sample();if(!waiting&&started)stalls=Math.min(100,stalls+1);waiting=true});
 on('playing',()=>{sample();if(!started){started=true;startup=Math.min(300000,now()-start)}waiting=false;active=!hidden()&&!video.paused&&!video.seeking});
 for(const name of ['pause','seeking','seeked','play'])on(name,sample);
 const error=()=>{errors=Math.min(100,errors+1)};on('error',error);
 async function flush(){
  sample();if(running)return running;if(!remoteAvailable)return;
  if(!pending){
   const q=video.getVideoPlaybackQuality?.()||previousFrames,decoded=Math.min(100000,Math.max(0,(q.totalVideoFrames||0)-(previousFrames.totalVideoFrames||0)));
   const failedStart=!started&&!reportedFailure&&(errors>0||stopped);
   if(!watch&&!started&&!errors&&!failedStart)return;
   if(!watch&&reportedStart&&!errors&&!failedStart&&(!bytes))return;
   pending={report_id:globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),platform:'web',type,quality,server,attempted:!reportedAttempt,failedStart,started:!reportedStart&&started,startupMs:!reportedStart?startup:null,watchMs:Math.round(watch),stallMs:Math.round(stall),stalls,errors,bytes,decoded,dropped:Math.min(decoded,Math.max(0,(q.droppedVideoFrames||0)-(previousFrames.droppedVideoFrames||0)))};
   previousFrames=q;watch=0;stall=0;stalls=0;errors=0;if(bytes!==null)bytes=0;reportedAttempt=true;if(started)reportedStart=true;if(failedStart)reportedFailure=true;
  }
  const batch=pending;
  running=(async()=>{await Promise.resolve();let accepted=false;try{const result=await send(batch);if(!result?.limited){pending=null;accepted=true}}catch(e){if((e?.code||e?.message)==='operation_not_allowed'){remoteAvailable=false;pending=null}}finally{running=null;if(stopped&&accepted&&(watch||errors||!started&&!reportedFailure||started&&!reportedStart))await flush()}})();
  return running;
 }
 let elapsed=0;const timer=schedule(()=>{sample();if(++elapsed>=30){elapsed=0;flush()}},1000);
 return {addBytes(n){if(Number.isFinite(n)&&n>=0)bytes=Math.min(250000000,(bytes||0)+n)},error,flush,stop(){if(stopped)return;sample();stopped=true;cancel(timer);for(const [name,fn]of listeners)video.removeEventListener(name,fn);return flush()}};
};

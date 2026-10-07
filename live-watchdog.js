// Detect a frozen live timeline even when the HLS engine reports no fatal error.
function watchLivePlayback(video,options){
 const now=options.now||Date.now,schedule=options.schedule||setInterval,unschedule=options.unschedule||clearInterval;
 let stopped=false,lastTime=Number(video.currentTime)||0,lastMove=now(),lastTry=0,attempts=0,stableSince=now();
 const timer=schedule(()=>{
  if(stopped)return;
  if(!options.active()){stop();return}
  const time=now(),position=Number(video.currentTime)||0;
  if(video.paused||options.hidden?.()){lastMove=time;stableSince=time;lastTime=position;return}
  if(Math.abs(position-lastTime)>0.04){lastMove=time;lastTime=position;if(time-stableSince>=30000)attempts=0;return}
  if(time-lastMove<8000||time-lastTry<8000)return;
  lastTry=time;lastMove=time;stableSince=time;
  if(attempts<2){attempts++;options.recover(attempts)}else{stop();options.fallback()}
 },1000);
 function stop(){if(stopped)return;stopped=true;unschedule(timer)}
 return stop;
}

// Resume on a complete playlist segment, rather than an unbuffered live-edge
// offset that may require decoder reference frames the player never received.
function recoverLivePlayback(video,engine,attempt){
 if(engine){
  // startLoad alone cannot refresh an ended or stale playlist. Reload the
  // same signed source without reserving another provider connection.
  if((video.ended||attempt===2)&&engine.url){
   engine.loadSource(engine.url);engine.startLoad(-1);video.play().catch(()=>{});return;
  }
  const level=engine.currentLevel>=0?engine.currentLevel:engine.loadLevel;
  const fragments=engine.levels?.[level]?.details?.fragments||[];
  const desired=engine.liveSyncPosition;
  let target=Number.isFinite(desired)?desired:-1;
  const starts=fragments.map(f=>f.start).filter(Number.isFinite).sort((a,b)=>a-b);
  if(starts.length&&target>=0)target=starts.filter(start=>start<=target).pop()??starts[0];
  engine.startLoad(target);
  const buffered=video.buffered;
  const safe=buffered&&Array.from({length:buffered.length},(_,i)=>i).some(i=>target>=buffered.start(i)&&target<buffered.end(i)-0.1);
  if(starts.includes(target)&&safe){try{video.currentTime=target}catch{}}
 }else{
  try{if(video.ended)video.load();else if(video.buffered?.length){const last=video.buffered.length-1;video.currentTime=Math.max(video.buffered.start(last),video.buffered.end(last)-4)}else if(attempt===2)video.load()}catch{}
 }
 video.play().catch(()=>{});
}

// Detect a frozen live timeline even when the HLS engine reports no fatal error.
function watchLivePlayback(video,options){
 const now=options.now||Date.now,schedule=options.schedule||setInterval,unschedule=options.unschedule||clearInterval;
 let stopped=false,lastTime=Number(video.currentTime)||0,lastMove=now(),lastTry=0,attempts=0,stableSince=now();
 const timer=schedule(()=>{
  if(stopped)return;
  if(!options.active()){stop();return}
  const time=now(),position=Number(video.currentTime)||0;
  if((video.paused&&!video.ended)||options.hidden?.()){lastMove=time;stableSince=time;lastTime=position;return}
  if(Math.abs(position-lastTime)>0.04){lastMove=time;lastTime=position;if(time-stableSince>=30000)attempts=0;return}
  const duration=Number(options.segmentDuration?.());
  const stallWindow=video.ended&&attempts===0?1000:Number.isFinite(duration)&&duration>0?Math.max(8000,Math.min(45000,duration*1500)):8000;
  if(time-lastMove<stallWindow||time-lastTry<stallWindow)return;
  lastTry=time;lastMove=time;stableSince=time;
  if(attempts<2){attempts++;options.recover(attempts)}else{stop();options.fallback()}
 },1000);
 function stop(){if(stopped)return;stopped=true;unschedule(timer)}
 return stop;
}

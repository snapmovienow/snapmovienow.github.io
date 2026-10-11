// Media engines are independent of catalog, account and panel rendering.
// The caller owns authorization, leases and selection; every asynchronous
// boundary must validate that the same playback attempt is still authorized.
(function(root){
 let hlsLoading;
 function loadHls(){
  return hlsLoading ||= new Promise((resolve,reject)=>{
   if(root.Hls)return resolve(root.Hls);
   const script=root.document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js';
   script.crossOrigin='anonymous';
   script.integrity='sha384-iZBI1/lW9u8FcBjxuQ8nPTsU7TXhZNtzkV8H3gQHSTgz+VYQoKWqGlBHqhO84alJ';
   script.onload=()=>resolve(root.Hls);
   script.onerror=()=>{hlsLoading=null;reject(Error('hls_unavailable'))};
   root.document.head.append(script);
  });
 }
 function hlsOptions(type){
  const live=type==='live';
  return {progressive:false,startOnSegmentBoundary:live,maxBufferLength:live?30:12,maxMaxBufferLength:live?60:30,
   backBufferLength:10,liveSyncDurationCount:3,liveMaxLatencyDurationCount:8,
   manifestLoadingTimeOut:12000,manifestLoadingMaxRetry:2,levelLoadingTimeOut:12000,levelLoadingMaxRetry:2,
   fragLoadPolicy:{default:{maxTimeToFirstByteMs:15000,maxLoadTimeMs:live?90000:15000,
    timeoutRetry:{maxNumRetry:2,retryDelayMs:1000,maxRetryDelayMs:4000},
    errorRetry:{maxNumRetry:3,retryDelayMs:1000,maxRetryDelayMs:8000}}}};
 }
 async function playWithTimeout(video,signal){
  let timer,onAbort;
  try{
   if(signal?.aborted)throw Error('playback_superseded');
   await Promise.race([video.play(),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('load_timeout')),20000);
    onAbort=()=>reject(Error('playback_superseded'));
    signal?.addEventListener('abort',onAbort,{once:true});
   })]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort)}
 }
 function create(options){
  const {moviePlayer,hlsPlayer,assertAttempt}=options;
  let engine=null,stopWatchdog=null,revision=0,startController=null;
  function stop(){
   revision++;startController?.abort();startController=null;
   const previousEngine=engine,watchdog=stopWatchdog;engine=null;stopWatchdog=null;
   // One broken engine must not leave the other player or watchdog running.
   for(const close of [()=>watchdog?.(),()=>previousEngine?.destroy(),()=>moviePlayer.pause?.(),
    ()=>{moviePlayer.src=null},()=>hlsPlayer.pause(),()=>hlsPlayer.removeAttribute('src'),()=>hlsPlayer.load()]){
    try{close()}catch{}
   }
   moviePlayer.style.display='none';hlsPlayer.style.display='none';
  }
  async function start({url,resumeAt=0,external=false,type,attempt}){
   const startingRevision=revision;
   const controller=new AbortController(),signal=controller.signal;startController=controller;
   const onCancel=()=>controller.abort();
   attempt.controller.signal.addEventListener('abort',onCancel,{once:true});
   if(attempt.controller.signal.aborted)onCancel();
   const check=()=>{if(startingRevision!==revision||signal.aborted)throw Error('playback_superseded');assertAttempt(attempt)};
   const active=()=>{try{check();return true}catch{return false}};
   try{
   check();
   const video=external?hlsPlayer:moviePlayer;
   if(external){
    options.onPlayer?.(video,attempt);video.style.display='block';
    const Hls=await (options.loadHls||loadHls)();check();
    if(!Hls.isSupported()&&video.canPlayType('application/vnd.apple.mpegurl')){
     options.onDiagnostics?.(null,attempt);video.src=url;await playWithTimeout(video,signal);
    }else{
     if(!Hls.isSupported())throw Error('hls_not_supported');
     const currentEngine=new Hls(hlsOptions(type));engine=currentEngine;
     const events=Hls.Events;let ready=false,recoveries=0;
     currentEngine.on(events.FRAG_LOADED,(_,data)=>{if(active())options.onBytes?.(data.frag?.stats?.loaded??data.stats?.loaded)});
     currentEngine.on(events.ERROR,()=>{if(active())options.onError?.()});
     options.onDiagnostics?.(currentEngine,attempt);
     currentEngine.on(events.ERROR,(_,data)=>{
      if(!ready||!data.fatal||engine!==currentEngine||!active())return;
      if(data.type===Hls.ErrorTypes.NETWORK_ERROR&&recoveries++<2){
       options.onStatus?.('Reconectando la señal…');
       if(type==='live')root.recoverLivePlayback(video,currentEngine,recoveries);else currentEngine.startLoad(-1);
      }else if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&recoveries++<2){currentEngine.recoverMediaError()}
      else options.onFatal?.(type);
     });
     await new Promise((resolve,reject)=>{
      let timer,settled=false;
      const finish=error=>{
       if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',onAbort);
       currentEngine.off(events.MANIFEST_PARSED,onReady);currentEngine.off(events.ERROR,onFailure);
       error?reject(error):resolve();
      };
      const onAbort=()=>finish(Error('playback_superseded'));
      const onReady=()=>{ready=true;finish()};
      const onFailure=(_,data)=>{if(data.fatal)finish(Error('stream_failed'))};
      timer=setTimeout(()=>finish(Error('load_timeout')),20000);
      currentEngine.on(events.MANIFEST_PARSED,onReady);currentEngine.on(events.ERROR,onFailure);
      signal.addEventListener('abort',onAbort,{once:true});
      try{check();currentEngine.loadSource(url);currentEngine.attachMedia(video)}catch(error){finish(error)}
     });
     check();
     currentEngine.on(events.AUDIO_TRACKS_UPDATED,()=>{if(active())options.onTracks?.()});
     currentEngine.on(events.SUBTITLE_TRACKS_UPDATED,()=>{if(active())options.onTracks?.()});
     if(resumeAt>5)video.currentTime=resumeAt;
     await playWithTimeout(video,signal);
    }
   }else{
    await (options.loadMoviePlayer||root.ensureMoviePlayer)();
    await (options.whenMovieDefined||(()=>root.customElements.whenDefined('movi-player')))();check();
    options.onPlayer?.(video,attempt);video.style.display='block';video.onloadedmetadata=null;
    video.setAttribute('startat',String(resumeAt>5?resumeAt:0));video.src=url;
    await playWithTimeout(video,signal);
   }
   check();
   if(type==='live'){
    const currentEngine=engine;
    stopWatchdog=root.watchLivePlayback(video,{
     active,hidden:options.hidden,
     segmentDuration:()=>{const level=currentEngine?.currentLevel>=0?currentEngine.currentLevel:currentEngine?.loadLevel;return currentEngine?.levels?.[level]?.details?.targetduration},
     recover:count=>{if(!active())return;options.onRecovery?.();options.onStatus?.('Recuperando la señal…');root.recoverLivePlayback(video,engine===currentEngine?currentEngine:null,count)},
     fallback:()=>{if(active())options.onFatal?.(type)}
    });
   }
   return video;
   }finally{attempt.controller.signal.removeEventListener('abort',onCancel)}
  }
  return {start,stop,get engine(){return engine}};
 }
 root.SMNPlaybackTransport={create,hlsOptions,loadHls};
})(globalThis);

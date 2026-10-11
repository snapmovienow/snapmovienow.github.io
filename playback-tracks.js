// Track controls read the currently selected transport, without owning its
// playback, session or profile storage.
(function(root){
 function language(track){
  const raw=String(track?.lang||track?.language||track?.label||'').toLowerCase();
  const aliases={spa:'es',eng:'en',por:'pt',fra:'fr',espanol:'es','español':'es',english:'en'};
  return aliases[raw]||(/^[a-z]{2,3}$/.test(raw)?raw:null);
 }
 function label(track,index,prefix){
  const name=track.label||track.language;
  const languages={spa:'Español',es:'Español',eng:'Inglés',en:'Inglés',por:'Portugués',pt:'Portugués',fra:'Francés',fr:'Francés',und:'Idioma no indicado'};
  return (languages[name]||name||prefix)+' · '+(index+1);
 }
 function create({players,nativePlayer,getPlayer,getEngine,getPreferences,onPreference,audioSelect,subtitleSelect,status}){
  let applied={audio:false,subtitle:false};
  const listeners=[];
  function listen(target,event,handler){target?.addEventListener?.(event,handler);listeners.push(()=>target?.removeEventListener?.(event,handler))}
  function remember(name,track,off=false){const value=off?'off':language(track);if(value)onPreference(name,value)}
  function tracks(video,engine){return engine?engine.subtitleTracks:video===nativePlayer?video.textTracks:root.snapSubtitleTracks(video)}
  function apply(){
   const video=getPlayer(),engine=getEngine(),preferences=getPreferences();
   const audio=engine?engine.audioTracks:video.audioTracks,subtitles=tracks(video,engine);
   if(!applied.audio&&audio?.length){
    const index=Array.from(audio).findIndex(track=>language(track)===preferences.audio);
    if(index>=0){applied.audio=true;if(engine)engine.audioTrack=index;else for(let n=0;n<audio.length;n++)audio[n].enabled=n===index}
   }
   if(!applied.subtitle&&subtitles?.length){
    const index=Array.from(subtitles).findIndex(track=>language(track)===preferences.subtitle);
    if(preferences.subtitle==='off'||index>=0){
     applied.subtitle=true;
     if(engine)engine.subtitleTrack=preferences.subtitle==='off'?-1:index;
     else if(video===nativePlayer)for(let n=0;n<subtitles.length;n++)subtitles[n].mode=n===index?'showing':'disabled';
     else video.player?.selectSubtitleTrack?.(index<0?null:subtitles[index].id);
    }
   }
  }
  function sync(){
   apply();
   const video=getPlayer(),engine=getEngine(),audio=engine?engine.audioTracks:video.audioTracks;
   const subtitles=engine?engine.subtitleTracks.map((track,index)=>({...track,id:index,kind:'subtitles',mode:engine.subtitleTrack===index?'showing':'disabled'})):tracks(video,engine);
   audioSelect.replaceChildren();subtitleSelect.replaceChildren();
   if(audio?.length){
    for(let i=0;i<audio.length;i++){const option=new root.Option(label(audio[i],i,'Audio'),String(i));option.selected=engine?engine.audioTrack===i:audio[i].enabled;audioSelect.add(option)}
    audioSelect.disabled=audio.length<2;
   }else{audioSelect.add(new root.Option('Audio del video','default'));audioSelect.disabled=true}
   subtitleSelect.add(new root.Option('Desactivados','off'));let count=0;
   for(let i=0;i<(subtitles?.length||0);i++){
    if(!['subtitles','captions'].includes(subtitles[i].kind))continue;
    const option=new root.Option(label(subtitles[i],count++,'Subtítulos'),String(i));option.selected=subtitles[i].mode==='showing';subtitleSelect.add(option);
   }
   subtitleSelect.disabled=count===0;
   status.textContent=!video.currentSrc?'Reproduce el video para detectar idiomas y subtítulos.':[
    !audio?'Este navegador no expone pistas de audio para cambiar de idioma.':audio.length<2?'Este archivo contiene un solo audio.':audio.length+' pistas de audio disponibles.',
    count===0?'Este archivo no contiene subtítulos.':count+' pistas de subtítulos disponibles.'
   ].join(' ');
  }
  listen(audioSelect,'change',()=>{
   applied.audio=true;const video=getPlayer(),engine=getEngine(),audio=engine?engine.audioTracks:video.audioTracks;
   remember('audio',audio?.[Number(audioSelect.value)]);
   if(engine)engine.audioTrack=Number(audioSelect.value);else if(audio)for(let i=0;i<audio.length;i++)audio[i].enabled=String(i)===audioSelect.value;
  });
  listen(subtitleSelect,'change',async()=>{
   applied.subtitle=true;const video=getPlayer(),engine=getEngine(),subtitles=tracks(video,engine);
   remember('subtitle',subtitles?.[Number(subtitleSelect.value)],subtitleSelect.value==='off');
   if(engine){engine.subtitleTrack=subtitleSelect.value==='off'?-1:Number(subtitleSelect.value);sync();return}
   if(video===nativePlayer){for(let i=0;i<video.textTracks.length;i++)video.textTracks[i].mode=subtitleSelect.value===String(i)?'showing':'disabled';sync();return}
   try{const id=subtitleSelect.value==='off'?null:subtitles[Number(subtitleSelect.value)]?.id;if(!await video.player.selectSubtitleTrack(id))throw Error('subtitle');sync()}
   catch{if(getPlayer()===video)status.textContent='No se pudo activar esta pista de subtítulos.'}
  });
  for(const video of players){
   const syncSelected=()=>{if(getPlayer()===video)sync()};
   for(const event of ['loadedmetadata','loadeddata','emptied','loadstart','trackschange','audiotrackchange','subtitletrackchange'])listen(video,event,syncSelected);
   for(const list of [video.audioTracks,video.textTracks])for(const event of ['addtrack','removetrack','change'])listen(list,event,syncSelected);
  }
  return {sync,reset(){applied={audio:false,subtitle:false}},destroy(){for(const remove of listeners)remove()}};
 }
 root.SMNPlaybackTracks={create};
})(globalThis);

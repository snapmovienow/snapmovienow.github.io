const API=globalThis.SMNConfig?.api||"https://api.snaptvnow.com";let allMovies=[],allSeries=[],allLive=[],permissions={movies:true,series:true,tv:true},authenticated=false,authGeneration=0;
let ppvCategories=new Set();
const sessionStorageSource=()=>globalThis.localStorage;let pendingLogout=null;
let creds=SMNSessionClient.read(sessionStorageSource,{cookieMode:globalThis.SMNConfig?.cookieMode===true});const loginModal=document.getElementById("login");document.getElementById("loginBtn").addEventListener("click",()=>loginModal.classList.add("open"));document.getElementById("heroLogin").addEventListener("click",()=>loginModal.classList.add("open"));document.getElementById("closeLoginBtn").addEventListener("click",()=>loginModal.classList.remove("open"));
function menu(){document.getElementById("drawer").classList.toggle("open")} function closeLogin(){document.getElementById("login").classList.remove("open");if(location.hash==="#login")history.replaceState(null,"",location.pathname+location.search)}
const boundedTsUI=globalThis.SMNBoundedTS?.init({document,getSession:()=>creds,getAuthenticated:()=>authenticated,config:globalThis.SMNConfig});
const api=SMNSessionClient.transport({url:API,cookieMode:globalThis.SMNConfig?.cookieMode===true,getSession:()=>creds,getGeneration:()=>authGeneration,request:(...args)=>SMNConnection.requestJSON(...args)});
function showSessionNotice(message='',retryClose=false){
 const node=document.getElementById('sessionNotice');if(!node)return;
 node.textContent=message;node.hidden=!message;
 if(retryClose){const button=document.createElement('button');button.type='button';button.textContent='Reintentar cierre';button.addEventListener('click',()=>{void logout()});node.append(' ',button)}
}
async function revokeSession(session){
 if(!session?.access_token)return true;
 const cookie=session.access_token==='cookie';
 try{const response=await fetch(API,{method:'POST',credentials:cookie?'include':'omit',headers:{'content-type':'application/json'},body:JSON.stringify({op:'logout',access_token:cookie?undefined:session.access_token}),signal:AbortSignal.timeout(10000),keepalive:true});const result=await response.json();return response.ok&&result?.ok===true||response.status===401&&result?.error==='session_required'}
 catch{return false}
}
async function activateSession(info,nextSession,generation){
 const persistenceStarted=performance.now();
 const persisted=await SMNSessionClient.persist(sessionStorageSource,nextSession,{cookieMode:globalThis.SMNConfig?.cookieMode===true,revokePrevious:revokeSession});
 if(generation!==authGeneration||creds!==nextSession)return;
 loadUserFavorites();permissions=info.permissions||{movies:true,series:true,tv:true};authenticated=true;pendingLogout=null;
 armSessionExpiry({...info,network_age_ms:Number(info.network_age_ms||0)+Math.max(0,performance.now()-persistenceStarted)});
 document.body.classList.add('authenticated');document.getElementById('login').classList.remove('open');
 document.getElementById('loginBtn').classList.add('hidden');document.getElementById('heroLogin').classList.add('hidden');
 showSessionNotice(persisted?'':'Sesión temporal: no pudimos guardar tu acceso en este navegador. Podrás seguir usándolo; al recargar podrías tener que iniciar sesión nuevamente.');
 document.getElementById('welcome').textContent='Catálogo conectado. Cargando contenido…';
 const partial=await loadCatalog();if(generation!==authGeneration||!authenticated||creds!==nextSession)return;
 document.getElementById('welcome').textContent=partial?'Parte del catálogo no está disponible. Puedes usar el contenido cargado y volver a intentar más tarde.':'Películas, series y TV disponibles para tu cuenta.';
}
function loginFailure(error){
 if(error?.message==='previous_session_unconfirmed')return 'No pudimos cerrar el acceso anterior en este navegador. Intenta nuevamente antes de cambiar de cuenta.';
 return SMNConnection.message(error,error?.message==='auth'?'No se pudo iniciar sesión. Verifica tus datos.':'No se pudo completar el acceso. Intenta nuevamente.');
}
async function doLogin(){
 const u=document.getElementById('user'),p=document.getElementById('pass'),m=document.getElementById('msg'),btn=document.getElementById('submit');
 const username=u.value.trim(),password=p.value;
 if(pendingLogout){m.textContent='Reintenta el cierre pendiente antes de iniciar otra sesión.';return}
 if(!username||!password){m.textContent='Escribe usuario y contraseña.';return}
 const loginGeneration=++authGeneration;profileSync?.stop();creds={username,password};btn.disabled=true;btn.textContent='Conectando…';m.textContent='';showSessionNotice();
 try{
  const info=await api('auth');if(!info?.user_info||String(info.user_info.auth)!=='1')throw Error('auth');
  const nextSession={username:info.user_info.username||creds.username,access_token:globalThis.SMNConfig?.cookieMode?'cookie':info.access_token};
  creds=nextSession;p.value='';await activateSession(info,nextSession,loginGeneration);
 }catch(error){
  if(loginGeneration!==authGeneration)return;
  sessionExpiry.cancel();SMNSessionClient.clear(sessionStorageSource);creds=null;authenticated=false;showSessionNotice();
  document.body.classList.remove('authenticated');document.getElementById('content').hidden=true;m.textContent=loginFailure(error);
 }finally{if(loginGeneration===authGeneration){btn.disabled=false;btn.textContent='Entrar'}}
}
async function loadCatalog(){
 const loadingSession=creds;
 const catalog=await SMNCatalog.load({api,permissions});if(!authenticated||creds!==loadingSession)return;document.getElementById('content').hidden=false;
 const {movies:m,series:s,live:channels,categories,externalMovies:extra,externalSeries:extraSeries}=catalog;allMovies=[...m,...extra];allSeries=[...s,...extraSeries];allLive=channels;
 for(const [id,enabled]of [['movies',permissions.movies],['recent',permissions.movies],['gnulaSection',permissions.movies&&extra.length],['series',permissions.series],['gnulaSeriesSection',permissions.series&&extraSeries.length],['live',permissions.tv]])document.getElementById(id).hidden=!enabled;
 for(const link of document.querySelectorAll('a[href="#movies"],a[href="#series"],a[href="#live"]'))link.hidden=!permissions[link.hash==='#movies'?'movies':link.hash==='#series'?'series':'tv'];
 render(document.getElementById('movieRow'),m,'stream_icon','name');render(document.getElementById('recentRow'),Array.isArray(m)?m.slice(0,80):[],'stream_icon','name');render(document.getElementById('seriesRow'),allSeries,'cover','name');render(document.getElementById('gnulaRow'),extra,'stream_icon','name');render(document.getElementById('gnulaSeriesRow'),extraSeries,'cover','name');
 for(const [id,count]of [['movieStatus',m.length],['recentStatus',Math.min(m.length,80)],['seriesStatus',allSeries.length],['gnulaStatus',extra.length],['gnulaSeriesStatus',extraSeries.length]])document.getElementById(id).textContent=count+' títulos';
 const category=document.getElementById('liveCategory');category.replaceChildren(new Option('Todas las categorías',''));
 ppvCategories=new Set(categories.filter(c=>/\bPPV\b/i.test(c.category_name)).map(liveCategoryKey));
 for(const c of categories)category.add(new Option(c.category_name,liveCategoryKey(c)));
 renderLive();renderContinue();startProfileSync();boundedTsUI?.update();return catalog.unavailable.length>0;
}
let liveLimit=100;
function liveCategoryKey(item){return (item._server||'ccf')+':'+item.category_id}
function isPpvEvent(item){return ppvCategories.has(liveCategoryKey(item))}
function renderLive(){const q=normalizeSearch(document.getElementById('liveSearch').value),category=document.getElementById('liveCategory').value;const matches=allLive.filter(c=>(!q||normalizeSearch(c.name).includes(q))&&(!category||liveCategoryKey(c)===category));const grid=document.getElementById('liveGrid');grid.replaceChildren();for(const c of matches.slice(0,liveLimit)){const button=document.createElement('button');button.className='channel';button.type='button';if(c.stream_icon){const img=document.createElement('img');img.src=c.stream_icon;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();button.append(img)}const label=document.createElement('strong');label.textContent=c.name;const badge=document.createElement('small');badge.textContent=isPpvEvent(c)?'EVENTO PPV':'▶ EN VIVO';button.append(label,badge);button.onclick=()=>openDetail(c,'live');button.onkeydown=e=>{const cols=getComputedStyle(grid).gridTemplateColumns.split(' ').length,buttons=[...grid.children],index=buttons.indexOf(button),step={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols}[e.key];if(step){e.preventDefault();buttons[index+step]?.focus()}};grid.append(button)}if(!matches.length)grid.textContent='No hay canales disponibles con este filtro.';document.getElementById('liveStatus').textContent=matches.length+' canales';document.getElementById('liveMore').hidden=matches.length<=liveLimit;
}
for(const id of ['liveSearch','liveCategory'])document.getElementById(id).addEventListener('input',()=>{liveLimit=100;renderLive()});document.getElementById('liveMore').onclick=()=>{liveLimit+=100;renderLive()};
function render(el,items,imgKey,nameKey){el.innerHTML="";const type=(["seriesRow","gnulaSeriesRow"].includes(el.id))?"series":"movie";(Array.isArray(items)?items.slice(0,80):[]).forEach(x=>{const d=document.createElement("div");d.className="card";d.tabIndex=0;d.addEventListener("click",()=>openDetail(x,type));const pic=x[imgKey]||x.stream_icon||x.cover||x.movie_image||x.info?.movie_image;if(pic)d.style.backgroundImage='url("'+String(pic).replace(/"/g,"")+'")';const b=document.createElement("b");b.textContent=x[nameKey]||"Sin título";d.appendChild(b);addSourceBadge(d,x);el.appendChild(d)});if(!el.children.length)el.innerHTML='<div class="card"><b>No hay contenido disponible</b></div>'}
async function logout(reason){
 const generation=++authGeneration;sessionExpiry.cancel();
 if(reason){try{globalThis.sessionStorage.setItem('smn_access_notice',reason)}catch{}}
 const session=creds?.access_token?creds:pendingLogout||SMNSessionClient.read(sessionStorageSource,{cookieMode:globalThis.SMNConfig?.cookieMode===true})||(globalThis.SMNConfig?.cookieMode?{access_token:'cookie'}:null);
 pendingLogout=session;saveContinue();stopPlayback();profileSync?.flush();profileSync?.stop();profileSync=null;favorites=[];profilePreferences={};resetLiveDiagnostics();
 authenticated=false;creds=null;allMovies=[];allSeries=[];allLive=[];ppvCategories.clear();currentPlay=null;
 const cleared=SMNSessionClient.clear(sessionStorageSource);showSessionNotice();document.getElementById('content').hidden=true;
 for(const id of ['detail','favoritesPanel','searchPanel','drawer'])document.getElementById(id).classList.remove('open');
 for(const id of ['movieRow','seriesRow','recentRow','gnulaRow','gnulaSeriesRow','continueRow','liveGrid','favoritesResults','searchResults'])document.getElementById(id).replaceChildren();
 document.body.classList.remove('authenticated');document.getElementById('loginBtn').classList.remove('hidden');document.getElementById('heroLogin').classList.remove('hidden');
 document.getElementById('submit').disabled=false;document.getElementById('submit').textContent='Entrar';document.getElementById('welcome').textContent=reason||'Has cerrado sesión.';
 const revoked=await revokeSession(session);if(generation!==authGeneration)return;
 if(cleared||revoked){pendingLogout=null;location.href=location.pathname;return}
 showSessionNotice('El acceso está cerrado en esta pestaña, pero no pudimos confirmar el cierre completo. Reintenta antes de recargar.',true);
}
const searchPanel=document.getElementById("searchPanel"),searchInput=document.getElementById("searchInput"),searchResults=document.getElementById("searchResults"),searchMeta=document.getElementById("searchMeta");document.getElementById("searchBtn").addEventListener("click",()=>{searchPanel.classList.add("open");setTimeout(()=>searchInput.focus(),50)});document.getElementById("searchClose").addEventListener("click",()=>{searchPanel.classList.remove("open");searchInput.value="";searchResults.innerHTML="";searchMeta.textContent="Escribe para buscar en películas, series y TV."});function normalizeSearch(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es").replace(/\bbarman\b/g,"batman").replace(/\b(v|vs|versus)\b/g," ").replace(/[^a-z0-9]+/g," ").trim()}
function sourceName(x){if(x.exclusive)return "Exclusivo de SNAPTV";return x.source==="gnula"?"Gnula":x._server&&x._server!=="ccf"?"Servidor conectado":"CCF"}
function addSourceBadge(card,x){const label=document.createElement("span");label.className="source-badge";label.textContent=sourceName(x);card.appendChild(label)}
searchInput.addEventListener("input",()=>{
const query=searchInput.value.trim();
const movieId=/^id:\s*(\d{1,16})$/i.exec(query)?.[1];
const q=normalizeSearch(query);
searchResults.innerHTML="";if(!q){searchMeta.textContent="Escribe para buscar en películas, series y TV.";return}const hits=[...allMovies.map(x=>({...x,_type:"Película",_img:x.stream_icon||x.cover||x.movie_image||x.info?.movie_image})),...allSeries.map(x=>({...x,_type:"Serie",_img:x.cover||x.stream_icon})),...allLive.map(x=>({...x,_type:"TV",_img:x.stream_icon}))].filter(x=>{
if(movieId)return x._type==="Película"&&String(x.stream_id??x.id)===movieId;
const title=normalizeSearch(x.name);
return q.split(/\s+/).every(word=>title.includes(word));
}).slice(0,120);
searchMeta.textContent=hits.length+(hits.length===120?"+":"")+" resultados";hits.forEach(x=>{const d=document.createElement("div");d.className="card";d.addEventListener("click",()=>openDetail(x,x._type==="Serie"?"series":x._type==="TV"?"live":"movie"));if(x._img)d.style.backgroundImage='url("'+String(x._img).replace(/"/g,"")+'")';const b=document.createElement("b");b.textContent=(x.name||"Sin título")+" · "+x._type+" · "+sourceName(x);d.appendChild(b);addSourceBadge(d,x);searchResults.appendChild(d)});if(!hits.length)searchResults.innerHTML="<p>No se encontraron resultados.</p>"});
function catalogItemAllowed(item,type){
 if(!permissions[type==='live'?'tv':type==='series'?'series':'movies'])return false;
 if(permissions.adults!==false)return true;
 const rows=type==='live'?allLive:type==='series'?allSeries:allMovies;
 return rows.some(row=>favKey(row,type)===favKey(item,type));
}
// Non-sensitive profile data only; authentication storage keeps its existing policy.
const profileStorage=(()=>{
 const pending=new Map();
 return {
  getItem(key){if(pending.has(key))return pending.get(key);try{return localStorage.getItem(key)}catch{return null}},
  setItem(key,value){const text=String(value);try{localStorage.setItem(key,text);pending.delete(key)}catch{pending.set(key,text)}},
  removeItem(key){try{localStorage.removeItem(key);pending.delete(key)}catch{pending.set(key,null)}}
 };
})();
let favorites=[],profileSync=null,profilePreferences={};
function userStorageKey(kind){return "smn_"+kind+"_"+encodeURIComponent(creds?.username||"")}
function loadUserFavorites(){let stored=profileStorage.getItem(userStorageKey("favorites"));if(stored===null&&creds?.username){try{if(localStorage.getItem("smn_legacy_owner")===creds.username){stored=localStorage.getItem("smn_favorites");if(stored){localStorage.setItem(userStorageKey("favorites"),stored);localStorage.removeItem("smn_favorites")}}}catch{/* Keep legacy data when persistence is unavailable. */}}try{const list=JSON.parse(stored||"[]");favorites=Array.isArray(list)?list.filter(f=>f&&typeof f==="object"&&typeof f.key==="string"&&["movie","series","live"].includes(f.type)&&f.item&&typeof f.item==="object"&&!Array.isArray(f.item)):[]}catch{favorites=[]}}
function progressKey(p){if(!p)return "";const x=p.item;return userStorageKey("progress")+"_"+p.type+"_"+(x._server||x.source||"ccf")+"_"+(p.episodeId||x.stream_id||x.series_id||x.id||x.name)}
function savedProgress(p){const n=Number(profileStorage.getItem(progressKey(p))||0);return Number.isFinite(n)?n:0}
function updatePlayLabel(){const b=document.getElementById("playBtn");if(!authenticated||!currentPlay||currentPlay.type==="series")return;if(currentPlay.type==="live"){b.textContent=isPpvEvent(currentPlay.item)?"▶ Ver evento":"▶ Ver en vivo";return}const t=savedProgress(currentPlay);b.textContent=t>30?"▶ Continuar":"▶ Reproducir"}
let lastProgressSave=0;
function currentProgressPlayer(video){if(video!==player||!video.currentSrc)return false;const attempt=playbackLifecycle.current;if(!attempt)return false;try{assertPlaybackAttempt(attempt);return true}catch{return false}}
function persistCurrentProgress(){if(!currentProgressPlayer(player))return;saveContinue();if(currentPlay&&player.currentTime>0)profileStorage.setItem(progressKey(currentPlay),String(Math.floor(player.currentTime)))}
let currentPlay=null;const detail=document.getElementById("detail"),moviePlayer=document.getElementById("player"),gnulaPlayer=document.getElementById("gnulaPlayer");let player=moviePlayer;document.getElementById("detailClose").addEventListener("click",()=>{stopPlayback();resetLiveDiagnostics();player.style.display="none";detail.classList.remove("open");updatePlayLabel()});function favKey(x,type){return type+":"+(x._server||x.source||"ccf")+":"+(x.stream_id||x.series_id||x.name)}function isFav(x,type){return favorites.some(f=>f.key===favKey(x,type))}function saveFav(){profileStorage.setItem(userStorageKey("favorites"),JSON.stringify(favorites));profileSync?.favorites(favorites.map(f=>profileReference(f.item,f.type)).filter(Boolean))}function renderFavorites(){const box=document.getElementById("favoritesResults");box.innerHTML="";const visible=favorites.filter(f=>catalogItemAllowed(f.item,f.type));visible.forEach(f=>{const d=document.createElement("div");d.className="card";if(f.img)d.style.backgroundImage='url("'+String(f.img).replace(/"/g,"")+'")';const b=document.createElement("b");b.textContent=f.item.name||"Sin título";d.appendChild(b);d.addEventListener("click",()=>{document.getElementById("favoritesPanel").classList.remove("open");openDetail(f.item,f.type)});box.appendChild(d)});if(!visible.length)box.innerHTML="<p>Aún no tienes películas o series favoritas.</p>"}document.getElementById("favoritesMenu").addEventListener("click",e=>{e.preventDefault();if(!authenticated){loginModal.classList.add("open");return}menu();renderFavorites();document.getElementById("favoritesPanel").classList.add("open")});document.getElementById("favoritesClose").addEventListener("click",()=>document.getElementById("favoritesPanel").classList.remove("open"));document.getElementById("heartBtn").addEventListener("click",()=>{if(!currentPlay)return;const {item,type}=currentPlay,key=favKey(currentPlay.item,currentPlay.type);const i=favorites.findIndex(f=>f.key===key);if(i>=0)favorites.splice(i,1);else if(favorites.length<100)favorites.push({key,type,item,updatedAt:Date.now(),img:item.stream_icon||item.cover||item.movie_image||item.info?.movie_image||""});saveFav();document.getElementById("heartBtn").textContent=isFav(item,type)?"♥":"♡";document.getElementById("heartBtn").classList.toggle("active",isFav(item,type))});async function openDetail(x,type,resumeEpisode=null){if(!authenticated){loginModal.classList.add("open");return}if(!catalogItemAllowed(x,type))return;stopPlayback();resetLiveDiagnostics(type);player.style.display="none";document.getElementById("playBtn").disabled=false;detail.classList.add("open");document.getElementById("detailTitle").textContent=x.name||"Sin título";const pic=x.stream_icon||x.cover||x.movie_image||x.info?.movie_image;document.getElementById("detailHero").style.backgroundImage=pic?'url("'+String(pic).replace(/"/g,"")+'")':"";document.getElementById("detailMeta").textContent=type==="series"?"Serie":"Película";document.getElementById("detailPlot").textContent=x.plot||x.info?.plot||"Cargando información…";document.getElementById("detailEpisodes").innerHTML="";document.getElementById("playBtn").style.display=type!=="series"?"inline-block":"none";currentPlay={type,item:x};if(type==="live"){const ppv=isPpvEvent(x);document.getElementById("detailMeta").textContent=(ppv?"Evento PPV":"TV en vivo")+" · "+sourceName(x);document.getElementById("detailPlot").textContent=ppv?"La señal está disponible durante la ventana de transmisión del evento.":"Señal en directo";loadChannelGuide(x,currentPlay);document.getElementById("playBtn").disabled=false;document.getElementById("playerStatus").textContent="";document.getElementById("playBtn").click();return}const hb=document.getElementById("heartBtn");hb.textContent=isFav(x,type)?"♥":"♡";hb.classList.toggle("active",isFav(x,type));updatePlayLabel();if(x.source==="gnula"&&type==="movie"){document.getElementById("detailMeta").textContent=[x.exclusive?"Película · Exclusivo de SNAPTV":"Película · Gnula",x.year].filter(Boolean).join(" · ");document.getElementById("detailPlot").textContent=x.plot||"";return}const infoSelection=currentPlay,infoSession=creds;const infoCurrent=()=>authenticated&&creds===infoSession&&currentPlay===infoSelection&&detail.classList.contains("open");try{const info=await api(type==="series"?(x.source==="gnula"?"gnula_series_info":"series_info"):"vod_info",type==="series"?{series_id:x.series_id,server:x._server}:{vod_id:x.stream_id,server:x._server});if(!infoCurrent())return;const inf=info.info||info.movie_data||{};document.getElementById("detailPlot").textContent=inf.plot||inf.description||x.plot||"Información no disponible.";document.getElementById("detailMeta").textContent=[(type==="series"?"Serie":"Película")+" · "+sourceName(x),inf.releaseDate||inf.releasedate||inf.year,inf.genre,inf.rating].filter(Boolean).join(" · ");if(type==="series"&&info.episodes){const box=document.getElementById("detailEpisodes");Object.entries(info.episodes).forEach(([season,eps])=>{const h=document.createElement("h3");h.textContent="Temporada "+season;box.appendChild(h);(Array.isArray(eps)?eps:[]).forEach(ep=>{const b=document.createElement("button");b.className="episode";b.dataset.episodeId=String(ep.id);b.textContent=(ep.title||("Episodio "+(ep.episode_num||"")));b.addEventListener("click",async()=>{const selection=currentPlay;stopPlayback();const attempt=playbackLifecycle.begin({selection,session:creds});try{const r=await api(x.source==="gnula"?"gnula_token":"stream_token",{type:"series",server:x._server,series_id:x.series_id,id:ep.id,ext:ep.container_extension||"mp4",request_id:attempt.id,revision:attempt.revision});if(!playbackLifecycle.adopt(attempt,r.lease_id))return;assertPlaybackAttempt(attempt);if(!r.url)throw new Error("stream");currentPlay.episodeId=String(ep.id);currentPlay.episodeTitle=ep.title||("Episodio "+(ep.episode_num||""));await startPlayback(r.url,savedProgress(currentPlay),r.lease_id,attempt)}catch(e){if(playbackLifecycle.valid(attempt)){stopPlayback();document.getElementById("playerStatus").textContent=playbackError(e)}}});box.appendChild(b)})});if(resumeEpisode){const button=Array.from(box.querySelectorAll("button.episode")).find(b=>b.dataset.episodeId===String(resumeEpisode));if(button)button.click()}}}catch(e){if(infoCurrent())document.getElementById("detailPlot").textContent=x.plot||"Información no disponible."}}player.addEventListener("timeupdate",event=>{if(!currentProgressPlayer(event.currentTarget))return;if(!currentPlay||!player.currentTime)return;const now=Date.now();if(now-lastProgressSave>5000){profileStorage.setItem(progressKey(currentPlay),String(Math.floor(player.currentTime)));lastProgressSave=now;saveContinue()}});
player.addEventListener("pause",event=>{if(!currentProgressPlayer(event.currentTarget))return;persistCurrentProgress();updatePlayLabel()});
player.addEventListener("loadstart",()=>{document.getElementById("playerStatus").textContent="Cargando video…"});player.addEventListener("playing",()=>{document.getElementById("playerStatus").textContent=""});player.addEventListener("error",()=>{document.getElementById("playerStatus").textContent="No se pudo reproducir este video. Intenta otro título o contacta soporte."});
player.addEventListener("ended",event=>{if(!currentProgressPlayer(event.currentTarget)||!player.ended)return;releasePlayback();removeContinue();if(currentPlay)profileStorage.removeItem(progressKey(currentPlay));updatePlayLabel()});
function liveFamily(name){return String(name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\((?:tv|e)\)/g," ").replace(/\b(?:2160|1080|720|480|360)p?\b|\b(?:4k|uhd|fhd|hd|sd)\b/g,"").replace(/[()\[\]]/g," ").replace(/\s+/g," ").trim()}
function liveAlternatives(x){const family=liveFamily(x.name);return [x,...allLive.filter(c=>String(c.stream_id)!==String(x.stream_id)&&(c._server||"ccf")===(x._server||"ccf")&&liveFamily(c.name)===family).sort((a,b)=>Number(!/720/.test(a.name))-Number(!/720/.test(b.name)))].slice(0,3)}
let liveRequest=0,liveFailures=new Map();
async function playLiveSelection(x){const request=++liveRequest,selection=currentPlay;const candidates=liveAlternatives(x);let lastError;
for(const candidate of candidates){if(request!==liveRequest||currentPlay!==selection||!detail.classList.contains("open"))return;if((liveFailures.get(favKey(candidate,"live"))||0)>Date.now())continue;releasePlayback();stopPlayback(false);document.getElementById("playerStatus").textContent=candidate===x?"Preparando señal…":"Probando otra calidad del mismo canal…";
const attempt=playbackLifecycle.begin({selection,session:creds});let r;try{r=await api("stream_token",{type:"live",server:candidate._server,id:candidate.stream_id,ext:"m3u8",request_id:attempt.id,revision:attempt.revision});if(!playbackLifecycle.adopt(attempt,r.lease_id))return;if(request!==liveRequest||currentPlay!==selection||!detail.classList.contains("open")){await playbackLifecycle.cancel();return}if(!r.url)throw Error("stream_failed");currentPlay.liveActual=candidate;await startPlayback(r.url,0,r.lease_id,attempt);if(request!==liveRequest||currentPlay!==selection)return;document.getElementById("detailMeta").textContent="TV en vivo · "+sourceName(candidate)+" · "+candidate.name;return}catch(e){if(request!==liveRequest||currentPlay!==selection)return;lastError=e;releasePlayback();stopPlayback(false);if(e.message==="session_changed"||e.status===401||e.status===403||e.message==="ccf_capacity")throw e;liveFailures.set(favKey(candidate,"live"),Date.now()+60000)}}throw lastError||Error("live_signal_unavailable")}
document.getElementById("playBtn").addEventListener("click",async()=>{if(!authenticated||!currentPlay||currentPlay.type==="series")return;const selection=currentPlay,x=selection.item;const btn=document.getElementById("playBtn");const clickId=playbackRequestId();btn.dataset.playback=clickId;btn.disabled=true;btn.textContent="Cargando…";let attempt;try{if(selection.type==="live"){await playLiveSelection(x)}else{stopPlayback();attempt=playbackLifecycle.begin({selection,session:creds});const r=await api(x.source==="gnula"?"gnula_token":"stream_token",{type:selection.type,server:x._server,id:x.stream_id,ext:x.container_extension||"mp4",request_id:attempt.id,revision:attempt.revision});if(!playbackLifecycle.adopt(attempt,r.lease_id))return;assertPlaybackAttempt(attempt);if(!r.url)throw Error("stream");await startPlayback(r.url,savedProgress(selection),r.lease_id,attempt)}}catch(e){if(currentPlay===selection&&(!attempt||playbackLifecycle.valid(attempt))&&detail.classList.contains("open")){stopPlayback();document.getElementById("playerStatus").textContent=selection.type==="live"&&isPpvEvent(x)&&e.status===404?"La señal de este evento PPV no está disponible en este momento. Verifica el horario del evento.":playbackError(e)}}finally{if(currentPlay===selection&&btn.dataset.playback===clickId){btn.disabled=false;updatePlayLabel()}}});
let playbackLease=null,heartbeatBusy=false;
function playbackError(e){return SMNConnection.message(e,e.message==="media_not_found"&&e.status===404?"No se encontró la señal solicitada (404). Prueba otra opción o inténtalo más tarde.":e.message==="media_origin_unapproved"?"Este canal usa un servidor de reproducción que todavía no está autorizado.":e.message==="live_signal_unavailable"?"La señal de este canal no está disponible en el servidor.":e.message==="hls_unavailable"?"No se pudo cargar el motor de reproducción.":e.message==="load_timeout"?"El servidor tardó demasiado en entregar la señal.":e.message==="adult_content_disabled"?"El contenido para adultos está desactivado para tu cuenta.":e.message==="content_disabled"?"Este contenido está deshabilitado para tu cuenta.":e.message==="ccf_capacity"?"No hay conexiones CCF disponibles. Intenta cuando termine otra reproducción.":e.message==="provider_not_configured"?"El administrador debe conectar el panel CCF o una cuenta de servicio.":e.message==="provider_inactive"?"La cuenta CCF de servicio no está activa.":"No se pudo preparar el video. Intenta nuevamente o contacta soporte.")}
const playbackLifecycle=createPlaybackLifecycle({cancel:(attempt,lease)=>sendPlaybackCancellation(API,attempt,lease)});
function assertPlaybackAttempt(attempt){if(!authenticated||!playbackLifecycle.valid(attempt)||currentPlay!==attempt.selection||creds!==attempt.session||!detail.classList.contains("open"))throw Error("playback_superseded")}
function releasePlayback(){playbackLease=null;return playbackLifecycle.cancel()}
setInterval(async()=>{if(!authenticated||heartbeatBusy)return;const attempt=playbackLifecycle.current,lease=playbackLease,session=creds;heartbeatBusy=true;try{await api("playback_heartbeat",{lease_id:lease,request_id:attempt?.id})}catch(e){if(creds===session&&playbackLease===lease&&playbackLifecycle.current===attempt&&(e.status===401||e.status===410)){stopPlayback();document.getElementById("playerStatus").textContent="Tu acceso o reproducción ha finalizado. Inicia sesión nuevamente.";if(e.status===401)logout();}}finally{heartbeatBusy=false}},25000);
window.addEventListener("pagehide",()=>{saveContinue();profileSync?.flush();stopPlayback();document.getElementById("playBtn").disabled=false;updatePlayLabel()});
let liveDiagnostics=null, liveDiagnosticHistory=[],playbackMetrics=null;
function beginPlaybackMetrics(video,attempt){if(typeof createPlaybackMetrics!=="function")return;const selection=attempt.selection,x=selection.liveActual||selection.item,session=creds;playbackMetrics=createPlaybackMetrics(video,{type:selection.type,quality:String(x.name||"").match(/\b(1080|720)\b/)?.[1]||"other",server:x._server||x.source||"ccf",send:metric=>creds===session&&authenticated?api("playback_metric",{metric,lease_id:attempt.lease,request_id:attempt.id,observation:{width:Number(video.videoWidth)||0,height:Number(video.videoHeight)||0}}):Promise.resolve()})}
function resetLiveDiagnostics(type){liveDiagnosticHistory=[];document.getElementById("liveDiagnosticPanel").hidden=type!=="live";document.getElementById("liveDiagnosticText").hidden=true;document.getElementById("liveDiagnosticText").value="";document.getElementById("liveDiagnosticStatus").textContent="Si la señal se queda cargando, copia el diagnóstico y pégalo en el chat."}
function startLiveDiagnostics(engine,attempt){
 if(currentPlay?.type!=="live")return;
 const quality=String(currentPlay.liveActual?.name||currentPlay.item.name||"").match(/\b(1080|720)\b/)?.[1];
 try{liveDiagnostics=createLiveDiagnostics(gnulaPlayer,{engine,events:Hls.Events,errorTypes:Hls.ErrorTypes,errorDetails:Hls.ErrorDetails,quality,active:()=>authenticated&&playbackLifecycle.valid(attempt)&&currentPlay===attempt.selection,hidden:()=>document.hidden});}catch{liveDiagnostics=null}
}
async function copyLiveDiagnostic(){
 const reports=[...liveDiagnosticHistory,...(liveDiagnostics?[liveDiagnostics.report()]:[])].slice(-3);
 const status=document.getElementById("liveDiagnosticStatus"),box=document.getElementById("liveDiagnosticText");
 if(!reports.length){status.textContent="Primero reproduce un canal para registrar el diagnóstico.";return}
 const text=JSON.stringify({format:"SNAP-live-diagnostic",webVersion:"43",hlsVersion:window.Hls?.version||null,reports});
 try{await navigator.clipboard.writeText(text);box.hidden=true;status.textContent="Diagnóstico copiado. Pégalo en el chat."}catch{box.value=text;box.hidden=false;box.focus();box.select();status.textContent="Mantén pulsado el texto, cópialo y pégalo en el chat."}
}
document.getElementById("copyLiveDiagnostic").addEventListener("click",copyLiveDiagnostic);
function stopPlayback(invalidate=true){
 try{persistCurrentProgress()}catch{}
 playbackMetrics?.stop();playbackMetrics=null;
 if(invalidate){liveRequest++;releasePlayback()}
 const diagnostic=liveDiagnostics;liveDiagnostics=null;
 if(diagnostic){try{liveDiagnosticHistory.push(diagnostic.report());liveDiagnosticHistory=liveDiagnosticHistory.slice(-2)}catch{}}
 try{diagnostic?.stop()}catch{}
 mediaTransport.stop();
}
function retryLivePlayback(){
 if(!currentPlay||currentPlay.type!=="live")return;
 liveFailures.set(favKey(currentPlay.liveActual||currentPlay.item,"live"),Date.now()+60000);
 stopPlayback();document.getElementById("playBtn").disabled=false;document.getElementById("playBtn").click();
}
const mediaTransport=SMNPlaybackTransport.create({
 moviePlayer,hlsPlayer:gnulaPlayer,assertAttempt:assertPlaybackAttempt,
 onPlayer:(video,attempt)=>{player=video;beginPlaybackMetrics(video,attempt)},
 onDiagnostics:startLiveDiagnostics,onBytes:bytes=>playbackMetrics?.addBytes(bytes),onError:()=>playbackMetrics?.error(),
 onTracks:()=>syncTrackControls(),hidden:()=>document.hidden,
 onStatus:text=>{document.getElementById("playerStatus").textContent=text},
 onRecovery:()=>liveDiagnostics?.capture("watchdog_recovery"),
 onFatal:type=>{if(type==="live")retryLivePlayback();else{stopPlayback();document.getElementById("playerStatus").textContent="La señal no está disponible. Vuelve a intentar."}}
});
const trackControls=SMNPlaybackTracks.create({
 players:[moviePlayer,gnulaPlayer],nativePlayer:gnulaPlayer,getPlayer:()=>player,getEngine:()=>mediaTransport.engine,
 getPreferences:()=>profilePreferences,onPreference:(name,value)=>{profilePreferences[name]=value;profileSync?.preference(name,value)},
 audioSelect:document.getElementById("audioSelect"),subtitleSelect:document.getElementById("subtitleSelect"),status:document.getElementById("trackStatus")
});
function syncTrackControls(){trackControls.sync()}
async function startPlayback(url,resumeAt=0,leaseId=null,attempt){
 assertPlaybackAttempt(attempt);stopPlayback(false);playbackLease=leaseId;currentPlay.completed=false;trackControls.reset();
 await mediaTransport.start({url,resumeAt,external:currentPlay.item.source==="gnula"||currentPlay.type==="live",type:currentPlay.type,attempt});
 assertPlaybackAttempt(attempt);syncTrackControls();player.scrollIntoView({behavior:"smooth",block:"center"});
}
gnulaPlayer.addEventListener("playing",event=>{if(!currentProgressPlayer(event.currentTarget))return;document.getElementById("playerStatus").textContent="";saveContinue()});
gnulaPlayer.addEventListener("timeupdate",event=>{if(!currentProgressPlayer(event.currentTarget))return;if(currentPlay&&gnulaPlayer.currentTime>0){const now=Date.now();if(now-lastProgressSave>5000){profileStorage.setItem(progressKey(currentPlay),String(Math.floor(gnulaPlayer.currentTime)));lastProgressSave=now;saveContinue()}}});
gnulaPlayer.addEventListener("pause",event=>{if(!currentProgressPlayer(event.currentTarget))return;persistCurrentProgress()});
gnulaPlayer.addEventListener("ended",event=>{if(!currentProgressPlayer(event.currentTarget)||!gnulaPlayer.ended)return;removeContinue();if(currentPlay)profileStorage.removeItem(progressKey(currentPlay))});
player.addEventListener("errordisplay",()=>{document.getElementById("playerStatus").textContent="Este dispositivo no pudo reproducir el formato del archivo."});

function continueStorageKey(){return "smn_continue_"+encodeURIComponent(creds?.username||"")}
function continueIdentity(p){return p.type+":"+(p.item._server||p.item.source||"ccf")+":"+(p.item.stream_id||p.item.series_id||p.item.id||p.item.name)}
function readContinue(){try{const list=JSON.parse(profileStorage.getItem(continueStorageKey())||"[]");return Array.isArray(list)?list.filter(x=>x&&x.item&&typeof x.item==="object"&&!Array.isArray(x.item)&&["movie","series"].includes(x.type)).slice(0,8):[]}catch{return []}}
function saveContinue(){
if(!creds||!currentPlay||currentPlay.type==="live"||currentPlay.completed||!player.currentSrc)return;
const time=Number(player.currentTime)||0;if(time<1)return;
const p=currentPlay,key=continueIdentity(p),x=p.item;
const item={source:x.source,_server:x._server,exclusive:x.exclusive,_adult:x._adult,name:x.name,stream_id:x.stream_id,series_id:x.series_id,id:x.id,container_extension:x.container_extension,stream_icon:x.stream_icon,cover:x.cover,movie_image:x.movie_image,plot:x.plot,year:x.year};
const entry={key,type:p.type,item,episodeId:p.episodeId,episodeTitle:p.episodeTitle,time,duration:Number.isFinite(player.duration)?player.duration:0,updatedAt:Date.now()};
try{profileStorage.setItem(continueStorageKey(),JSON.stringify([entry,...readContinue().filter(x=>x.key!==key)].slice(0,8)))}catch{}
const reference=profileReference(x,p.type);if(reference)profileSync?.progress({...reference,time:entry.time,duration:Math.min(172800,entry.duration),episodeId:p.episodeId});
renderContinue();
}
function removeContinue(){if(!currentPlay||currentPlay.type==="live"||!creds)return;currentPlay.completed=true;profileSync?.removeProgress(continueIdentity(currentPlay));try{profileStorage.setItem(continueStorageKey(),JSON.stringify(readContinue().filter(x=>x.key!==continueIdentity(currentPlay))))}catch{}renderContinue()}
function renderContinue(){
const section=document.getElementById("continueSection"),row=document.getElementById("continueRow"),list=authenticated?readContinue().filter(e=>catalogItemAllowed(e.item,e.type)):[];row.replaceChildren();section.hidden=!list.length;
document.getElementById("continueStatus").textContent=list.length+" / 8";
for(const entry of list){const card=document.createElement("button");card.type="button";card.className="card continue-card";card.style.color="#fff";card.style.font="inherit";card.style.textAlign="left";
const pic=entry.item.stream_icon||entry.item.cover||entry.item.movie_image;if(pic)card.style.backgroundImage='url("'+String(pic).replace(/"/g,"")+'")';
const info=document.createElement("div");info.className="continue-info";const title=document.createElement("b");title.textContent=entry.item.name||"Sin título";info.append(title);
const label=document.createElement("small");label.textContent=(entry.episodeTitle?entry.episodeTitle+" · ":"")+"Continuar · "+Math.floor(entry.time/60)+":"+String(Math.floor(entry.time%60)).padStart(2,"0");info.append(label);
const bar=document.createElement("div");bar.className="continue-progress";const fill=document.createElement("span");fill.style.width=(entry.duration>0?Math.min(100,entry.time/entry.duration*100):0)+"%";bar.append(fill);info.append(bar);card.append(info);addSourceBadge(card,entry.item);
card.addEventListener("click",async()=>{if(currentPlay&&player.currentSrc){player.pause();player.src=null;}profileStorage.setItem(progressKey(entry),String(Math.floor(entry.time)));await openDetail(entry.item,entry.type,entry.episodeId);if(entry.type==="movie")document.getElementById("playBtn").click()});row.append(card)}
}
player.addEventListener("playing",saveContinue);

const sessionExpiry=createSessionExpiry({expire:()=>logout("Tu acceso venció. Contacta al administrador para renovar.")});
function armSessionExpiry(info){sessionExpiry.start(Number(info.session_expires_at||Number(info.user_info?.exp_date)*1000),Number(info.server_time||Date.now()),info.network_age_ms||0);if(!authenticated)throw Error("session_expired")}
for(const event of ["pageshow","focus"])window.addEventListener(event,()=>sessionExpiry.check());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)sessionExpiry.check()});
const accessNotice=(()=>{let notice=null;try{notice=globalThis.sessionStorage.getItem('smn_access_notice')}catch{}try{globalThis.sessionStorage.removeItem('smn_access_notice')}catch{}return notice})();
if(accessNotice){document.getElementById('welcome').textContent=accessNotice;document.getElementById('msg').textContent=accessNotice}
async function restoreSession(){
 if(!creds)return;const restoreGeneration=authGeneration;
 try{
  const info=await api(creds.access_token?'session_info':'auth');if(!info?.user_info||String(info.user_info.auth)!=='1')throw Error('auth');
  const nextSession={username:info.user_info.username||creds.username,access_token:globalThis.SMNConfig?.cookieMode?'cookie':info.access_token||creds.access_token};
  creds=nextSession;await activateSession(info,nextSession,restoreGeneration);
 }catch(error){
  if(restoreGeneration!==authGeneration)return;
  sessionExpiry.cancel();SMNSessionClient.clear(sessionStorageSource);creds=null;authenticated=false;showSessionNotice();
  document.getElementById('content').hidden=true;document.body.classList.remove('authenticated');
  if(error?.message==='previous_session_unconfirmed')document.getElementById('welcome').textContent=loginFailure(error);
 }
}restoreSession();

function profileReference(item,type){const id=String(item.stream_id||item.series_id||item.id||"");if(!/^[a-zA-Z0-9_.:-]+$/.test(id))return null;const server=item._server||item.source||"ccf";return {key:type+":"+server+":"+id,type,id,server}}
function profileCatalog(reference){const rows=reference.type==="live"?allLive:reference.type==="series"?allSeries:allMovies;return rows.find(item=>profileReference(item,reference.type)?.key===reference.key)}
function localProfileRows(){let records=[];try{records=JSON.parse(profileStorage.getItem(userStorageKey("profile"))||"[]")}catch{}records=Array.isArray(records)?records.filter(p=>p&&typeof p==="object"&&!Array.isArray(p)&&typeof p.key==="string"&&["favorite","progress","preference"].includes(p.kind)):[];return [...records,...favorites.map(f=>{const r=profileReference(f.item,f.type);return r?{...r,kind:"favorite",updatedAt:f.updatedAt||1}:null}).filter(r=>r&&!records.some(p=>p.kind===r.kind&&p.key===r.key)),...readContinue().map(e=>{const r=profileReference(e.item,e.type);return r?{...r,kind:"progress",time:e.time,duration:Math.min(172800,e.duration||0),episodeId:e.episodeId,updatedAt:e.updatedAt||1}:null}).filter(r=>r&&!records.some(p=>p.kind===r.kind&&p.key===r.key))]}
function applyProfileRows(rows){
 const previous=readContinue();for(const p of rows)if(p.kind==="progress"&&p.deleted){const entry=previous.find(e=>e.key===p.key);if(entry)profileStorage.removeItem(progressKey(entry))}profileStorage.setItem(userStorageKey("profile"),JSON.stringify(rows));const next=[],history=[];
 for(const p of rows){if(p.deleted)continue;if(p.kind==="preference"){profilePreferences[p.key]=p.value;continue}const item=profileCatalog(p);if(!item||!catalogItemAllowed(item,p.type))continue;
 if(p.kind==="favorite")next.push({key:p.key,type:p.type,item,img:item.stream_icon||item.cover||item.movie_image||"",updatedAt:p.updatedAt});
 if(p.kind==="progress"){const entry={key:p.key,type:p.type,item,episodeId:p.episodeId,time:p.time,duration:p.duration,updatedAt:p.updatedAt};history.push(entry);profileStorage.setItem(progressKey(entry),String(p.time))}
 }
 favorites=next;profileSync?.rememberFavorites(next);profileStorage.setItem(userStorageKey("favorites"),JSON.stringify(next));profileStorage.setItem(continueStorageKey(),JSON.stringify(history.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8)));renderContinue();if(document.getElementById("favoritesPanel").classList.contains("open"))renderFavorites();
}
function startProfileSync(){profileSync?.stop();profilePreferences={};profileSync=SMNProfiles.create({api,local:localProfileRows,onData:applyProfileRows,onPersist:rows=>profileStorage.setItem(userStorageKey("profile"),JSON.stringify(rows))});profileSync.rememberFavorites(favorites);}
window.addEventListener("focus",()=>{if(authenticated)profileSync?.refresh()});
for(const [name,handler]of [["menu",menu],["logout",()=>logout()],["login",doLogin]])for(const button of document.querySelectorAll('[data-action="'+name+'"]'))button.addEventListener("click",handler);
if(creds?.username&&!profileStorage.getItem("smn_legacy_owner"))profileStorage.setItem("smn_legacy_owner",creds.username);

async function loadChannelGuide(item,selection){try{const data=await api("live_epg",{server:item._server,stream_id:item.stream_id});if(currentPlay!==selection||!detail.classList.contains("open"))return;const lines=SMNGuide.lines(data);if(!lines.length&&isPpvEvent(item))return;document.getElementById("detailPlot").textContent=lines.length?lines.join("\n"):"Señal en directo · Guía no disponible para este canal."}catch{/* A missing guide must never interrupt live playback. */}}



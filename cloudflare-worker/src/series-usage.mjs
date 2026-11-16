// The caller supplies its authenticated, immutable account ID. This reader never
// changes playback, catalog placement, permissions or historical attribution.
const DAY=86400000,RETENTION=30*DAY,MAX_ROWS=10000,MAX_GROUPS=500,PREFIX='client-history:';
const identifier=(v,max=151)=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9_.:-]+$/.test(v);
const text=(v,max=180)=>typeof v==='string'&&!/https?:\/\/|password=|username=|authorization|bearer /i.test(v)?v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const number=v=>Number.isSafeInteger(v)&&v>0&&v<10000?v:null;
const fold=v=>String(v||'').normalize('NFC').toLowerCase().trim().replace(/\s+/g,' ');
const titleKey=value=>{let binary='';for(const byte of new TextEncoder().encode(fold(value)))binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const parse=value=>{try{const data=typeof value==='string'?JSON.parse(value):value;return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}};
const endReasons=new Set(['closed','timeout','replaced','session_closed','player_closed','access_changed','admin_closed']);

// Use this projection when adding trusted catalog metadata to a new lease.
// IDs are already namespaced by the catalog. Never derive them from a URL.
export function cleanSeriesUsageContent(value){
 if(value?.type!=='series'||!identifier(value.id)||!text(value.name))return null;
 const episodeId=identifier(value.episodeId)?value.episodeId:null,rootId=typeof value.rootSeriesId==='string'?value.rootSeriesId:Number.isSafeInteger(value.rootSeriesId)&&value.rootSeriesId>0?String(value.rootSeriesId):'';
 return {type:'series',id:value.id,name:text(value.name),episodeId,season:number(value.season),episode:number(value.episode),
  ...(identifier(value.rootServer,80)?{rootServer:value.rootServer}:{}),
  ...(identifier(rootId)?{rootSeriesId:rootId}:{})};
}

function settings(input,now){
 const {accountId}=input||{},from=input?.from??now-7*DAY,to=input?.to??now,page=input?.page??1,pageSize=input?.pageSize??25,
  q=input?.q??'',seriesId=input?.seriesId??'',episodeId=input?.episodeId??'',username=input?.username??'';
 if(!identifier(accountId,80)||!Number.isSafeInteger(now)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<now-RETENTION-DAY||to>now+60000||from>to||
  !Number.isSafeInteger(page)||page<1||page>1000000||![10,25,50,100].includes(pageSize)||typeof q!=='string'||q.length>100||
  typeof seriesId!=='string'||seriesId&&!identifier(seriesId,1024)||typeof episodeId!=='string'||episodeId&&!identifier(episodeId,1024)||typeof username!=='string'||username.length>80)
  throw Error('series_usage_input');
 return {accountId,from:Math.max(from,now-RETENTION),to:Math.min(to,now),page,pageSize,q,seriesId,episodeId,username};
}

function identity(data){
 const content=cleanSeriesUsageContent(data.content);
 if(content)return {seriesId:content.id,seriesName:content.name,episodeId:content.episodeId,
  season:content.season??number(data.season),episode:content.episode??number(data.episode),identityEvidence:'catalog_id',
  ...(content.rootServer?{rootServer:content.rootServer}:{}),...(content.rootSeriesId?{rootSeriesId:content.rootSeriesId}:{})};
 const name=text(data.seriesTitle);if(!name)return null;
 // Older records remain explicitly separate. A matching title must never
 // silently attribute old usage to a newly added catalog item.
 return {seriesId:'legacy-title:'+titleKey(name),seriesName:name,episodeId:null,season:number(data.season),episode:number(data.episode),identityEvidence:'legacy_title'};
}

function safeSession(row,s,now){
 if(row?.account_id!==s.accountId||row.kind!=='playback'||!/^[a-f0-9]{64}$/.test(row.id||'')||!identifier(row.line_id,80)||!text(row.username,80)||
  !Number.isSafeInteger(row.started_at)||!Number.isSafeInteger(row.last_seen_at)||row.started_at<now-RETENTION||row.started_at>s.to||
  row.last_seen_at<row.started_at||row.ended_at!==null&&(!Number.isSafeInteger(row.ended_at)||row.ended_at<row.started_at))return null;
 const data=parse(row.data);if(data?.type!=='series'||data.client?.serviceCheck===true)return null;
 const content=identity(data);if(!content)return null;
 const end=Math.min(row.ended_at??row.last_seen_at,now);if(end<s.from)return null;
 const start=Math.max(row.started_at,s.from),stop=Math.max(start,Math.min(end,s.to)),episodeTitle=text(data.title)||
  (content.season&&content.episode?'T'+content.season+' · E'+content.episode:'Episodio sin identificar');
 const episodeId=content.episodeId||(content.season&&content.episode?'number:'+content.season+':'+content.episode:'legacy-title:'+titleKey(episodeTitle));
 return {id:row.id,lineId:row.line_id,username:text(row.username,80),...content,episodeId,episodeTitle,
  startedAt:row.started_at,lastActivityAt:Math.min(row.last_seen_at,now),endedAt:row.ended_at===null?null:Math.min(row.ended_at,now),
  windowStartedAt:start,windowEndedAt:stop,durationMs:stop-start,
  active:row.ended_at===null&&row.last_seen_at>now-90000&&s.to>=now-60000,estimatedEnd:row.ended_at===null||data.endReason==='timeout',
  access:data.access==='xtream'?'xtream':'api',trafficObserved:data.trafficObserved===true,
  endReason:endReasons.has(data.endReason)?data.endReason:null};
}

const totals=rows=>({sessions:rows.length,users:new Set(rows.map(row=>row.lineId)).size,durationMs:rows.reduce((n,row)=>n+row.durationMs,0),
 active:rows.filter(row=>row.active).length,trafficObservedSessions:rows.filter(row=>row.trafficObserved).length,
 lastUsedAt:rows.length?Math.max(...rows.map(row=>row.windowEndedAt)):null});

export function summarizeSeriesUsage(records,input,catalog=[],now=Date.now()){
 const s=settings(input,now),unique=new Map();
 for(const row of records||[]){const safe=safeSession(row,s,now);if(!safe)continue;const old=unique.get(safe.id);if(!old||safe.lastActivityAt>old.lastActivityAt)unique.set(safe.id,safe);}
 const ordered=[...unique.values()].sort((a,b)=>b.startedAt-a.startedAt||b.id.localeCompare(a.id)),recordsTruncated=ordered.length>MAX_ROWS,
  sessions=ordered.slice(0,MAX_ROWS),term=fold(s.q),match=row=>!term||[row.seriesName,row.episodeTitle,row.username].some(value=>fold(value).includes(term));
 const filtered=sessions.filter(row=>(!s.seriesId||row.seriesId===s.seriesId)&&(!s.episodeId||row.episodeId===s.episodeId)&&(!s.username||row.username===s.username)&&match(row));
 const seriesMap=new Map(),episodeMap=new Map(),seriesSessions=new Map(),episodeSessions=new Map();
 let catalogEpisodes=0;
 for(const row of (Array.isArray(catalog)?catalog:[]).slice(0,MAX_GROUPS)){
  if(row?.type!=='series')continue;
  const content=cleanSeriesUsageContent({...row,name:row.name||row.title,rootServer:row.rootServer??row.supplement?.server,rootSeriesId:row.rootSeriesId??row.supplement?.seriesId});if(!content||s.seriesId&&content.id!==s.seriesId)continue;
  const metadata={id:content.id,name:content.name,identityEvidence:'catalog_id',visible:row.visible===true,
   ...(content.rootServer?{rootServer:content.rootServer}:{}),...(content.rootSeriesId?{rootSeriesId:content.rootSeriesId}:{})};
  seriesMap.set(content.id,metadata);
  for(const ep of (Array.isArray(row.episodes)?row.episodes:[]).slice(0,1000)){
   if(catalogEpisodes>=MAX_ROWS)break;
   if(!identifier(ep.id))continue;const season=number(ep.season),episode=number(ep.episode_num??ep.episode),name=text(ep.title)||('T'+(season||'?')+' · E'+(episode||'?'));
   if(s.episodeId&&ep.id!==s.episodeId)continue;
   catalogEpisodes++;
   episodeMap.set(content.id+'\0'+ep.id,{id:ep.id,seriesId:content.id,seriesName:content.name,name,season,episode,identityEvidence:'catalog_id',visible:row.visible===true});
  }
 }
 for(const row of filtered){
  if(!seriesMap.has(row.seriesId))seriesMap.set(row.seriesId,{id:row.seriesId,name:row.seriesName,identityEvidence:row.identityEvidence,visible:false,
   ...(row.rootServer?{rootServer:row.rootServer}:{}),...(row.rootSeriesId?{rootSeriesId:row.rootSeriesId}:{})});
  const key=row.seriesId+'\0'+row.episodeId;if(!episodeMap.has(key))episodeMap.set(key,{id:row.episodeId,seriesId:row.seriesId,seriesName:row.seriesName,name:row.episodeTitle,
   season:row.season,episode:row.episode,identityEvidence:row.identityEvidence,visible:false});
  if(!seriesSessions.has(row.seriesId))seriesSessions.set(row.seriesId,[]);seriesSessions.get(row.seriesId).push(row);
  if(!episodeSessions.has(key))episodeSessions.set(key,[]);episodeSessions.get(key).push(row);
 }
 const allSeries=[...seriesMap.values()].filter(row=>!term||fold(row.name).includes(term)||seriesSessions.has(row.id))
  .map(row=>({...row,...totals(seriesSessions.get(row.id)||[])})).sort((a,b)=>b.sessions-a.sessions||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const allEpisodes=[...episodeMap.values()].filter(row=>(!s.seriesId||row.seriesId===s.seriesId)&&(!s.episodeId||row.id===s.episodeId)&&
  (!term||[row.name,row.seriesName].some(value=>fold(value).includes(term))||episodeSessions.has(row.seriesId+'\0'+row.id)))
  .map(row=>({...row,...totals(episodeSessions.get(row.seriesId+'\0'+row.id)||[])}))
  .sort((a,b)=>a.seriesName.localeCompare(b.seriesName)||(a.season||0)-(b.season||0)||(a.episode||0)-(b.episode||0)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(filtered.length/s.pageSize)),page=Math.min(s.page,pages);
 return {ok:true,version:1,accountId:s.accountId,checkedAt:now,from:s.from,to:s.to,retentionDays:30,maxRecords:MAX_ROWS,
  measurement:'recorded_sessions_and_connection_time_not_verified_playback',verifiedPlays:null,
  metricLabels:{sessions:'Sesiones / intentos',duration:'Tiempo de conexión registrado'},
  recordsTruncated,groupsTruncated:allSeries.length>MAX_GROUPS||allEpisodes.length>MAX_GROUPS,
  series:allSeries.slice(0,MAX_GROUPS),episodes:allEpisodes.slice(0,MAX_GROUPS),
  rows:filtered.slice((page-1)*s.pageSize,page*s.pageSize),
  summary:{...totals(filtered),seriesUsed:new Set(filtered.map(row=>row.seriesId)).size,episodesUsed:new Set(filtered.map(row=>row.seriesId+'\0'+row.episodeId)).size,
   legacySessions:filtered.filter(row=>row.identityEvidence==='legacy_title').length},
  facets:{users:[...new Set(sessions.map(row=>row.username))].sort().slice(0,200)},
  pagination:{page,pageSize:s.pageSize,total:filtered.length,pages}};
}

export async function readSeriesUsage(store,sql,input,catalog=[],now=Date.now()){
 let s;try{s=settings(input,now)}catch{return Response.json({error:'bridge_input'},{status:400});}
 const rows=sql?sql.exec("SELECT * FROM smn_client_history WHERE account_id=? AND kind='playback' AND started_at>=? AND started_at<=? AND COALESCE(ended_at,last_seen_at)>=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.type') END='series' ORDER BY started_at DESC,id DESC LIMIT ?",s.accountId,now-RETENTION,s.to,s.from,MAX_ROWS+1).toArray():
  [...await store.list({prefix:PREFIX})].map(([,row])=>row);
 const report=summarizeSeriesUsage(rows,input,catalog,now);if(sql&&rows.length>MAX_ROWS)report.recordsTruncated=true;
 return Response.json(report,{headers:{'Cache-Control':'no-store, private'}});
}

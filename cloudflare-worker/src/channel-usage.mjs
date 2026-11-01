import {LOCAL_TV_CHANNELS,isOfficialLivePage} from './official-live.mjs';
const DAY=86400000,RETENTION=30*DAY,MAX_ROWS=10000,PREFIX='client-history:';
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,151}$/.test(v);
const text=(v,n)=>typeof v==='string'&&!/https?:\/\/|password=|authorization|bearer /i.test(v)?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const FOLDERS={'kansas':'LOCAL KANSAS','new-york':'LOCAL NEW YORK','new-jersey':'LOCAL NEW JERSEY',california:'LOCAL CALIFORNIA'};
export function cleanUsageChannel(value){
 if(!value||!identifier(value.id)||!text(value.name,180))return null;
 return {id:value.id,name:text(value.name,180),folders:[...new Set((Array.isArray(value.folders)?value.folders:[]).map(v=>text(v,80)).filter(Boolean))].slice(0,4)};
}
export function usageChannel(row){
 if(row?.type!=='movie'||!(row.usageKind==='channel'||isOfficialLivePage(row.page)))return null;
 const official=LOCAL_TV_CHANNELS.find(c=>c.id===row.id&&c.page===row.page);
 return cleanUsageChannel({id:row.id,name:row.name,folders:official?(official.categories||['kansas']).map(k=>FOLDERS[k]).filter(Boolean):['CANALES AGREGADOS']});
}
const readRows=async(store,sql,leaseId)=>sql?sql.exec('SELECT * FROM smn_client_history WHERE lease_id=? AND ended_at IS NULL',String(leaseId)).toArray():[...await store.list({prefix:PREFIX})].map(([,r])=>r).filter(r=>r.lease_id===String(leaseId)&&r.ended_at===null);
// Called only after the directory has verified the current account and lease.
// No resource URL, request/session token, IP, or raw error is stored here.
export async function observeChannelUsage(store,sql,leaseId,input,now=Date.now()){
 if(!['media','failure','quality'].includes(input?.kind))return false;
 let changed=false;
 for(const row of await readRows(store,sql,leaseId)){
  const data=JSON.parse(row.data);if(!cleanUsageChannel(data.channel))continue;
  const usage=data.usage||{events:[],incidentCount:0,stallMs:0,reportedWatchMs:0,eventsDropped:0};usage.events??=[];
  const event=(kind,evidence,code=null)=>{if(usage.events.length>=32){usage.events.shift();usage.eventsDropped=(usage.eventsDropped||0)+1;}usage.events.push({at:now,kind,evidence,...(code?{code}:{})});};
  if(input.kind==='failure'){
   const code=['upstream_http','upstream_timeout','invalid_playlist','body_error','media_empty'].includes(input.code)?input.code:'upstream_http';
   if(usage.lastFailureAt>now-10000&&usage.lastFailureCode===code)continue;
   usage.lastFailureAt=now;usage.lastFailureCode=code;usage.incidentCount++;usage.pending=true;event(usage.mediaAt?'cut':'startup_failed','server',code);
  }else if(input.kind==='media'){
   if(!usage.mediaAt){usage.mediaAt=now;if(Number.isSafeInteger(input.startupMs)&&input.startupMs>=0&&input.startupMs<=120000)usage.startupMs=input.startupMs;}
   if(usage.pending){event('recovered','video_bytes');usage.pending=false;}
  }else{
   if(typeof input.reportId!=='string'||input.reportId.length>100||usage.reportId===input.reportId||!Number.isSafeInteger(input.watchMs)||input.watchMs<0||input.watchMs>300000||!Number.isSafeInteger(input.stallMs)||input.stallMs<0||input.stallMs>input.watchMs||!Number.isSafeInteger(input.errors)||input.errors<0||input.errors>100)continue;
   usage.reportId=input.reportId;usage.reportedWatchMs+=input.watchMs;usage.stallMs+=input.stallMs;
   if(input.errors||input.stallMs){usage.incidentCount++;usage.pending=true;event(input.errors?'player_error':'stall','player');}
   else if(input.decoded>0&&usage.pending){usage.pending=false;event('recovered','player');}
  }
  data.usage=usage;data.trafficObserved||=input.kind==='media';row.data=JSON.stringify(data);row.last_seen_at=Math.max(row.last_seen_at,now);
  if(sql)sql.exec('UPDATE smn_client_history SET data=?,last_seen_at=? WHERE id=? AND ended_at IS NULL',row.data,row.last_seen_at,row.id);else await store.put(PREFIX+row.id,row);
  changed=true;
 }
 return changed;
}
function safeSession(row,data,from,to,now){
 const channel=cleanUsageChannel(data.channel),usage=data.usage||{},end=Math.min(row.ended_at??row.last_seen_at,now),start=Math.max(row.started_at,from),stop=Math.min(end,to);
 const events=(usage.events||[]).filter(e=>Number.isSafeInteger(e.at)&&e.at>=from&&e.at<=to&&['cut','startup_failed','player_error','stall','recovered'].includes(e.kind)).map(e=>({at:e.at,kind:e.kind,evidence:['server','player','video_bytes'].includes(e.evidence)?e.evidence:'unknown',...(['upstream_http','upstream_timeout','invalid_playlist','body_error','media_empty'].includes(e.code)?{code:e.code}:{})}));
 return {id:row.id,lineId:row.line_id,username:row.username,channelId:channel.id,channelName:channel.name,folders:channel.folders,startedAt:row.started_at,endedAt:row.ended_at,lastActivityAt:row.last_seen_at,windowStartedAt:start,windowEndedAt:Math.max(start,stop),durationMs:Math.max(0,stop-start),active:row.ended_at===null&&row.last_seen_at>now-90000,estimatedEnd:row.ended_at===null||data.endReason==='timeout',access:data.access==='xtream'?'xtream':'api',mediaObserved:!!usage.mediaAt,startupMs:row.started_at>=from&&row.started_at<=to&&Number.isSafeInteger(usage.startupMs)?usage.startupMs:null,events,eventsDropped:usage.eventsDropped||0,pending:usage.pending===true,incidentCount:row.started_at>=from&&end<=to&&Number.isSafeInteger(usage.incidentCount)?usage.incidentCount:events.filter(e=>e.kind!=='recovered').length,stallMs:Number.isSafeInteger(usage.stallMs)?usage.stallMs:0,endReason:['closed','timeout','replaced','session_closed','player_closed','access_changed','admin_closed'].includes(data.endReason)?data.endReason:null};
}
export async function readChannelUsage(store,sql,input,catalog,now=Date.now()){
 const accountId=input.accountId,from=input.from??now-7*DAY,to=input.to??now,page=input.page??1,size=input.pageSize??25,q=input.q??'',folder=input.folder??'',channelId=input.channelId??'',username=input.username??'';
 if(!identifier(accountId)||accountId.length>80||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<now-RETENTION-DAY||to>now+60000||from>to||!Number.isSafeInteger(page)||page<1||page>1000000||![10,25,50,100].includes(size)||typeof q!=='string'||q.length>100||typeof folder!=='string'||folder.length>80||typeof channelId!=='string'||channelId&&!identifier(channelId)||typeof username!=='string'||username.length>80)return Response.json({error:'bridge_input'},{status:400});
 const low=Math.max(from,now-RETENTION),high=Math.min(to,now);
 const all=sql?sql.exec("SELECT * FROM smn_client_history WHERE account_id=? AND kind='playback' AND started_at>=? AND started_at<=? AND COALESCE(ended_at,last_seen_at)>=? AND json_type(data,'$.channel')='object' ORDER BY started_at DESC,id DESC LIMIT ?",accountId,now-RETENTION,high,low,MAX_ROWS).toArray():[...await store.list({prefix:PREFIX})].map(([,r])=>r).filter(r=>r.account_id===accountId&&r.kind==='playback'&&r.started_at>=now-RETENTION&&r.started_at<=high&&(r.ended_at??r.last_seen_at)>=low&&JSON.parse(r.data).channel).sort((a,b)=>b.started_at-a.started_at||b.id.localeCompare(a.id)).slice(0,MAX_ROWS);
 const map=new Map();for(const row of catalog||[]){const channel=usageChannel(row);if(channel)map.set(channel.id,{...channel,visible:row.visible===true});}
 const sessions=[];for(const row of all){const data=JSON.parse(row.data),channel=cleanUsageChannel(data.channel);if(!channel)continue;if(!map.has(channel.id))map.set(channel.id,{...channel,visible:false});sessions.push(safeSession(row,data,low,high,now));}
 const term=q.toLocaleLowerCase(),match=s=>!term||[s.channelName,s.username].some(v=>v.toLocaleLowerCase().includes(term));
 const filtered=sessions.filter(s=>(!channelId||s.channelId===channelId)&&(!folder||s.folders.includes(folder))&&(!username||s.username===username)&&match(s));
 const channels=[...map.values()].filter(c=>(!channelId||c.id===channelId)&&(!folder||c.folders.includes(folder))&&(!term||c.name.toLocaleLowerCase().includes(term)||filtered.some(s=>s.channelId===c.id))).map(c=>{
  const rows=filtered.filter(s=>s.channelId===c.id),startup=rows.filter(s=>s.startupMs!==null);
  return {...c,sessions:rows.length,users:new Set(rows.map(s=>s.username)).size,durationMs:rows.reduce((n,s)=>n+s.durationMs,0),active:rows.filter(s=>s.active).length,incidents:rows.reduce((n,s)=>n+s.incidentCount,0),pendingIssues:rows.filter(s=>s.pending).length,lastUsedAt:rows.length?Math.max(...rows.map(s=>s.windowEndedAt)):null,startupSamples:startup.length,meanStartupMs:startup.length?Math.round(startup.reduce((n,s)=>n+s.startupMs,0)/startup.length):null};
 }).sort((a,b)=>b.durationMs-a.durationMs||a.name.localeCompare(b.name));
 const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.min(page,pages),rows=filtered.slice((current-1)*size,current*size),events=rows.flatMap(s=>s.events.map(e=>({...e,id:s.id+':'+e.at+':'+e.kind,username:s.username,channelId:s.channelId,channelName:s.channelName}))).sort((a,b)=>b.at-a.at).slice(0,100),startup=filtered.filter(s=>s.startupMs!==null);
 return Response.json({ok:true,version:1,accountId,checkedAt:now,from:low,to:high,retentionDays:30,maxRecords:MAX_ROWS,measurement:'recorded_connection_time_not_continuous_viewing',coverage:'server_media_and_available_player_reports',channels,rows,events,summary:{durationMs:filtered.reduce((n,s)=>n+s.durationMs,0),sessions:filtered.length,channelsUsed:new Set(filtered.map(s=>s.channelId)).size,users:new Set(filtered.map(s=>s.username)).size,active:filtered.filter(s=>s.active).length,incidents:filtered.reduce((n,s)=>n+s.incidentCount,0),pendingIssues:filtered.filter(s=>s.pending).length,startupSamples:startup.length,meanStartupMs:startup.length?Math.round(startup.reduce((n,s)=>n+s.startupMs,0)/startup.length):null},facets:{folders:[...new Set([...map.values()].flatMap(c=>c.folders))].sort(),users:[...new Set(sessions.map(s=>s.username))].sort().slice(0,200)},pagination:{page:current,pageSize:size,total:filtered.length,pages}});
}

// Owner-only support projections. Callers authenticate the owner before using
// the private read/save routes; observations require the current user identity.
// This module never contacts a provider or changes an account, lease or source.
import {contentPermissions} from './content-permissions.mjs';
import {readInventoryPool} from './provider-inventory.mjs';
import {usableProvider} from './provider-assignment.mjs';
import {expectedPlaybackOutcome,playbackErrorCode} from './playback-outcomes.mjs';

const DAY=86400000,RETENTION=30*DAY,INCIDENT_LIMIT=100,RECEIPT_LIMIT=128,RECEIPT_AGE=30*60000,SOURCE_RECENT=5*60000;
const TYPES=['live','movie','series'],STATES=['open','investigating','fixed_pending','resolved'];
const PATHS=new Set(['/client-support-read','/client-support-check','/client-support-incident-save','/client-support-observe']);
const normal=value=>String(value||'').trim().toLowerCase();
const validUsername=value=>typeof value==='string'&&/^[a-zA-Z0-9_.@!-]{3,80}$/.test(value);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer=(value,max=1000000000)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const timestamp=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now?value:null;
const codeFor=value=>playbackErrorCode(value)||null;
const privateText=/(?:https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:password|contrase(?:n|ñ)a|token|authorization|cookie)\s*[:=])/i;
const cleanText=(value,max,{required=false}={})=>typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&!privateText.test(value)&&(!required||value.trim().length>=3)?value.trim():null;
const answer=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error,status=400)=>answer({error},status);
const listKey=(uid,type)=>'support:list:'+uid+':'+type;
const incidentKey=(uid,id)=>'support:incident:'+uid+':'+id;
const indexKey=uid=>'support:incident-index:'+uid;
const receiptKey=uid=>'support:receipts:'+uid;
const recordingKey='support:recording-since';
const transaction=(store,operation)=>typeof store.transaction==='function'?store.transaction(operation):operation(store);

function schema(sql){
 if(!sql)return;
 sql.exec(`CREATE TABLE IF NOT EXISTS smn_support_lists (
  user_id TEXT NOT NULL,content_type TEXT NOT NULL,requested_at INTEGER NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(user_id,content_type));
 CREATE TABLE IF NOT EXISTS smn_support_incidents (
  user_id TEXT NOT NULL,id TEXT NOT NULL,last_seen_at INTEGER NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(user_id,id));
 CREATE INDEX IF NOT EXISTS smn_support_incident_user_time ON smn_support_incidents(user_id,last_seen_at,id);
 CREATE INDEX IF NOT EXISTS smn_support_list_expiry ON smn_support_lists(requested_at);
 CREATE INDEX IF NOT EXISTS smn_support_incident_expiry ON smn_support_incidents(last_seen_at);`);
}
function decode(value){try{return value?JSON.parse(value):null;}catch{return null;}}
async function readList(store,sql,uid,type){
 return sql?decode(sql.exec('SELECT data FROM smn_support_lists WHERE user_id=? AND content_type=?',uid,type).toArray()[0]?.data):await store.get(listKey(uid,type));
}
async function saveList(store,sql,uid,type,row){
 if(sql)sql.exec('INSERT INTO smn_support_lists(user_id,content_type,requested_at,data) VALUES(?,?,?,?) ON CONFLICT(user_id,content_type) DO UPDATE SET requested_at=excluded.requested_at,data=excluded.data',uid,type,row.lastRequestedAt,JSON.stringify(row));
 else await store.put(listKey(uid,type),row);
}
async function readIncident(store,sql,uid,id){
 return sql?decode(sql.exec('SELECT data FROM smn_support_incidents WHERE user_id=? AND id=?',uid,id).toArray()[0]?.data):await store.get(incidentKey(uid,id));
}
async function incidentRows(store,sql,uid,now){
 if(sql)return sql.exec('SELECT data FROM smn_support_incidents WHERE user_id=? AND last_seen_at>=? ORDER BY last_seen_at DESC,id DESC LIMIT ?',uid,now-RETENTION,INCIDENT_LIMIT).toArray().map(row=>decode(row.data)).filter(Boolean);
 const ids=await store.get(indexKey(uid))||[];
 const rows=await Promise.all(ids.slice(0,INCIDENT_LIMIT).map(id=>store.get(incidentKey(uid,id))));
 return rows.filter(row=>row&&row.lastSeenAt>=now-RETENTION).sort((a,b)=>b.lastSeenAt-a.lastSeenAt||b.id.localeCompare(a.id));
}
async function saveIncident(store,sql,uid,row,now){
 if(sql){
  sql.exec('INSERT INTO smn_support_incidents(user_id,id,last_seen_at,data) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET last_seen_at=excluded.last_seen_at,data=excluded.data',uid,row.id,row.lastSeenAt,JSON.stringify(row));
  sql.exec('DELETE FROM smn_support_incidents WHERE user_id=? AND last_seen_at<?',uid,now-RETENTION);
  sql.exec('DELETE FROM smn_support_incidents WHERE user_id=? AND id IN(SELECT id FROM smn_support_incidents WHERE user_id=? ORDER BY last_seen_at DESC,id DESC LIMIT -1 OFFSET ?)',uid,uid,INCIDENT_LIMIT);
  return;
 }
 const previous=await store.get(indexKey(uid))||[],rows=[];
 for(const id of previous.slice(0,INCIDENT_LIMIT)){
  if(id===row.id)continue;
  const existing=await store.get(incidentKey(uid,id));
  if(existing&&existing.lastSeenAt>=now-RETENTION)rows.push(existing);else await store.delete(incidentKey(uid,id));
 }
 rows.push(row);rows.sort((a,b)=>b.lastSeenAt-a.lastSeenAt||b.id.localeCompare(a.id));
 const kept=rows.slice(0,INCIDENT_LIMIT);
 for(const old of rows.slice(INCIDENT_LIMIT))await store.delete(incidentKey(uid,old.id));
 await store.put(incidentKey(uid,row.id),row);await store.put(indexKey(uid),kept.map(value=>value.id));
}
function projectIncident(row,now){
 if(!row||!uuid(row.id)||!['catalog','playback','manual'].includes(row.type)||!STATES.includes(row.status)||!timestamp(row.firstSeenAt,now)||!timestamp(row.lastSeenAt,now)||row.firstSeenAt>row.lastSeenAt||!integer(row.revision)||!integer(row.count))return null;
 const title=cleanText(row.title,160,{required:true}),note=cleanText(row.note??'',2000);if(title===null||note===null)return null;
 return {id:row.id,type:row.type,title,status:row.status,firstSeenAt:row.firstSeenAt,lastSeenAt:row.lastSeenAt,updatedAt:Math.max(row.lastSeenAt,timestamp(row.updatedAt,now)||0),count:row.count,code:codeFor(row.code),httpStatus:integer(row.httpStatus,599)&&row.httpStatus>=100?row.httpStatus:null,contentType:TYPES.includes(row.contentType)?row.contentType:null,...(/^\d{1,16}$/.test(String(row.publicId??''))?{publicId:String(row.publicId)}:{}),note,revision:row.revision};
}
function projectList(type,row,now){
 const empty={type,lastRequestedAt:null,lastRespondedAt:null,status:'not_observed',httpStatus:null,itemCount:null,selection:'all',access:null};
 if(!row||!timestamp(row.lastRequestedAt,now)||row.lastRequestedAt<now-RETENTION)return empty;
 const httpStatus=integer(row.httpStatus,599)&&row.httpStatus>=100?row.httpStatus:null;
 if(!httpStatus||!timestamp(row.lastRespondedAt,now)||row.lastRespondedAt<row.lastRequestedAt)return empty;
 return {type,lastRequestedAt:row.lastRequestedAt,lastRespondedAt:row.lastRespondedAt,status:['delivered','empty','failed','restricted'].includes(row.status)?row.status:'not_observed',httpStatus,itemCount:integer(row.itemCount)?row.itemCount:null,selection:['category','source'].includes(row.selection)?row.selection:'all',access:['xtream','api'].includes(row.access)?row.access:null};
}
async function connectionCheck(sql,uid,now){
 if(!sql)return {reserved:null,limit:3,status:'unknown'};
 try{
  const exists=sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='smn_playback_leases' LIMIT 1").toArray();
  if(!exists.length)return {reserved:null,limit:3,status:'unknown'};
  const value=sql.exec('SELECT COUNT(*) AS total FROM smn_playback_leases WHERE uid=? AND until>?',uid,now).toArray()[0]?.total;
  return {reserved:integer(value)?value:null,limit:3,status:integer(value)?'observed':'unknown'};
 }catch{return {reserved:null,limit:3,status:'unknown'};}
}
async function sourceCheck(store,now){
 try{
  const pool=await readInventoryPool(store,now),observedAt=timestamp(pool?.syncedAt,now);
  if(!observedAt||!Array.isArray(pool?.lines))return {status:'unknown',observedAt:null,usableAccounts:null};
  const ids=new Set();
  for(const line of pool.lines)if(line&&typeof line.id==='string'&&line.id.length>0&&line.id.length<=512&&usableProvider(line,now)&&Number(line.maxConnections)>0)ids.add(typeof line.key==='string'&&line.key?line.key:line.id);
  return {status:observedAt>=now-SOURCE_RECENT?'observed':'stale',observedAt,usableAccounts:ids.size};
 }catch{return {status:'unknown',observedAt:null,usableAccounts:null};}
}
async function readSupport(store,sql,user,b,now){
 const page=b.page??1,pageSize=b.pageSize??25;
 if(!Number.isSafeInteger(page)||page<1||page>1000000||![10,25,50].includes(pageSize))return fail('invalid_support_input');
 const [lists,rows,connections,source,recordingSince]=await Promise.all([
  Promise.all(TYPES.map(async type=>projectList(type,await readList(store,sql,user.id,type),now))),incidentRows(store,sql,user.id,now),connectionCheck(sql,user.id,now),sourceCheck(store,now),store.get(recordingKey)
 ]);
 const incidents=rows.map(row=>projectIncident(row,now)).filter(Boolean),pages=Math.max(1,Math.ceil(incidents.length/pageSize)),current=Math.min(page,pages),permissions=contentPermissions(user.permissions);
 const display=typeof user.displayUsername==='string'&&normal(user.displayUsername)===normal(user.username)?user.displayUsername:user.username;
 return answer({schema:1,checkedAt:now,recordingSince:timestamp(recordingSince,now),customer:{id:user.id,username:display,name:typeof user.name==='string'?user.name.slice(0,200):'',status:user.status==='active'?'active':'suspended',expiresAt:timestamp(user.expiresAt,Number.MAX_SAFE_INTEGER),permissions},lists,
  check:{checkedAt:now,access:user.status!=='active'?'suspended':user.expiresAt&&user.expiresAt<=now?'expired':'active',permissions,connections,source,playbackValidated:false},
  incidents:{rows:incidents.slice((current-1)*pageSize,current*pageSize),total:incidents.length,page:current,pageSize,pages,retentionDays:30}});
}
async function recordingStarted(store,now){if(!await store.get(recordingKey))await store.put(recordingKey,now);}
async function receipt(store,uid,requestId,at,now){
 const rows=(await store.get(receiptKey(uid))||[]).filter(row=>row&&uuid(row.id)&&timestamp(row.at,now)&&row.at>=now-RECEIPT_AGE).slice(-RECEIPT_LIMIT);
 if(rows.some(row=>row.id===requestId))return false;
 rows.push({id:requestId,at});await store.put(receiptKey(uid),rows.slice(-RECEIPT_LIMIT));return true;
}
function validateObservation(b,user,now){
 if(b.uid!==user.id||b.version!==user.version)return 'support_scope';
 if(!['catalog','playback'].includes(b.kind)||!TYPES.includes(b.type)||!uuid(b.requestId)||!timestamp(b.at,now)||b.at<now-RECEIPT_AGE||!integer(b.httpStatus,599)||b.httpStatus<200||!['xtream','api'].includes(b.access)||!['all','category','source',undefined].includes(b.selection))return 'invalid_support_input';
 if(b.respondedAt!==undefined&&(!timestamp(b.respondedAt,now)||b.respondedAt<b.at)||b.itemCount!==undefined&&b.itemCount!==null&&!integer(b.itemCount)||b.publicId!==undefined&&!/^\d{1,16}$/.test(String(b.publicId)))return 'invalid_support_input';
 return null;
}
function automaticFailure(b,code){
 return b.httpStatus>=400&&b.httpStatus!==410&&!expectedPlaybackOutcome(b.httpStatus,code)&&!['ccf_capacity','user_connection_limit','range_out_of_bounds','playback_superseded','playback_expired','session_expired','content_disabled','adult_content_disabled','xtream_disabled'].includes(code);
}
const contentName=type=>({live:'TV',movie:'Películas',series:'Series'}[type]);
async function observe(store,sql,user,b,now){
 const error=validateObservation(b,user,now);if(error)return fail(error,error==='support_scope'?403:400);
 if(b.serviceCheck===true)return answer({ok:true,ignored:true});
 if(!await receipt(store,user.id,b.requestId,b.at,now))return answer({ok:true,duplicate:true});
 await recordingStarted(store,now);
 if(sql){
  sql.exec('DELETE FROM smn_support_lists WHERE rowid IN(SELECT rowid FROM smn_support_lists WHERE requested_at<? ORDER BY requested_at LIMIT 50)',now-RETENTION);
  sql.exec('DELETE FROM smn_support_incidents WHERE rowid IN(SELECT rowid FROM smn_support_incidents WHERE last_seen_at<? ORDER BY last_seen_at LIMIT 50)',now-RETENTION);
 }
 const code=codeFor(b.code);
 if(b.kind==='catalog'){
  const previous=await readList(store,sql,user.id,b.type);
  if(!previous||b.at>=previous.lastRequestedAt){
   const restricted=['content_disabled','adult_content_disabled','xtream_disabled'].includes(code)||b.httpStatus===403;
   await saveList(store,sql,user.id,b.type,{lastRequestedAt:b.at,lastRespondedAt:b.respondedAt??b.at,status:restricted?'restricted':b.httpStatus>=300?'failed':b.itemCount===0?'empty':'delivered',httpStatus:b.httpStatus,itemCount:b.httpStatus<300&&integer(b.itemCount)?b.itemCount:null,selection:['category','source'].includes(b.selection)?b.selection:'all',access:b.access});
  }
 }
 if(!automaticFailure(b,code))return answer({ok:true});
 const publicId=b.publicId===undefined?null:String(b.publicId),rows=await incidentRows(store,sql,user.id,now);
 // Only a known resource or the same scoped catalogue operation may aggregate.
 // Unknown playback resources remain distinct rather than merging customers' cases.
 const previous=rows.find(row=>row.type===b.kind&&row.contentType===b.type&&row.code===code&&row.httpStatus===b.httpStatus&&row.status!=='resolved'&&row.lastSeenAt>=b.at-30*60000&&row.lastSeenAt<=b.at&&(b.kind==='catalog'?(!b.selection||b.selection==='all')&&row.selection==='all'&&row.access===b.access:publicId&&row.publicId===publicId));
 const incident=previous?{...previous,lastSeenAt:Math.max(previous.lastSeenAt,b.at),count:Math.min(1000000000,(previous.count||1)+1),revision:previous.revision+1}:{id:crypto.randomUUID(),type:b.kind,title:(b.kind==='catalog'?'Solicitud de listas de ':'Reproducción de ')+contentName(b.type)+' con error',status:'open',firstSeenAt:b.at,lastSeenAt:b.at,count:1,code,httpStatus:b.httpStatus,contentType:b.type,...(publicId?{publicId}:{}),note:'',revision:1,selection:['category','source'].includes(b.selection)?b.selection:'all',access:b.access};
 await saveIncident(store,sql,user.id,incident,now);return answer({ok:true});
}
async function saveManualIncident(store,sql,user,b,now){
 const actor=validUsername(b.actor)?b.actor:null;if(!actor||!STATES.includes(b.status))return fail('invalid_support_input');
 const note=cleanText(b.note??'',2000);if(note===null)return fail('invalid_support_note');
 let incident;
 if(b.id!==undefined){
  if(!uuid(b.id)||!integer(b.expectedRevision)||b.expectedRevision<1)return fail('invalid_support_input');
  const old=await readIncident(store,sql,user.id,b.id);if(!old||old.lastSeenAt<now-RETENTION)return fail('support_not_found',404);
  if(old.revision!==b.expectedRevision)return fail('support_conflict',409);
  const title=b.title===undefined?old.title:cleanText(b.title,160,{required:true});if(title===null)return fail('invalid_support_note');
  incident={...old,title,note,status:b.status,revision:old.revision+1,updatedAt:now,updatedBy:actor};
 }else{
  const title=cleanText(b.title,160,{required:true});if(title===null)return fail('invalid_support_note');
  incident={id:crypto.randomUUID(),type:'manual',title,status:b.status,firstSeenAt:now,lastSeenAt:now,count:1,code:null,httpStatus:null,contentType:null,note,revision:1,updatedAt:now,updatedBy:actor};
 }
 await recordingStarted(store,now);await saveIncident(store,sql,user.id,incident,now);
 return answer({ok:true,incident:projectIncident(incident,now)});
}

export async function clientSupportRoute(store,path,b,{sql=store.sql,now=Date.now()}={}){
 if(!PATHS.has(path))return fail('not_found',404);
 if(!b||typeof b!=='object'||Array.isArray(b)||!validUsername(b.username)||!Number.isSafeInteger(now)||now<=0)return fail('invalid_support_input');
 try{
  return await transaction(store,async tx=>{
   const user=await tx.get('user:'+normal(b.username));if(!user||!validId(user.id))return fail('support_not_found',404);
   if(path==='/client-support-observe'){
    const error=validateObservation(b,user,now);if(error)return fail(error,error==='support_scope'?403:400);
    if(b.serviceCheck===true)return answer({ok:true,ignored:true});
   }
   schema(sql);
   if(path==='/client-support-observe')return observe(tx,sql,user,b,now);
   if(path==='/client-support-incident-save')return saveManualIncident(tx,sql,user,b,now);
   return readSupport(tx,sql,user,b,now);
  });
 }catch{return fail('support_unavailable',503);}
}

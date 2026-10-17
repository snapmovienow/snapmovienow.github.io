import {cleanConnectionClient} from './connection-monitor.mjs';
import {cleanPlaybackActivity} from './playback-activity.mjs';
const DAY=86400000,RETENTION=30*DAY,MAX_ROWS=10000,PREFIX='client-history:';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value);
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function clientHistorySchema(sql){if(sql)sql.exec(`CREATE TABLE IF NOT EXISTS smn_client_history (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, line_id TEXT NOT NULL, username TEXT NOT NULL,
 kind TEXT NOT NULL, started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, ended_at INTEGER,
 lease_id TEXT, data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS smn_client_history_account ON smn_client_history(account_id,started_at,id);
 CREATE INDEX IF NOT EXISTS smn_client_history_lease ON smn_client_history(lease_id,ended_at);`);}
export async function safelyRecord(work){try{return await work();}catch{console.error('client_history_write_failed');}}
function scope(user){return user&&id(user.resellerBridge?.accountId)&&id(user.resellerBridge?.lineId)&&/^[a-z0-9_.@!-]{3,80}$/.test(user.username||'')?{accountId:user.resellerBridge.accountId,lineId:user.resellerBridge.lineId,username:user.username}:null;}
async function rowsFor(store,sql,where='',args=[]){return sql?sql.exec('SELECT * FROM smn_client_history'+where,...args).toArray():[...await store.list({prefix:PREFIX})].map(([,row])=>row);}
async function save(store,sql,row){if(sql)sql.exec('INSERT INTO smn_client_history(id,account_id,line_id,username,kind,started_at,last_seen_at,ended_at,lease_id,data) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,ended_at=excluded.ended_at,data=excluded.data',row.id,row.account_id,row.line_id,row.username,row.kind,row.started_at,row.last_seen_at,row.ended_at,row.lease_id,row.data);else await store.put(PREFIX+row.id,row);}
async function trim(store,sql,accountId,now){
 if(sql){sql.exec('DELETE FROM smn_client_history WHERE id IN(SELECT id FROM smn_client_history WHERE account_id=? AND started_at<? ORDER BY started_at LIMIT 100)',accountId,now-RETENTION);sql.exec('DELETE FROM smn_client_history WHERE id IN(SELECT id FROM smn_client_history WHERE account_id=? ORDER BY started_at DESC,id DESC LIMIT 100 OFFSET ?)',accountId,MAX_ROWS);return;}
 const rows=(await rowsFor(store)).filter(r=>r.account_id===accountId).sort((a,b)=>b.started_at-a.started_at||b.id.localeCompare(a.id));for(let i=0;i<rows.length;i++)if(i>=MAX_ROWS||rows[i].started_at<now-RETENTION)await store.delete(PREFIX+rows[i].id);
}
export async function recordClientAccess(store,sql,user,kind,client,access='api',now=Date.now()){
 const owner=scope(user);if(client?.serviceCheck===true||!owner||!['login','login_failed','logout'].includes(kind))return;
 const context=cleanConnectionClient(client),bucket=PREFIX+'rate:'+owner.accountId+':'+owner.lineId+':'+kind+':'+access;
 const previous=await store.get(bucket);if(previous>now-60000)return;await store.put(bucket,now);
 await save(store,sql,{id:crypto.randomUUID(),account_id:owner.accountId,line_id:owner.lineId,username:owner.username,kind,started_at:now,last_seen_at:now,ended_at:now,lease_id:null,data:JSON.stringify({client:context,access:access==='xtream'?'xtream':'api'})});await trim(store,sql,owner.accountId,now);
}
export async function recordPlayback(store,sql,leaseId,lease,now=Date.now()){
 const user=await store.get('user:'+String(lease.username||'').toLowerCase()),owner=scope(user);if(lease.client?.serviceCheck===true||!owner||user.id!==lease.uid)return;
 const eventId=await digest(JSON.stringify(['playback',leaseId,lease.request_id||'']));
 const found=sql?(await rowsFor(store,sql,' WHERE id=?',[eventId]))[0]:await store.get(PREFIX+eventId);
 if(found){if(found.ended_at===null&&lease.until-90000>found.last_seen_at+15000){found.last_seen_at=Math.min(now,lease.until-90000);await save(store,sql,found);}return eventId;}
 await finishPlayback(store,sql,leaseId,'replaced',now);
 const type=String(lease.mediaKey||'').split('|')[0],activity=cleanPlaybackActivity(lease.activity,type),start=Number.isSafeInteger(lease.startedAt)&&lease.startedAt>0&&lease.startedAt<=now?lease.startedAt:now;
 await save(store,sql,{id:eventId,account_id:owner.accountId,line_id:owner.lineId,username:owner.username,kind:'playback',started_at:start,last_seen_at:now,ended_at:null,lease_id:String(leaseId),data:JSON.stringify({client:cleanConnectionClient(lease.client),access:lease.xtream?'xtream':'api',type:['live','movie','series'].includes(type)?type:null,title:activity?.title||null,seriesTitle:activity?.seriesTitle||null,season:activity?.season||null,episode:activity?.episode||null,trafficObserved:false})});await trim(store,sql,owner.accountId,now);return eventId;
}
export async function touchPlayback(store,sql,leaseId,now=Date.now(),traffic=false){
 const rows=(await rowsFor(store,sql,' WHERE lease_id=? AND ended_at IS NULL',[String(leaseId)])).filter(row=>row.lease_id===String(leaseId)&&row.ended_at===null);
 for(const row of rows){const data=JSON.parse(row.data);if(row.last_seen_at>now-15000&&(!traffic||data.trafficObserved))continue;row.last_seen_at=Math.max(row.last_seen_at,now);if(traffic)data.trafficObserved=true;row.data=JSON.stringify(data);await save(store,sql,row);}
}
export async function finishPlayback(store,sql,leaseId,reason='closed',now=Date.now()){
 const rows=(await rowsFor(store,sql,' WHERE lease_id=? AND ended_at IS NULL',[String(leaseId)])).filter(row=>row.lease_id===String(leaseId)&&row.ended_at===null);
 for(const row of rows){row.ended_at=Math.max(row.started_at,reason==='timeout'?row.last_seen_at:now);row.data=JSON.stringify({...JSON.parse(row.data),endReason:['closed','timeout','replaced','session_closed','player_closed','access_changed','admin_closed'].includes(reason)?reason:'closed'});await save(store,sql,row);}
}
export function finishLeaseSelection(sql,where,args,reason,now=Date.now()){
 sql.exec("UPDATE smn_client_history SET ended_at=CASE WHEN ?='timeout' THEN MAX(started_at,last_seen_at) ELSE MAX(started_at,?) END,data=json_set(data,'$.endReason',?) WHERE ended_at IS NULL AND lease_id IN(SELECT id FROM smn_playback_leases WHERE "+where+')',reason,now,reason,...args);
}
export async function readClientHistory(store,sql,input,now=Date.now()){
 const accountId=input.accountId,q=input.q??'',kind=input.kind??'all',page=input.page??1,size=input.pageSize??25,from=input.from??now-7*DAY,to=input.to??now;
 if(!id(accountId)||typeof q!=='string'||q.length>100||!['all','login','login_failed','logout','playback'].includes(kind)||!Number.isSafeInteger(page)||page<1||page>1000000||![10,25,50,100].includes(size)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<now-RETENTION-DAY||to>now+60000||from>to)return Response.json({error:'bridge_input'},{status:400});
 // The event's immutable reseller scope controls access even if a line is later archived.
 const args=[accountId,Math.max(from,now-RETENTION),to],where=['account_id=?','started_at>=?','started_at<=?'];if(kind!=='all'){where.push('kind=?');args.push(kind);}if(q){where.push("(LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(json_extract(data,'$.title'),'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(json_extract(data,'$.client.ip'),'')) LIKE ? ESCAPE '\\')");const term='%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%';args.push(term,term,term);}
 let rows,total,summary;
 const duration='MAX(0,COALESCE(ended_at,last_seen_at)-started_at)';
 if(sql){const stats=sql.exec('SELECT COUNT(*) AS total,SUM(kind=\'playback\') AS plays,SUM(kind=\'login\') AS logins,SUM(kind=\'login_failed\') AS failures,COALESCE(SUM(CASE WHEN kind=\'playback\' THEN '+duration+' ELSE 0 END),0) AS durationMs FROM smn_client_history WHERE '+where.join(' AND '),...args).one();total=stats.total;summary={plays:stats.plays||0,logins:stats.logins||0,failures:stats.failures||0,durationMs:stats.durationMs};const current=Math.min(page,Math.max(1,Math.ceil(total/size)));rows=sql.exec('SELECT * FROM smn_client_history WHERE '+where.join(' AND ')+' ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?',...args,size,(current-1)*size).toArray();}
 else{const term=q.toLowerCase(),all=(await rowsFor(store)).filter(r=>r.account_id===accountId&&r.started_at>=Math.max(from,now-RETENTION)&&r.started_at<=to&&(kind==='all'||r.kind===kind)&&(!term||[r.username,JSON.parse(r.data).title,JSON.parse(r.data).client?.ip].some(s=>String(s||'').toLowerCase().includes(term)))).sort((a,b)=>b.started_at-a.started_at||b.id.localeCompare(a.id));total=all.length;summary={plays:all.filter(r=>r.kind==='playback').length,logins:all.filter(r=>r.kind==='login').length,failures:all.filter(r=>r.kind==='login_failed').length,durationMs:all.reduce((n,r)=>n+(r.kind==='playback'?Math.max(0,(r.ended_at??r.last_seen_at)-r.started_at):0),0)};const current=Math.min(page,Math.max(1,Math.ceil(total/size)));rows=all.slice((current-1)*size,current*size);}
 const pages=Math.max(1,Math.ceil(total/size));return Response.json({ok:true,checkedAt:now,accountId,retentionDays:30,maxRecords:MAX_ROWS,summary,rows:rows.map(row=>({id:row.id,lineId:row.line_id,username:row.username,kind:row.kind,startedAt:row.started_at,lastActivityAt:row.last_seen_at,endedAt:row.ended_at,durationMs:Math.max(0,(row.ended_at??row.last_seen_at)-row.started_at),...JSON.parse(row.data)})),pagination:{page:Math.min(page,pages),pageSize:size,total,pages}});
}

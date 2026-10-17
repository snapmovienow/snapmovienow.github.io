import {isServiceVerification} from './service-verification.mjs';
import {cleanPlaybackActivity} from './playback-activity.mjs';
const answer=(value,status=200)=>Response.json(value,{status});
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(x);
const text=(value,max)=>typeof value==='string'&&!/https?:\/\/|password=|username=|authorization|bearer /i.test(value)?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):null;
function ip(value){if(typeof value!=='string'||value.length>45)return null;if(/^\d+\.\d+\.\d+\.\d+$/.test(value))return value.split('.').every(x=>Number(x)<=255)?value:null;try{return value.includes(':')&&new URL('http://['+value+']/').hostname?'2a06:98c0:3600::103'===value?null:value:null}catch{return null}}
export function connectionTimezone(value){if(typeof value!=='string'||!value||value.length>100)return null;try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}catch{return null;}}
export function cleanConnectionClient(value){const timeZone=connectionTimezone(value?.timeZone);return {ip:ip(value?.ip),player:text(value?.player,160),isp:text(value?.isp,100),country:/^[A-Z]{2}$/.test(value?.country||'')?value.country:null,...(timeZone?{timeZone}:{}),...(value?.serviceCheck===true?{serviceCheck:true}:{})};}
// These fields come from the edge request, never from a customer's JSON body.
export function requestConnectionClient(request){return cleanConnectionClient({ip:request.cf?request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP'):null,player:request.headers.get('User-Agent'),isp:request.cf?.asOrganization,country:request.cf?.country,timeZone:isServiceVerification(request)?null:request.cf?.timezone,...(isServiceVerification(request)?{serviceCheck:true}:{})});}
export async function connectionIdentifier(accountId,lineId,id,lease){const raw=JSON.stringify([accountId,lineId,id,lease.sid,lease.request_id||'',lease.version]);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function recordConnectionLimit(store,user,body,used,now=Date.now()){
 const accountId=user?.resellerBridge?.accountId,lineId=user?.resellerBridge?.lineId;if(!identifier(accountId)||!identifier(lineId))return;
 const key='reseller-connection-limits:'+accountId,rows=(await store.get(key)||[]).filter(r=>r.at>now-30*86400000);
 const client=cleanConnectionClient(body.client),last=rows.at(-1);if(last&&last.lineId===lineId&&last.client.ip===client.ip&&last.at>now-10000)return;
 const parts=String(body.mediaKey||'').split('|'),activity=cleanPlaybackActivity(body.activity,parts[0]);
 rows.push({id:crypto.randomUUID(),lineId,username:user.username,at:now,used,max:3,client,stream:{title:activity?.title||null,type:['live','movie','series'].includes(parts[0])?parts[0]:null,output:/^[a-zA-Z0-9]{1,8}$/.test(parts[3]||'')?parts[3].toUpperCase():null}});while(rows.length>100||new TextEncoder().encode(JSON.stringify(rows)).byteLength>96000)rows.shift();await store.put(key,rows);
}
export async function updateConnectionQuality(store,leases,body,now=Date.now()){
 const lease=await leases.get(body.lease_id),m=body.metric;
 if(!lease||lease.until<=now||lease.sid!==body.sid||lease.request_id!==body.request_id||lease.uid!==body.uid||lease.version!==body.version)return answer({ok:true,ignored:true});
 const user=await store.get('user:'+lease.username),age=body.observation?.ageMs??0;
 if(!user||user.id!==lease.uid||user.version!==lease.version||user.status!=='active'||user.expiresAt&&user.expiresAt<=now||!Number.isSafeInteger(age)||age<0||age>45000)return answer({ok:true,ignored:true});
 if(!m||typeof m.report_id!=='string'||m.report_id.length>100||!Number.isSafeInteger(m.watchMs)||m.watchMs<0||m.watchMs>300000||!Number.isSafeInteger(m.stallMs)||m.stallMs<0||m.stallMs>m.watchMs||!Number.isSafeInteger(m.decoded)||m.decoded<0||m.decoded>100000||!Number.isSafeInteger(m.dropped)||m.dropped<0||m.dropped>m.decoded||!Number.isSafeInteger(m.errors)||m.errors<0||m.errors>100)return answer({ok:true,ignored:true});
 if(lease.qualityReport===m.report_id||m.watchMs<5000&&!m.errors||!m.decoded&&!m.errors&&!m.stallMs)return answer({ok:true,ignored:true});
 if(lease.qualityUpdatedAt>now-15000)return answer({ok:true,limited:true});
 const observedAt=now-age;if(lease.quality&&observedAt<=lease.quality.observedAt)return answer({ok:true,ignored:true});
 const stalls=m.watchMs?m.stallMs*100/m.watchMs:0,drops=m.decoded?m.dropped*100/m.decoded:0,level=m.errors||stalls>5||drops>5?'poor':stalls>2||drops>2?'fair':'good';
 const dimension=n=>Number.isSafeInteger(n)&&n>0&&n<=16384?n:null;
 lease.quality={level,observedAt,stallPercent:Math.round(stalls*100)/100,width:dimension(body.observation?.width),height:dimension(body.observation?.height)};lease.qualityReport=m.report_id;lease.qualityUpdatedAt=now;await leases.put(body.lease_id,lease);return answer({ok:true});
}
async function ownedUsers(store,accountId,now,activeOnly=true){const users=new Map();let startAfter;for(;;){const page=await store.list({prefix:'user:',limit:100,...(startAfter?{startAfter}:{})});for(const [key,u]of page){startAfter=key;const username=key.slice(5);if(u?.resellerBridge?.accountId===accountId&&identifier(u.resellerBridge.lineId)&&identifier(u.id)&&/^[a-z0-9_.@!-]{3,80}$/.test(username)&&(!activeOnly||u.status==='active'&&(!u.expiresAt||u.expiresAt>now)))users.set(u.id,{...u,username});}if(page.size<100)break;}return users;}
export async function closeResellerConnection(store,leases,body,now=Date.now()){
 if(!identifier(body.accountId)||!identifier(body.lineId)||!/^[a-f0-9]{64}$/.test(body.connectionId||''))return answer({error:'bridge_input'},400);
 const users=await ownedUsers(store,body.accountId,now);
 for(const [id,lease]of await leases.active({},now)){const user=users.get(lease.uid);if(!user||user.version!==lease.version||user.resellerBridge.lineId!==body.lineId)continue;if(await connectionIdentifier(body.accountId,body.lineId,id,lease)!==body.connectionId)continue;
  await leases.remove(id);if(lease.request_id){const key='playback:'+lease.sid,current=await store.get(key);if(current?.request_id===lease.request_id){current.cancelled??={};current.cancelled[lease.request_id]=now+120000;current.request_id=null;await store.put(key,current);}}return answer({ok:true,lineId:body.lineId,closed:true});
 }return answer({ok:true,lineId:body.lineId,closed:false});
}
export async function resellerLiveConnections(store,leases,b,now=Date.now()){
 const pageRequested=b.page??1,size=b.pageSize??10,q=b.q??'',mode=b.mode??'active',stream=b.stream??'',line=b.line??'',player=b.player??'',sort=b.sort??'duration',direction=b.direction??'desc';
 if(!identifier(b.accountId)||!Number.isSafeInteger(pageRequested)||pageRequested<1||pageRequested>1000000||![10,25,50,100].includes(size)||typeof q!=='string'||q.length>100||!['active','limits'].includes(mode)||typeof stream!=='string'||stream.length>200||typeof line!=='string'||line.length>80||typeof player!=='string'||player.length>160||!['quality','username','stream','player','isp','ip','duration','output'].includes(sort)||!['asc','desc'].includes(direction))return answer({error:'bridge_input'},400);
 const users=await ownedUsers(store,b.accountId,now),active=[],online=new Set();
 for(const [id,lease]of await leases.active({},now)){const user=users.get(lease.uid);if(!user||lease.version!==user.version)continue;online.add(user.id);const parts=String(lease.mediaKey||'').split('|'),activity=cleanPlaybackActivity(lease.activity,parts[0]),lineId=user.resellerBridge.lineId;
  active.push({connectionId:await connectionIdentifier(b.accountId,lineId,id,lease),lineId,username:user.username,stream:{title:activity?.title||null,type:['live','movie','series'].includes(parts[0])?parts[0]:null,output:/^[a-zA-Z0-9]{1,8}$/.test(parts[3]||'')?parts[3].toUpperCase():null},client:cleanConnectionClient(lease.client),access:lease.xtream?'xtream':'api',startedAt:Number.isSafeInteger(lease.startedAt)&&lease.startedAt>0&&lease.startedAt<=now?lease.startedAt:null,lastActivityAt:Math.min(now,lease.until-90000)>0?Math.min(now,lease.until-90000):null,quality:lease.quality&&lease.quality.observedAt>now-45000&&lease.quality.observedAt<=now?lease.quality:null,limit:null});
 }
 const logUsers=mode==='limits'?await ownedUsers(store,b.accountId,now,false):users,logLines=new Map([...logUsers.values()].map(user=>[user.resellerBridge.lineId,user.username]));
 const source=mode==='active'?active:(await store.get('reseller-connection-limits:'+b.accountId)||[]).filter(row=>row.at>now-30*86400000&&logLines.get(row.lineId)===row.username).slice(-100).map(row=>({connectionId:row.id,lineId:row.lineId,username:row.username,stream:row.stream,client:cleanConnectionClient(row.client),access:null,startedAt:null,lastActivityAt:row.at,quality:null,limit:{at:row.at,used:row.used,max:row.max}}));
 const streams=[...new Set(source.map(row=>row.stream.title).filter(Boolean))].sort().slice(0,100),players=[...new Set(source.map(row=>row.client.player).filter(Boolean))].sort().slice(0,100),lines=[...new Map(source.map(row=>[row.lineId,{lineId:row.lineId,username:row.username}])).values()].sort((a,b)=>a.username.localeCompare(b.username)).slice(0,100);
 const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),term=fold(q.trim()),quality={poor:0,fair:1,good:2};
 const value=row=>sort==='quality'?quality[row.quality?.level]??-1:sort==='username'?row.username:sort==='stream'?row.stream.title||'':sort==='duration'?row.startedAt?now-row.startedAt:mode==='limits'?row.lastActivityAt:-1:sort==='output'?row.stream.output||'':row.client[sort]||'';
 const rows=source.filter(row=>(!stream||row.stream.title===stream)&&(!line||row.lineId===line)&&(!player||row.client.player===player)&&(!term||fold([row.username,row.stream.title,...Object.values(row.client)].join(' ')).includes(term))).sort((a,b)=>{const x=value(a),y=value(b),order=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y));return (direction==='asc'?order:-order)||a.connectionId.localeCompare(b.connectionId)}),total=rows.length,pages=Math.max(1,Math.ceil(total/size)),page=Math.min(pageRequested,pages);
 return answer({ok:true,checkedAt:now,mode,connectionsUsed:active.length,linesOnline:online.size,rows:rows.slice((page-1)*size,page*size),facets:{streams,lines,players},pagination:{page,pageSize:size,total,pages}});
}

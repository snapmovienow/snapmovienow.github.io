import {panelSession} from './reseller.mjs';
import {cleanConnectionClient} from './connection-monitor.mjs';
export const ORIGIN_OWNER_SCOPE='be5f1fc0-d772-4683-9c6f-2bcdee5a4e70';
const decode=s=>String(s??'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v))).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,v)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[v]));
const plain=v=>decode(String(v??'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const safe=(v,n)=>{const text=plain(v);return text&&!/https?:\/\/|password=|username=|authorization|bearer /i.test(text)?text.slice(0,n):null;};
const answer=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function table(request,kind,filters){const rows=[];let total;for(let start=0;start<10000;){const q=new URLSearchParams({id:kind,...filters,draw:'1',start:String(start),length:'1000','search[value]':'','order[0][column]':'0','order[0][dir]':'asc'}),d=JSON.parse(await request('table?'+q)),n=Number(d.recordsFiltered);if(!Array.isArray(d.data)||!Number.isSafeInteger(n)||n<0||n>10000||total!==undefined&&n!==total)throw Error('panel_origin_format');total=n;rows.push(...d.data);if(rows.length===total)return rows;if(!d.data.length||rows.length>total)throw Error('panel_origin_incomplete');start+=d.data.length;}throw Error('panel_origin_size');}
// All rows visible to an already configured provider. Never changes CCF accounts.
export async function readOriginSnapshot({username,password,base,fetcher=fetch}){
 const {request}=await panelSession(username,password,base,{timeoutMs:20000,maxBytes:4000000,fetcher});
 const inventory=await table(request,'lines',{reseller:'',filter:''}),users=[];
 for(const row of inventory){if(!Array.isArray(row)||row.length<9)throw Error('panel_origin_format');const sourceId=plain(row[0]),username=plain(row[1]).toLowerCase(),connections=Number(plain(row[7]));if(!/^\d{1,20}$/.test(sourceId)||!/^[a-z0-9_.@-]{3,80}$/.test(username)||!Number.isSafeInteger(connections)||connections<0||connections>100)throw Error('panel_origin_format');users.push({sourceId,username,connections,reseller:safe(row[3],100)});}
 if(new Set(users.map(u=>u.sourceId)).size!==users.length||new Set(users.map(u=>u.username)).size!==users.length)throw Error('panel_origin_ambiguous');
 const owned=new Map(users.map(u=>[u.sourceId,u])),rows=[];let sessions;try{sessions=await table(request,'live_connections',{user:'',line:'',stream:''});}catch{return {checkedAt:Date.now(),users:users.filter(u=>u.connections>0),rows,detailsAvailable:false};}
 for(const row of sessions){if(!Array.isArray(row)||row.length<10)throw Error('panel_origin_format');const line=String(row[2]).match(/href=["'](?:\.\/)?line(?:\.php)?\?(?:id|edit)=(\d+)["']/i),u=line&&owned.get(line[1]);if(!u)continue;const id=plain(row[0]);if(!/^\d{1,20}$/.test(id))throw Error('panel_origin_format');
  const duration=plain(row[7]),d=duration.match(/^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/i),seconds=d&&d[0]?Number(d[1]||0)*86400+Number(d[2]||0)*3600+Number(d[3]||0)*60+Number(d[4]||0):null;
  const rawIp=plain(row[6]).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0]||null,country=String(row[6]).match(/flag-icon-([a-z]{2})\b/i)?.[1]?.toUpperCase()||null;
  rows.push({sourceSessionId:id,sourceId:u.sourceId,username:u.username,title:safe(row[3],200),client:cleanConnectionClient({player:safe(row[4],160),isp:safe(row[5],100),ip:rawIp,country}),durationSeconds:Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=31536000?seconds:null,output:safe(row[8],40)});
 }
 if(new Set(rows.map(r=>r.sourceSessionId)).size!==rows.length)throw Error('panel_origin_ambiguous');
 return {checkedAt:Date.now(),users:users.filter(u=>u.connections>0),rows:rows.filter(r=>owned.get(r.sourceId).connections>0),detailsAvailable:true};
}
// Each provider has an isolated cache; viewers coalesce into one background read.
export async function originSnapshotResponse(instance,load,now=Date.now()){
 const head=await instance.state.storage.get('snapshot');let saved=head;if(head?.partCount){const parts=[];for(let n=0;n<head.partCount;n++)parts.push(await instance.state.storage.get('snapshot:'+head.checkedAt+':'+n));try{saved=JSON.parse(parts.join(''));}catch{saved=null;}}const retry=await instance.state.storage.get('retryAt')||0;
 if((!saved||saved.checkedAt<now-20000)&&!instance.refreshingOrigin&&retry<=now){
  instance.refreshingOrigin=Promise.resolve().then(load).then(async value=>{const raw=JSON.stringify(value),parts=Array.from({length:Math.ceil(raw.length/20000)},(_,i)=>raw.slice(i*20000,(i+1)*20000));await instance.state.storage.transaction(async tx=>{for(let n=0;n<parts.length;n++)await tx.put('snapshot:'+value.checkedAt+':'+n,parts[n]);await tx.put('snapshot',{checkedAt:value.checkedAt,partCount:parts.length});if(head?.partCount&&head.checkedAt!==value.checkedAt)for(let n=0;n<head.partCount;n++)await tx.delete('snapshot:'+head.checkedAt+':'+n);await tx.delete('retryAt');});}).catch(async()=>{await instance.state.storage.put('retryAt',Date.now()+20000);}).finally(()=>{instance.refreshingOrigin=null;});
  instance.state.waitUntil(instance.refreshingOrigin);
 }
 return saved?.checkedAt>now-45000&&saved.checkedAt<=now?answer({ok:true,...saved}):answer({error:instance.refreshingOrigin?'bridge_origin_loading':'bridge_origin_unavailable'},503);
}
export function createAllOriginConnections({sources,snapshot}){return async(env,body)=>{
 // The primary operator signer already has provider-export authority. A reseller
 // signer cannot enumerate any other panel, even by forging the request body.
 if(body.accountId!==ORIGIN_OWNER_SCOPE)return answer({error:'bridge_origin_scope'},403);
 let providers;try{providers=(await sources(env)).filter(p=>p.mode==='panel');if(providers.length>32||new Set(providers.map(p=>p.source)).size!==providers.length)throw Error('source_limit');}catch{return answer({error:'bridge_origin_unavailable'},503);}
 const results=[];
 for(let at=0;at<providers.length;at+=4)results.push(...await Promise.all(providers.slice(at,at+4).map(async p=>{
  const label=safe(p.name||p.username,100)||'Panel CCF';
  try{const origin=new URL(p.origin||p.url||'http://ccf.center:8444').origin,r=await snapshot(env,p.source);if(!r.ok)throw Error('loading');const data=await r.json();if(!Number.isSafeInteger(data.checkedAt)||Math.abs(Date.now()-data.checkedAt)>45000||!Array.isArray(data.users)||!Array.isArray(data.rows)||data.users.length>10000||data.rows.length>10000)throw Error('invalid');return {source:p.source,name:label,origin,state:'live',checkedAt:data.checkedAt,users:data.users,rows:data.rows,detailsAvailable:data.detailsAvailable===true};}
  catch{return {source:p.source,name:label,state:'unavailable'};}
 })));
 return answer({ok:true,source:'ccf',checkedAt:Date.now(),providers:results,deletionSafe:false});
};}

// Private BoxPanel state lives in a dedicated instance of the existing SQLite
// Durable Object binding. It never uses customer, provider or playback keys.
import {validateServerUrl} from './reseller.mjs';
import {initBoxApps,boxCatalog,boxApp,boxAppOperation,boxImageUsage} from './boxpanel-apps.mjs';
export const BOX_IMAGE_BYTES=262144;
const STORAGE_LIMIT=16*1024*1024;
const fail=(status,error)=>{throw Object.assign(Error(error),{status});};
const text=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\x00-\x1f]/.test(value))fail(400,'box_input');return value.trim();};
const row=(sql,query,...args)=>[...sql.exec(query,...args)][0];
function image(value){
 if(typeof value!=='string'||value.length>Math.ceil(BOX_IMAGE_BYTES/3)*4+40)fail(413,'box_image');
 const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match||match[2].length%4)fail(400,'box_image');
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),x=>x.charCodeAt(0));}catch{fail(400,'box_image');}
 if(bytes.length>BOX_IMAGE_BYTES)fail(413,'box_image');
 const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
 const valid=match[1]==='png'?bytes.length>=33&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)&&ascii(12,16)==='IHDR':match[1]==='jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217:bytes.length>=20&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&new DataView(bytes.buffer).getUint32(4,true)+8===bytes.length;
 if(!valid)fail(400,'box_image');return value;
}
function init(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS bp_workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS bp_dns (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, revision INTEGER NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS bp_ads (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, duration INTEGER NOT NULL, revision INTEGER NOT NULL)');
 sql.exec('CREATE INDEX IF NOT EXISTS bp_dns_account ON bp_dns(account_id)');
 sql.exec('CREATE INDEX IF NOT EXISTS bp_ads_account ON bp_ads(account_id)');
 initBoxApps(sql);
}
// scope is constructed by the Worker after owner or reseller authentication.
// Never pass a scope from a public JSON body.
export function boxpanelOperation(state,b,scope){
 try{return state.storage.transactionSync(()=>{
  const sql=state.storage.sql;init(sql);const owner=scope.role==='owner',action=b.action;
  if(action==='boxpanel-catalog')return {catalog:boxCatalog(sql).filter(d=>d.enabled).map(({revision,...design})=>design)};
  if(owner&&action==='boxpanel-list')return {workspaces:[...sql.exec('SELECT w.*,a.state AS appState,a.suspended AS appSuspended FROM bp_workspaces w LEFT JOIN bp_apps a ON a.account_id=w.id ORDER BY w.name,w.id')],candidates:scope.candidates||[],catalog:boxCatalog(sql),storageLimit:STORAGE_LIMIT};
  if(owner&&action==='boxpanel-design-save')return boxAppOperation(sql,b,{owner});
  if(owner&&action==='boxpanel-workspace-save'){
   if(typeof b.accountId!=='string'||!scope.candidates?.includes(b.accountId))fail(400,'box_account');
   const old=row(sql,'SELECT * FROM bp_workspaces WHERE id=?',b.accountId);
   if(Number(b.revision)!==(old?.revision||0))fail(409,'box_changed');
   if(!['active','suspended'].includes(b.status))fail(400,'box_input');
   sql.exec('INSERT INTO bp_workspaces(id,name,status,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,revision=excluded.revision',b.accountId,text(b.name),b.status,(old?.revision||0)+1);
   return {ok:true};
  }
  const accountId=owner?b.accountId:scope.accountId;
  if(typeof accountId!=='string'||accountId.length>80)fail(403,'box_scope');
  const workspace=row(sql,'SELECT * FROM bp_workspaces WHERE id=?',accountId);
  if(!workspace)fail(404,'box_not_enabled');if(!owner&&workspace.status!=='active')fail(403,'box_suspended');
  const kind=action?.startsWith('boxpanel-dns-')?'dns':action?.startsWith('boxpanel-ads-')?'ads':null;
  if(action==='boxpanel-open')return {workspace,catalog:boxCatalog(sql),app:boxApp(sql,accountId),dns:[...sql.exec('SELECT * FROM bp_dns WHERE account_id=? ORDER BY id',accountId)],ads:[...sql.exec('SELECT id,title,duration,revision FROM bp_ads WHERE account_id=? ORDER BY id',accountId)],limits:{dns:3,ads:8,imageBytes:BOX_IMAGE_BYTES}};
  const appResult=boxAppOperation(sql,b,{owner,accountId,workspace,image,storageLimit:STORAGE_LIMIT});if(appResult)return appResult;
  if(!kind)fail(403,'box_action');
  // Table names come only from the fixed two-value kind above.
  const table=kind==='dns'?'bp_dns':'bp_ads',id=b.id;
  if(id!==undefined&&(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail(400,'box_input');
  const old=id?row(sql,`SELECT * FROM ${table} WHERE id=? AND account_id=?`,id,accountId):null;
  if(id&&!old)fail(404,'box_missing');
  if(action==='boxpanel-ads-image'){if(!old)fail(404,'box_missing');return {data:old.data};}
  if(!action.endsWith('-save')&&!action.endsWith('-delete'))fail(403,'box_action');
  if(Number(b.revision)!==(old?.revision||0))fail(409,'box_changed');
  if(action.endsWith('-delete')){if(!old)fail(404,'box_missing');sql.exec(`DELETE FROM ${table} WHERE id=? AND account_id=?`,id,accountId);return {ok:true};}
  if(!old&&row(sql,`SELECT COUNT(*) AS n FROM ${table} WHERE account_id=?`,accountId).n>=(kind==='dns'?3:8))fail(409,'box_quota');
  const title=text(b.title),next=id||crypto.randomUUID(),revision=(old?.revision||0)+1;
  if(kind==='dns'){
   let url;try{if(typeof b.url!=='string'||b.url.length>2048)throw Error();url=validateServerUrl(b.url,true);}catch{fail(400,'box_dns');}
   sql.exec('INSERT INTO bp_dns(id,account_id,title,url,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,revision=excluded.revision',next,accountId,title,url,revision);
  }else{
   const data=b.data===undefined&&old?old.data:image(b.data),duration=Number(b.duration);
   if(!Number.isInteger(duration)||duration<3||duration>120)fail(400,'box_duration');
   const used=boxImageUsage(sql);
   if(used-(old?.data.length||0)+data.length>STORAGE_LIMIT)fail(409,'box_capacity');
   sql.exec('INSERT INTO bp_ads(id,account_id,title,data,duration,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,data=excluded.data,duration=excluded.duration,revision=excluded.revision',next,accountId,title,data,duration,revision);
  }
  return {ok:true,id:next};
 });}catch(e){return {error:e.status?e.message:'box_unavailable',status:e.status||503};}
}
export async function boxpanelFetch(state,req){const {body,scope}=await req.json(),result=boxpanelOperation(state,body,scope);const {status=200,...value}=result;return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

import {BOXPANEL_DESIGNS} from '../../boxpanel-catalog.js';
import {initBoxDelivery,boxDelivery,queueBoxBuild} from './boxpanel-delivery.mjs';
const fail=(status,error)=>{throw Object.assign(Error(error),{status});};
const row=(sql,query,...args)=>[...sql.exec(query,...args)][0];
const checkRevision=(value,old)=>{if(!Number.isInteger(value)||value!==(old?.revision||0))fail(409,'box_changed');};
const color=value=>{if(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value))fail(400,'box_colors');return value.toLowerCase();};
export function initBoxApps(sql){
 sql.exec("CREATE TABLE IF NOT EXISTS bp_apps (account_id TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, design TEXT NOT NULL, accent TEXT NOT NULL, background TEXT NOT NULL, logo TEXT NOT NULL, state TEXT NOT NULL, suspended INTEGER NOT NULL, revision INTEGER NOT NULL, approved_revision INTEGER NOT NULL, approved_config TEXT NOT NULL, note TEXT NOT NULL, updated_at INTEGER NOT NULL)");
 sql.exec('CREATE TABLE IF NOT EXISTS bp_designs (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, revision INTEGER NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS bp_app_styles (account_id TEXT PRIMARY KEY, config TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS bp_app_editors (account_id TEXT PRIMARY KEY, opened INTEGER NOT NULL)');
 initBoxDelivery(sql);
}
export function boxCatalog(sql){
 return BOXPANEL_DESIGNS.map(design=>{const setting=row(sql,'SELECT enabled,revision FROM bp_designs WHERE id=?',design.id);return {...design,enabled:setting?setting.enabled===1:true,revision:setting?.revision||0};});
}
const defaultStyle=design=>({wallpaper:BOXPANEL_DESIGNS.find(d=>d.id===design)?.wallpaper||'aurora',density:'comfortable',welcome:''});
function appStyle(sql,accountId,design){const stored=row(sql,'SELECT config FROM bp_app_styles WHERE account_id=?',accountId);return stored?JSON.parse(stored.config):defaultStyle(design);}
export function validateBoxStyle(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['wallpaper','density','welcome'].includes(k))||!['aurora','midnight','sunset','ocean'].includes(value.wallpaper)||!['comfortable','compact'].includes(value.density)||typeof value.welcome!=='string'||value.welcome.trim().length>80||/[\x00-\x1f]/.test(value.welcome))fail(400,'box_app_style');
 return {wallpaper:value.wallpaper,density:value.density,welcome:value.welcome.trim()};
}
export function boxApp(sql,accountId){
 const app=row(sql,'SELECT * FROM bp_apps WHERE account_id=?',accountId);if(!app)return null;
 const approved=app.approved_config?JSON.parse(app.approved_config):null;
 delete app.approved_config;delete app.account_id;
 const editor=row(sql,'SELECT opened FROM bp_app_editors WHERE account_id=?',accountId);
 return {...app,style:appStyle(sql,accountId,app.design),editorOpen:editor?editor.opened===1:app.approved_revision===0,suspended:app.suspended===1,approved:approved?{name:approved.name,design:approved.design,accent:approved.accent,background:approved.background,style:approved.style||defaultStyle(approved.design),revision:app.approved_revision}:null,...boxDelivery(sql,accountId)};
}
export function boxImageUsage(sql){
 return row(sql,'SELECT COALESCE(SUM(LENGTH(config)),0) AS n FROM bp_app_styles').n+
  row(sql,'SELECT COALESCE(SUM(LENGTH(data)),0) AS n FROM bp_ads').n+
  row(sql,'SELECT COALESCE(SUM(LENGTH(logo)+LENGTH(approved_config)),0) AS n FROM bp_apps').n+
  row(sql,'SELECT COALESCE(SUM(LENGTH(config)),0) AS n FROM bp_builds').n+
  row(sql,'SELECT COALESCE(SUM(LENGTH(config)),0) AS n FROM bp_releases').n;
}
// Called inside the parent SQLite transaction, after the workspace has been
// selected from the verified owner/reseller scope.
export function boxAppOperation(sql,b,{owner,accountId,workspace,image,storageLimit}){
 const action=b.action;
 if(action==='boxpanel-design-save'){
  if(!owner)fail(403,'box_scope');
  if(!BOXPANEL_DESIGNS.some(d=>d.id===b.design)||typeof b.enabled!=='boolean')fail(400,'box_design');
  const old=row(sql,'SELECT * FROM bp_designs WHERE id=?',b.design);checkRevision(b.revision,old);
  sql.exec('INSERT INTO bp_designs(id,enabled,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision',b.design,b.enabled?1:0,(old?.revision||0)+1);return {ok:true};
 }
 if(!['boxpanel-app-save','boxpanel-app-submit','boxpanel-app-review','boxpanel-app-editor','boxpanel-app-build'].includes(action))return null;
 if(['boxpanel-app-review','boxpanel-app-editor','boxpanel-app-build'].includes(action)&&!owner)fail(403,'box_scope');
 const old=row(sql,'SELECT * FROM bp_apps WHERE account_id=?',accountId);checkRevision(b.revision,old);
 const revision=(old?.revision||0)+1,now=Date.now();
 const setEditor=opened=>sql.exec('INSERT INTO bp_app_editors(account_id,opened) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET opened=excluded.opened',accountId,opened?1:0);
 if(action==='boxpanel-app-build'){
  if(!old?.approved_revision||old.suspended||workspace.status!=='active')fail(409,'box_app_state');
  const delivery=boxDelivery(sql,accountId);if(delivery.build&&['queued','building'].includes(delivery.build.status))fail(409,'box_app_state');
  queueBoxBuild(sql,accountId,old.approved_revision,old.approved_config,boxImageUsage(sql),storageLimit);
  sql.exec('UPDATE bp_apps SET revision=?,updated_at=? WHERE account_id=?',revision,now,accountId);return {ok:true,app:boxApp(sql,accountId)};
 }
 if(action==='boxpanel-app-editor'){
  if(!old)fail(404,'box_app_missing');
  if(typeof b.enabled!=='boolean')fail(400,'box_input');
  if(boxApp(sql,accountId).editorOpen===b.enabled)fail(409,'box_app_state');
  setEditor(b.enabled);sql.exec('UPDATE bp_apps SET revision=?,updated_at=? WHERE account_id=?',revision,now,accountId);
  return {ok:true,app:boxApp(sql,accountId)};
 }
 if(!owner&&old&&boxApp(sql,accountId).editorOpen===false)fail(403,'box_app_locked');
 if(action==='boxpanel-app-save'){
  if(!owner&&old?.suspended)fail(403,'box_app_suspended');
  const design=boxCatalog(sql).find(d=>d.id===b.design);if(!design?.enabled)fail(400,'box_design');
  if(typeof b.name!=='string'||b.name.trim().length<2||b.name.trim().length>40||/[\x00-\x1f]/.test(b.name))fail(400,'box_app_name');
  const logo=b.logo===null?'':b.logo===undefined?old?.logo||'':image(b.logo),accent=color(b.accent),background=color(b.background);
  const style=JSON.stringify(b.style===undefined?appStyle(sql,accountId,b.design):validateBoxStyle(b.style)),previousStyle=row(sql,'SELECT config FROM bp_app_styles WHERE account_id=?',accountId)?.config||'';
  if(boxImageUsage(sql)-(old?.logo.length||0)+logo.length-previousStyle.length+style.length>storageLimit)fail(409,'box_capacity');
  sql.exec("INSERT INTO bp_apps(account_id,id,name,design,accent,background,logo,state,suspended,revision,approved_revision,approved_config,note,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET name=excluded.name,design=excluded.design,accent=excluded.accent,background=excluded.background,logo=excluded.logo,state='draft',revision=excluded.revision,updated_at=excluded.updated_at",accountId,old?.id||crypto.randomUUID(),b.name.trim(),b.design,accent,background,logo,old?.suspended||0,revision,old?.approved_revision||0,old?.approved_config||'',old?.note||'',now);
  sql.exec('INSERT INTO bp_app_styles(account_id,config) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config',accountId,style);
  return {ok:true,app:boxApp(sql,accountId)};
 }
 if(!old)fail(404,'box_app_missing');
 if(action==='boxpanel-app-submit'){
  if(old.suspended||workspace.status!=='active')fail(403,'box_app_suspended');
  if(old.state!=='draft')fail(409,'box_app_state');
  if(!boxCatalog(sql).find(d=>d.id===old.design)?.enabled)fail(400,'box_design');
  sql.exec("UPDATE bp_apps SET state='pending',note='',revision=?,updated_at=? WHERE account_id=?",revision,now,accountId);return {ok:true,app:boxApp(sql,accountId)};
 }
 if(b.decision==='approve'){
  if(old.state!=='pending'||old.suspended||workspace.status!=='active')fail(409,'box_app_state');
  if(!boxCatalog(sql).find(d=>d.id===old.design)?.enabled)fail(400,'box_design');
  const approved=JSON.stringify({id:old.id,name:old.name,design:old.design,designVersion:2,style:appStyle(sql,accountId,old.design),accent:old.accent,background:old.background,logo:old.logo});
  if(boxImageUsage(sql)-old.approved_config.length+approved.length>storageLimit)fail(409,'box_capacity');
  sql.exec("UPDATE bp_apps SET state='approved',approved_revision=?,approved_config=?,note='',revision=?,updated_at=? WHERE account_id=?",revision,approved,revision,now,accountId);setEditor(false);
  queueBoxBuild(sql,accountId,revision,approved,boxImageUsage(sql),storageLimit);
 }else if(b.decision==='return'){
  if(old.state!=='pending')fail(409,'box_app_state');
  if(typeof b.note!=='string'||!b.note.trim()||b.note.length>300||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(b.note))fail(400,'box_review_note');
  sql.exec("UPDATE bp_apps SET state='draft',note=?,revision=?,updated_at=? WHERE account_id=?",b.note.trim(),revision,now,accountId);setEditor(true);
 }else if(b.decision==='suspend'||b.decision==='resume'){
  if(Boolean(old.suspended)===(b.decision==='suspend'))fail(409,'box_app_state');
  sql.exec('UPDATE bp_apps SET suspended=?,revision=?,updated_at=? WHERE account_id=?',b.decision==='suspend'?1:0,revision,now,accountId);
 }else fail(400,'box_app_state');
 return {ok:true,app:boxApp(sql,accountId)};
}

const row=(sql,q,...args)=>[...sql.exec(q,...args)][0];
const fail=(status,error)=>{throw Object.assign(Error(error),{status});};
const UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const BOX_BUILD_REPO='juancanta89-tech/SnapTvNow';
export const boxPackage=id=>'com.snaptvnow.box.a'+id.replaceAll('-','');
export const boxReleaseUrl=(id,code)=>`https://github.com/${BOX_BUILD_REPO}/releases/download/boxpanel-${id}-v${code}/app-release.apk`;
export function initBoxDelivery(sql){
 sql.exec("CREATE TABLE IF NOT EXISTS bp_builds (account_id TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,version_code INTEGER NOT NULL,approved_revision INTEGER NOT NULL,status TEXT NOT NULL,config TEXT NOT NULL,run_id TEXT NOT NULL,run_attempt INTEGER NOT NULL,source_sha TEXT NOT NULL,lease_until INTEGER NOT NULL)");
 sql.exec('CREATE TABLE IF NOT EXISTS bp_releases (account_id TEXT PRIMARY KEY,version_code INTEGER NOT NULL,config TEXT NOT NULL,url TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,certificate TEXT NOT NULL,source_sha TEXT NOT NULL)');
}
export function boxDelivery(sql,accountId){
 const job=row(sql,'SELECT status,version_code,lease_until FROM bp_builds WHERE account_id=?',accountId),release=row(sql,'SELECT version_code,url,sha256,size,source_sha FROM bp_releases WHERE account_id=?',accountId);
 return {apkReady:Boolean(release),build:job?{status:job.status==='building'&&job.lease_until<Date.now()?'failed':job.status,versionCode:job.version_code}:null,release:release?{versionCode:release.version_code,versionName:'1.0.'+release.version_code,url:release.url,sha256:release.sha256,size:release.size,sourceSha:release.source_sha}:null};
}
// At most one build and one published snapshot per reseller. A newer approval
// replaces the queued build; the installed release remains intact until publish.
export function queueBoxBuild(sql,accountId,approvedRevision,config,used,limit){
 const old=row(sql,'SELECT * FROM bp_builds WHERE account_id=?',accountId),published=row(sql,'SELECT version_code FROM bp_releases WHERE account_id=?',accountId);
 if(used-(old?.config.length||0)+config.length>limit)fail(409,'box_capacity');
 const code=Math.max(old?.version_code||0,published?.version_code||0)+1;if(code>2100000000)fail(409,'box_build_version');
 sql.exec("INSERT INTO bp_builds(account_id,id,version_code,approved_revision,status,config,run_id,run_attempt,source_sha,lease_until) VALUES(?,?,?,?,'queued',?,'',0,'',0) ON CONFLICT(account_id) DO UPDATE SET id=excluded.id,version_code=excluded.version_code,approved_revision=excluded.approved_revision,status='queued',config=excluded.config,run_id='',run_attempt=0,source_sha='',lease_until=0",accountId,crypto.randomUUID(),code,approvedRevision,config);
}
const eligible="SELECT b.*,a.id AS app_id FROM bp_builds b JOIN bp_apps a ON a.account_id=b.account_id JOIN bp_workspaces w ON w.id=b.account_id WHERE w.status='active' AND a.suspended=0 AND a.approved_revision=b.approved_revision";
export function boxDeliveryOperation(sql,b,scope){
 if(scope.role==='queue-public'){
  if(b.action!=='boxpanel-build-pending')fail(403,'box_scope');
  return {pending:Boolean(row(sql,eligible+" AND b.status='queued' LIMIT 1"))};
 }
 if(scope.role==='builder'){
  if(!['boxpanel-build-claim','boxpanel-build-complete','boxpanel-build-fail'].includes(b.action))fail(403,'box_scope');
  if(b.action==='boxpanel-build-claim'){
   let job=row(sql,eligible+" AND b.status='building' AND b.run_id=? AND b.run_attempt=? AND b.lease_until>? LIMIT 1",scope.runId,scope.runAttempt,Date.now());
   if(!job)job=row(sql,eligible+" AND b.status='queued' ORDER BY b.version_code,b.id LIMIT 1");
   if(!job)return {job:null};
   sql.exec("UPDATE bp_builds SET status='building',run_id=?,run_attempt=?,source_sha=?,lease_until=? WHERE id=?",scope.runId,scope.runAttempt,scope.sha,Date.now()+90*60*1000,job.id);
   const config=JSON.parse(job.config);return {job:{id:job.id,appId:job.app_id,versionCode:job.version_code,config:{...config,appId:job.app_id,packageName:boxPackage(job.app_id),versionCode:job.version_code,versionName:'1.0.'+job.version_code}}};
  }
  const job=row(sql,eligible+" AND b.id=? AND b.status='building' AND b.run_id=? AND b.run_attempt=? AND b.source_sha=? AND b.lease_until>?",b.jobId,scope.runId,scope.runAttempt,scope.sha,Date.now());
  if(!job)fail(409,'box_build_changed');
  if(b.action==='boxpanel-build-fail'){sql.exec("UPDATE bp_builds SET status='failed',lease_until=0 WHERE id=?",job.id);return {ok:true};}
  if(b.versionCode!==job.version_code||b.packageName!==boxPackage(job.app_id)||b.url!==boxReleaseUrl(job.app_id,job.version_code)||!/^[a-f0-9]{64}$/.test(b.sha256||'')||!/^[a-f0-9]{64}$/.test(b.certificate||'')||!Number.isSafeInteger(b.size)||b.size<1||b.size>200*1024*1024||b.sourceSha!==scope.sha)fail(400,'box_build_metadata');
  const old=row(sql,'SELECT * FROM bp_releases WHERE account_id=?',job.account_id);
  if(old&&(old.version_code>=job.version_code||old.certificate!==b.certificate))fail(409,'box_build_signature');
  sql.exec('INSERT INTO bp_releases(account_id,version_code,config,url,sha256,size,certificate,source_sha) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET version_code=excluded.version_code,config=excluded.config,url=excluded.url,sha256=excluded.sha256,size=excluded.size,certificate=excluded.certificate,source_sha=excluded.source_sha',job.account_id,job.version_code,job.config,b.url,b.sha256,b.size,b.certificate,b.sourceSha);
  sql.exec("UPDATE bp_builds SET status='ready',config='',lease_until=0 WHERE id=?",job.id);return {ok:true};
 }
 if(scope.role!=='app-client')return null;
 if(!UUID.test(b.appId||'')||!['config','logo','ad','update'].includes(b.resource))fail(404,'box_client_missing');
 const app=row(sql,'SELECT a.*,w.status AS workspace_status FROM bp_apps a JOIN bp_workspaces w ON w.id=a.account_id WHERE a.id=?',b.appId),release=app&&row(sql,'SELECT * FROM bp_releases WHERE account_id=?',app.account_id);
 if(!app||!release||app.suspended||app.workspace_status!=='active')return {active:false,status:403};
 const brand=JSON.parse(release.config),base=`https://api.snaptvnow.com/api/boxpanel/client/${app.id}`;
 const update={versionCode:release.version_code,versionName:'1.0.'+release.version_code,url:release.url,sha256:release.sha256,size:release.size,notes:'Nueva versión aprobada por el administrador.'};
 if(b.resource==='update')return {update};
 if(b.resource==='logo'){if(!brand.logo)fail(404,'box_image_missing');return {data:brand.logo};}
 if(b.resource==='ad'){const ad=row(sql,'SELECT data FROM bp_ads WHERE account_id=? AND id=?',app.account_id,b.imageId);if(!ad)fail(404,'box_image_missing');return {data:ad.data};}
 return {active:true,packageName:boxPackage(app.id),app:{id:app.id,name:brand.name,design:brand.design,accent:brand.accent,background:brand.background,style:brand.style||{wallpaper:'aurora',density:'comfortable',welcome:''},logo:brand.logo?base+'/logo':''},servers:[...sql.exec('SELECT url FROM bp_dns WHERE account_id=? ORDER BY id',app.account_id)].map(x=>x.url.replace(/\/$/,'')),slides:[...sql.exec('SELECT id,duration,revision FROM bp_ads WHERE account_id=? ORDER BY id',app.account_id)].map(x=>({id:x.id,seconds:x.duration,revision:x.revision})),update};
}

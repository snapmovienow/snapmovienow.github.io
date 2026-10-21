import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createBoxBuildVerifier,BOX_BUILD_AUDIENCE} from '../cloudflare-worker/src/boxpanel-build-auth.mjs';
import {createBoxClient} from '../cloudflare-worker/src/boxpanel-client.mjs';
import {boxPackage,boxReleaseUrl} from '../cloudflare-worker/src/boxpanel-delivery.mjs';
const require=createRequire(new URL('../cloudflare-worker/package.json',import.meta.url));
const {build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const code=await build({entryPoints:['cloudflare-worker/src/index.js'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
const options={name:'box-delivery-test',modules:true,script:code.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],durableObjects:{PLAYBACK_SESSIONS:{className:'PlaybackSession',useSQLite:true},BACKUP_RECOVERY:{className:'BackupRecovery',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true}},durableObjectsPersist:false,outboundService:()=>{throw Error('Unexpected network');}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'local-fixture',alg:'RS256',use:'sig'};
const sha='1'.repeat(40),now=Math.floor(Date.now()/1000);
const claims={iss:'https://token.actions.githubusercontent.com',aud:BOX_BUILD_AUDIENCE,repository:'juancanta89-tech/SnapTvNow',repository_id:'1388310940',repository_owner_id:'301551773',ref:'refs/heads/main',environment:'production',workflow_ref:'juancanta89-tech/SnapTvNow/.github/workflows/boxpanel-build.yml@refs/heads/main',event_name:'workflow_dispatch',runner_environment:'github-hosted',run_id:'100',run_attempt:'1',sha,iat:now,nbf:now-1,exp:now+300};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function jwt(change={}){const input=encode({alg:'RS256',kid:jwk.kid})+'.'+encode({...claims,...change});return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input))).toString('base64url');}
let keyReads=0;const verify=createBoxBuildVerifier({fetcher:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');keyReads++;return Response.json({keys:[jwk]});}});
const good=await jwt();assert.equal((await verify(good)).role,'builder');assert.equal((await verify(good)).runId,'100');assert.equal(keyReads,1);
for(const patch of [{iss:'https://attacker.example'},{aud:'wrong'},{repository:'fork/SnapTvNow'},{repository_id:'9'},{repository_owner_id:'9'},{ref:'refs/heads/unreviewed'},{environment:'preview'},{workflow_ref:'juancanta89-tech/SnapTvNow/.github/workflows/other.yml@refs/heads/main'},{event_name:'pull_request'},{runner_environment:'self-hosted'},{exp:now-1},{iat:now+600},{nbf:now+600},{exp:now+10000},{run_id:'forged'},{sha:'invalid'}])await assert.rejects(verify(await jwt(patch)),/box_build_auth/);
await assert.rejects(verify(good.slice(0,-8)+'aaaaaaaa'),/box_build_auth/);
try{
 const ns=await mf.getDurableObjectNamespace('PLAYBACK_SESSIONS'),name='__smn_boxpanel_v1',getBox=()=>ns.get(ns.idFromName(name));
 const raw=async(body,scope)=>getBox().fetch('https://private/boxpanel/private',{method:'POST',body:JSON.stringify({body,scope})});
 const a='reseller-fixture-a',b='reseller-fixture-b',owner={role:'owner',candidates:[a,b]},request=async(body,scope=owner)=>{const r=await raw(body,scope);return {status:r.status,data:await r.json()};};
 const opened=id=>request({action:'boxpanel-open',accountId:id});
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeQAAAAASUVORK5CYII=';
 for(const [id,label,design] of [[a,'Marca A','classic'],[b,'Marca B','cinema']]){
  assert.equal((await request({action:'boxpanel-workspace-save',accountId:id,name:label,status:'active',revision:0})).status,200);
  const actor={role:'reseller',accountId:id};
  assert.equal((await request({action:'boxpanel-app-save',accountId:id,name:label,design,logo:png,accent:'#16d4cd',background:'#07151f',revision:0},actor)).status,200);
  assert.equal((await request({action:'boxpanel-app-submit',revision:1},actor)).status,200);
  assert.equal((await request({action:'boxpanel-app-review',accountId:id,decision:'approve',revision:2})).status,200);
  assert.equal((await request({action:'boxpanel-dns-save',title:'Own DNS',url:'https://'+id+'.example.com',revision:0},actor)).status,200);
  assert.equal((await request({action:'boxpanel-ads-save',title:label,data:png,duration:120,revision:0},actor)).status,200);
 }
 const appA=(await opened(a)).data.app,appB=(await opened(b)).data.app;assert.notEqual(boxPackage(appA.id),boxPackage(appB.id));assert.equal(appA.apkReady,false);assert.equal(appA.build.status,'queued');
 let githubAsset=null,digestValid=true;
 const client=createBoxClient({call:(_env,body,scope)=>raw(body,scope),verify,fetcher:async url=>{assert.ok(url.startsWith('https://api.github.com/repos/juancanta89-tech/SnapTvNow/releases/tags/boxpanel-'));return Response.json({...githubAsset,assets:githubAsset.assets.map(asset=>({...asset,digest:digestValid?asset.digest:'sha256:'+'0'.repeat(64)}))});}});
 const http=async(path,{body,auth=good,origin}={})=>{const r=await client(new Request('https://api.snaptvnow.com/api/boxpanel/'+path,body?{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(body)}:{}),{});const content=r.headers.get('Content-Type');return {status:r.status,data:content?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};};
 assert.deepEqual((await http('builds/pending')).data,{pending:true});
 assert.equal((await http('builds/claim',{body:{},auth:''})).status,401);
 assert.equal((await http('builds/claim',{body:{},origin:'https://foreign.example'})).status,403);
 assert.equal((await http('client/'+appA.id+'/config')).status,403);
 const jobs=[];
 async function publish(job,patch={},auth=good){
  const data={jobId:job.id,versionCode:job.versionCode,packageName:job.config.packageName,url:boxReleaseUrl(job.appId,job.versionCode),sourceSha:sha,sha256:'a'.repeat(64),size:100,certificate:'c'.repeat(64),...patch};
  githubAsset={tag_name:`boxpanel-${job.appId}-v${job.versionCode}`,target_commitish:sha,draft:false,assets:[{name:'app-release.apk',browser_download_url:data.url,size:data.size,digest:'sha256:'+data.sha256}]};
  return http('builds/complete',{body:data,auth});
 }
 for(let index=0;index<2;index++){
  const job=(await http('builds/claim',{body:{role:'owner',accountId:'forged'}})).data.job;jobs.push(job);
  assert.equal(job.versionCode,1);assert.equal((await http('builds/claim',{body:{}})).data.job.id,job.id,'claim is idempotent within its active run');
  assert.ok(!JSON.stringify(job).includes('Own DNS'),'build assets contain no DNS or user credentials');
  assert.equal((await publish(job,{packageName:'com.foreign.app'})).status,400);
  assert.equal((await publish(job,{},await jwt({run_id:'101'}))).status,409);
  digestValid=false;assert.equal((await publish(job)).status,503);digestValid=true;
  assert.equal((await publish(job)).status,200);assert.equal((await publish(job)).status,409,'a completed lease cannot publish twice');
 }
 assert.deepEqual((await http('builds/pending')).data,{pending:false});
 const configA=(await http('client/'+appA.id+'/config')).data,configB=(await http('client/'+appB.id+'/config')).data;
 assert.equal(configA.app.name,'Marca A');assert.equal(configB.app.name,'Marca B');assert.deepEqual(configA.servers,['https://'+a+'.example.com']);assert.deepEqual(configB.servers,['https://'+b+'.example.com']);assert.equal(configA.slides[0].seconds,120);
 for(const privateValue of [a,b,'account_id','approved_config','run_id'])assert.ok(!JSON.stringify(configA.app).includes(privateValue));
 assert.equal((await http('client/'+appA.id+'/ads/'+configB.slides[0].id)).status,404);assert.ok((await http('client/'+appA.id+'/ads/'+configA.slides[0].id)).data.byteLength>0);assert.ok((await http('client/'+appA.id+'/logo')).data.byteLength>0);
 let current=(await opened(a)).data.app;
 assert.equal(current.apkReady,true);assert.equal((await request({action:'boxpanel-app-save',accountId:a,name:'A nueva',design:'compact',accent:'#e7a737',background:'#07151f',revision:current.revision})).status,200);
 assert.equal((await http('client/'+appA.id+'/config')).data.app.name,'Marca A','a draft cannot replace installed branding');
 current=(await opened(a)).data.app;await request({action:'boxpanel-app-submit',accountId:a,revision:current.revision});current=(await opened(a)).data.app;await request({action:'boxpanel-app-review',accountId:a,decision:'approve',revision:current.revision});
 assert.equal((await http('client/'+appA.id+'/config')).data.app.name,'Marca A','an unbuilt approval cannot replace the release');
 const next=(await http('builds/claim',{body:{}})).data.job;assert.equal(next.appId,appA.id);assert.equal(next.versionCode,2);
 assert.equal((await publish(next,{certificate:'d'.repeat(64)})).status,409);assert.equal((await publish(next)).status,200);
 assert.equal((await http('client/'+appA.id+'/config')).data.app.name,'A nueva');assert.equal((await http('client/'+appA.id+'/update')).data.update.versionCode,2);assert.equal((await http('client/'+appB.id+'/update')).data.update.versionCode,1);
 current=(await opened(a)).data.app;await request({action:'boxpanel-app-review',accountId:a,decision:'suspend',revision:current.revision});
 for(const path of ['config','update','logo','ads/'+configA.slides[0].id])assert.equal((await http('client/'+appA.id+'/'+path)).status,403);
 assert.equal((await http('client/'+appB.id+'/config')).status,200);
 current=(await opened(a)).data.app;await request({action:'boxpanel-app-review',accountId:a,decision:'resume',revision:current.revision});
 assert.equal((await http('client/'+appA.id+'/config')).status,200);
 current=(await opened(a)).data.app;assert.equal((await request({action:'boxpanel-app-build',accountId:a,revision:current.revision},{role:'reseller',accountId:a})).status,403);
 await request({action:'boxpanel-app-build',accountId:a,revision:current.revision});const stale=(await http('builds/claim',{body:{}})).data.job;
 current=(await opened(a)).data.app;await request({action:'boxpanel-app-save',accountId:a,name:'A tercera',design:'classic',accent:'#16d4cd',background:'#07151f',revision:current.revision});current=(await opened(a)).data.app;await request({action:'boxpanel-app-submit',accountId:a,revision:current.revision});current=(await opened(a)).data.app;await request({action:'boxpanel-app-review',accountId:a,decision:'approve',revision:current.revision});
 assert.equal((await publish(stale)).status,409,'a superseded build cannot activate its APK');
 const latest=(await http('builds/claim',{body:{}})).data.job;assert.equal(latest.versionCode,4);await http('builds/fail',{body:{jobId:latest.id}});assert.equal((await opened(a)).data.app.build.status,'failed');assert.equal((await http('builds/pending')).data.pending,false,'failed builds never spin in an automatic retry loop');
 await mf.unsafeEvictDurableObject('box-delivery-test','PlaybackSession',{name});
 assert.equal((await http('client/'+appA.id+'/update')).data.update.versionCode,2);assert.equal((await http('client/'+appB.id+'/config')).data.app.name,'Marca B');
 const worker=await mf.getWorker();assert.equal((await worker.fetch('https://api.snaptvnow.com/api/boxpanel/builds/pending')).status,200);assert.equal((await worker.fetch('https://api.snaptvnow.com/api/boxpanel/client/'+appA.id+'/config')).status,200);
 console.log('PASS: signed OIDC trust boundaries, real SQLite two-app config/image/package isolation, immutable builds, GitHub digest verification, stable signing/version updates, suspension/recovery, stale callbacks, bounded retries and restart persistence.');
}finally{await mf.dispose();}

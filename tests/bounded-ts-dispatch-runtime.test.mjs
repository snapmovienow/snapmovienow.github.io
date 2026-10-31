import assert from 'node:assert/strict';import {build} from 'esbuild';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const bundled=await build({stdin:{contents:`import worker from './cloudflare-worker/src/index.js'; export {PlaybackSession,BackupRecovery,OperationsMonitor} from './cloudflare-worker/src/index.js'; export default {fetch(req,env,ctx){const h=new Headers(req.headers);h.set('Origin',h.get('X-Fixture-Origin')||'https://app.snaptvnow.com');h.delete('X-Fixture-Origin');return worker.fetch(new Request(req,{headers:h}),env,ctx)}};`,resolveDir:process.cwd(),sourcefile:'fixture-entry.mjs'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:*'],write:false});
let outbound=0;
const base={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],outboundService:async()=>{outbound++;throw Error('NETWORK FORBIDDEN IN FIXTURE')},durableObjects:{PLAYBACK_SESSIONS:{className:'PlaybackSession',useSQLite:true},BACKUP_RECOVERY:{className:'BackupRecovery',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true}},bindings:{TICKET_SECRET:'local-runtime-fixture-only-not-deployed',WEB_ORIGINS:'https://app.snaptvnow.com'}};
const options={workers:[{...base,name:'disabled'},{...base,name:'enabled',bindings:{...base.bindings,BOUNDED_TS_CASE:'movistar8461-v1'}}],durableObjectsPersist:false};const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 await mf.ready;const off=await mf.getWorker('disabled'),on=await mf.getWorker('enabled');
 const request=(worker,origin='https://app.snaptvnow.com')=>worker.fetch('https://api.snaptvnow.com/bounded-ts-diagnostic',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Origin':origin},body:JSON.stringify({mode:'run'})});
 let r=await request(off);assert.equal(r.status,403);assert.equal((await r.json()).error,'diagnostic_disabled');
 r=await request(on);assert.equal(r.status,401);assert.equal((await r.json()).error,'session_required');assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://app.snaptvnow.com');
 r=await request(on,'https://unapproved.invalid');assert.equal(r.status,403);assert.equal((await r.json()).error,'origin_not_allowed');
 assert.equal(outbound,0);console.log('PASS: actual Worker dispatch, off-default, session guard, origin guard, CORS; zero outbound requests');
}finally{await mf.dispose()}

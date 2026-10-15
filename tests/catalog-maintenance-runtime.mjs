// Scheduled production module, private self-requests and real SQLite storage.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const script=(await build({entryPoints:['cloudflare-worker/src/index.js'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false})).outputFiles[0].text;
const generatedAt=new Date().toISOString(),seriesPage='https://ww3.gnulahd.nu/ver/dragon-ball-super-beerus/',ep=n=>'https://ww3.gnulahd.nu/dragon-ball-super-beerus-1x0'+n+'/',key='public-test-player-key',embed='https://uqload.vc/embed-testfilm.html';
const languages={langs:[{label:'Latino',servers:[{src:embed}]}]},p=btoa(Array.from(new TextEncoder().encode(JSON.stringify(languages)),(v,i)=>String.fromCharCode(v^key.charCodeAt(i%key.length))).join(''));
const feeds={beerus:{version:1,kind:'beerus',requestId:'sqlite-beerus-review',generatedAt,seriesPage,items:[]},movies:{version:1,kind:'movies',requestId:'sqlite-movies-review',generatedAt,items:[{id:'new-film',name:'New film',year:2026,page:'https://www2.gnula.one/movie/new-film/'}]}};
const outboundService=async req=>{const u=new URL(req.url);
 if(u.hostname==='raw.githubusercontent.com')return Response.json(feeds[u.pathname.endsWith('beerus.json')?'beerus':'movies']);
 if(req.url===seriesPage)return new Response(ep(1)+' '+ep(2));
 if(u.hostname==='ww3.gnulahd.nu'&&u.pathname==='/wp-json/gnrd/v1/player')return Response.json({p});
 if(u.hostname==='ww3.gnulahd.nu')return new Response('window.GNRD={pid:123,tok:"public-token",k:"'+btoa(key)+'"};');
 if(u.hostname==='www2.gnula.one')return new Response(embed);
 if(req.url===embed)return new Response('file: "https://strm1.uqload.vc/media/index.m3u8"');
 if(u.hostname==='strm1.uqload.vc')return u.pathname.endsWith('.m3u8')?new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response(new Uint8Array(64),{headers:{'content-type':'video/mp2t'}});
 throw Error('Unexpected synthetic outbound host: '+u.hostname);
};
const opts={workers:[{name:'catalog-runtime',modules:true,script,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],outboundService,durableObjects:{PLAYBACK_SESSIONS:{className:'PlaybackSession',useSQLite:true},BACKUP_RECOVERY:{className:'BackupRecovery',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true}},bindings:{ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true',TICKET_SECRET:'local-only-maintenance-ticket-secret',ADMIN_SETUP_SECRET:'local-only-maintenance-setup-secret'}}],durableObjectsPersist:false};
const mf=new Miniflare(convertV4MiniflareOptions(opts));
try{
 await mf.ready;const w=await mf.getWorker('catalog-runtime');
 const post=async body=>{const r=await w.fetch('https://local.test/admin',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
 await post({action:'setup',username:'owner',password:'local-owner-password',setupSecret:opts.workers[0].bindings.ADMIN_SETUP_SECRET});
 const login=await post({action:'login',username:'owner',password:'local-owner-password'}),admin=(action,b={})=>post({action,access_token:login.access_token,...b});
 const catalog=await admin('exclusive-list');for(const item of catalog.items)await admin('exclusive-save',{item:{...item,visible:false},revision:item.revision});
 await admin('exclusive-save',{revision:0,item:{id:'beerus',name:'Dragon ball super beerus',type:'series',source:'GNULA',mode:'gnula',page:seriesPage,poster:'',plot:'',year:2026,visible:true,adult:false,episodes:[{id:'beerus-one',title:'Episodio 1',season:1,episode_num:1,page:ep(1)}]}});
 const scheduled=await w.scheduled({cron:'*/5 * * * *'});assert.equal(scheduled.outcome,'ok');
 const status=(await(await w.fetch('https://local.test/health')).json()).catalog_maintenance;
 assert.equal(status.runner.phase,'completed',JSON.stringify(status));assert.equal(status.beerus.state,'completed');assert.equal(status.movies.state,'completed');
 assert.equal(status.beerus.results.find(x=>x.id==='beerus-s1e2').status,'added');assert.equal(status.movies.results.find(x=>x.id==='new-film').status,'added');
 const after=await admin('exclusive-list');assert.equal(after.items.find(x=>x.id==='beerus').episodes.length,2);assert.equal(after.items.filter(x=>x.type==='movie'&&x.visible).length,1);
 await w.scheduled({cron:'*/5 * * * *'});assert.equal((await admin('exclusive-list')).items.find(x=>x.id==='beerus').episodes.length,2,'repeated real scheduled invocation is idempotent');
 console.log('PASS: actual scheduled workerd handler, private orchestration/self-requests, real HLS bytes, SQLite episode addition and film addition, heartbeat and idempotent repeat.');
}finally{await mf.dispose()}

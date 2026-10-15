import assert from 'node:assert/strict';
import {catalogMaintenanceRoute,validateCatalogFeed,discoverBeerusEpisodes,runCatalogMaintenance,BEERUS_PAGE} from '../src/catalog-maintenance.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import worker from '../src/index.js';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}
 transaction(fn){const run=this.queue.then(async()=>{const old=structuredClone(this.data);try{return await fn(this)}catch(e){this.data=old;throw e}});this.queue=run.catch(()=>{});return run}
}
const leases={revoked:[],in(){return this},async removeMatching(fn){this.revoked.push(fn)}};
const time=Date.now(),stamp=n=>new Date(time+n*1000).toISOString(),hash=n=>n.toString(16).padStart(64,'0');
const page=n=>'https://ww3.gnulahd.nu/ver/movie-'+n+'/';
const movie=(n,overrides={})=>({id:'movie-'+n,name:'Movie '+n,type:'movie',year:2026,source:'GNULA',mode:'gnula',page:page(n),poster:'',plot:'',visible:true,adult:false,episodes:[],revision:1,playbackRevision:1,createdAt:n+1,updatedAt:n+1,...overrides});
const episode=n=>({id:'episode-'+n,title:'Episodio '+n,season:1,episode_num:n,page:'https://ww3.gnulahd.nu/dragon-ball-super-beerus-1x'+String(n).padStart(2,'0')+'/'});
async function catalog(rows){const s=new Store();await s.put('exclusive:index',{revision:1,ids:rows.map(x=>x.id),updatedAt:time});for(const r of rows)await s.put('exclusive:item:'+r.id,r);return s}
const feed=(kind,n,items=[])=>({version:1,kind,requestId:kind+'-request-'+n,generatedAt:stamp(n),...(kind==='beerus'?{seriesPage:BEERUS_PAGE}:{}),items});
const call=async(s,path,body={},options={})=>{const r=await catalogMaintenanceRoute(s,leases,'/catalog-maintenance-'+path,body,options);return {status:r.status,data:await r.json()}};
const begin=(s,kind,n,items=[],more={})=>call(s,'start',{kind,hash:hash(n),feed:feed(kind,n,items),...more});
const good=async()=>({ok:true,check:'playlist_and_segment'}),bad=async()=>({ok:false});
const probe=(s,kind,n,key,check=good)=>call(s,'probe',{kind,hash:hash(n),key},{probe:check});
assert.throws(()=>validateCatalogFeed(feed('movies',1,[{...movie(1),page:'https://127.0.0.1/a.mp4'}]),'movies'));
assert.throws(()=>validateCatalogFeed(feed('movies',1,[movie(1),movie(1)]),'movies'));
assert.throws(()=>validateCatalogFeed({...feed('beerus',1),seriesPage:'https://gnula.one/other/'},'beerus'));
assert.throws(()=>validateCatalogFeed(feed('beerus',1,[episode(1),episode(1)]),'beerus'));
const cinemaReview={checkedAt:stamp(1),sources:['https://www.amctheatres.com/movies','https://www.regmovies.com/theatres/regal-warren-east-1444']},retire=item=>({id:item.id,name:item.name,year:item.year,reason:'outside_current_cinema_selection'});
assert.throws(()=>validateCatalogFeed({...feed('movies',1),retire:[retire(movie(1))]},'movies'),'retirements require a dated cinema review');
assert.throws(()=>validateCatalogFeed({...feed('movies',1,[movie(1)]),cinemaReview,retire:[retire(movie(1))]},'movies'),'a title cannot be selected and retired together');
assert.throws(()=>validateCatalogFeed({...feed('movies',1),retire:[retire(movie(1))],cinemaReview:{...cinemaReview,sources:['https://www.amctheatres.com/movies','https://untrusted.net/']}},'movies'));
assert.throws(()=>validateCatalogFeed({...feed('movies',1),retire:[retire(movie(1))],cinemaReview:{...cinemaReview,checkedAt:new Date(time-9*86400000).toISOString()}},'movies'));
assert.equal(discoverBeerusEpisodes([episode(2).page,episode(1).page,episode(2).page,'https://evil.net/dragon-ball-super-beerus-1x03/'].join(' ')).length,2);

const series=movie(100,{id:'beerus-series',name:'Dragon ball super beerus',type:'series',page:BEERUS_PAGE,episodes:[episode(1)]}),s=await catalog([series]);
let started=await begin(s,'beerus',1,[],{discovered:[episode(3),episode(2),episode(1)]});assert.equal(started.data.pending.length,2,'check all existing episodes and add only one new episode');
assert.equal((await probe(s,'beerus',1,'episode-1',bad)).data.status,'unavailable');
assert.equal((await probe(s,'beerus',1,'beerus-series-s1e2')).data.status,'added');
assert.equal((await exclusiveSnapshot(s)).items[0].episodes.length,2,'a failed previous episode remains in the catalog');
assert.equal((await begin(s,'beerus',1)).data.pending.length,0,'replayed feed is idempotent');
assert.equal((await call(s,'start',{kind:'beerus',hash:hash(3),feed:feed('beerus',0)})).status,409);
const replacement={...episode(1),page:'https://www2.gnula.one/episode/beerus-1/'};
await begin(s,'beerus',2,[replacement]);assert.equal((await probe(s,'beerus',2,'episode-1')).data.status,'repaired');assert.equal((await exclusiveSnapshot(s)).items[0].episodes[0].page,replacement.page);
const status=await call(s,'status');assert.ok(!JSON.stringify(status).includes('https://'),'public results omit upstream URLs and signatures');

const full=await catalog(Array.from({length:20},(_,i)=>movie(i))),proposal=movie(30);
await begin(full,'movies',1,[proposal]);
await probe(full,'movies',1,'movie-0',bad);
assert.equal((await probe(full,'movies',1,proposal.id)).data.status,'rotation_needs_notice');assert.equal((await exclusiveSnapshot(full)).items.filter(x=>x.visible).length,20,'unavailable oldest movie is retained pending notice');
await begin(full,'movies',2,[proposal]);await probe(full,'movies',2,'movie-0');
let result=await probe(full,'movies',2,proposal.id);assert.equal(result.data.status,'added');assert.equal(result.data.rotatedId,'movie-0');
let snap=await exclusiveSnapshot(full);assert.equal(snap.items.filter(x=>x.visible).length,20);assert.equal(snap.items.find(x=>x.id==='movie-0').visible,false);assert.ok(snap.items.find(x=>x.id===proposal.id).visible);
const rollback=await catalog(Array.from({length:20},(_,i)=>movie(i)));await begin(rollback,'movies',1,[proposal]);await probe(rollback,'movies',1,'movie-0');
const throwingLeases={count:0,in(){return this},async removeMatching(){if(++this.count===2)throw Error('synthetic hide failure')}};
await assert.rejects(catalogMaintenanceRoute(rollback,throwingLeases,'/catalog-maintenance-probe',{kind:'movies',hash:hash(1),key:proposal.id},{probe:good}));
assert.equal((await exclusiveSnapshot(rollback)).items.length,20,'addition and rotation roll back together');assert.equal((await exclusiveSnapshot(rollback)).items[0].visible,true);
await begin(full,'movies',3,[movie(31)]);assert.equal((await probe(full,'movies',3,'movie-31',bad)).data.status,'unavailable');assert.equal((await exclusiveSnapshot(full)).items.filter(x=>x.visible).length,20,'failed addition never rotates a film');
const changed=await catalog([movie(1)]);await begin(changed,'movies',1,[movie(1,{page:page('replacement')})]);await changed.put('exclusive:item:movie-1',movie(1,{page:page('manual')}));assert.equal((await probe(changed,'movies',1,'movie-1')).data.status,'catalog_changed','a manual source edit wins over a pending job');
const repair=await catalog([movie(1,{poster:'https://images.snapcdn.net/user.jpg'})]);await begin(repair,'movies',1,[movie(1,{page:page('replacement')})]);
let resolve;const hold=new Promise(r=>resolve=r),running=probe(repair,'movies',1,'movie-1',async()=>{await hold;return good()});await new Promise(r=>setTimeout(r,0));assert.equal((await probe(repair,'movies',1,'movie-1')).data.skipped,true,'concurrent ticks cannot duplicate a probe');resolve();await running;
snap=await exclusiveSnapshot(repair);assert.equal(snap.items[0].id,'movie-1');assert.equal(snap.items[0].poster,'https://images.snapcdn.net/user.jpg');assert.ok(leases.revoked.length>0,'changed playback revokes obsolete leases without allocating a customer connection');
await begin(repair,'movies',2,[movie(1,{page:page('bad-replacement')})]);assert.equal((await probe(repair,'movies',2,'movie-1',async item=>item.page===page('bad-replacement')?bad():good())).data.replacementUnavailable,true);assert.equal((await exclusiveSnapshot(repair)).items[0].page,page('replacement'),'a failed replacement cannot overwrite an online original');
const renamed=await catalog([movie(1,{name:'User edited title'})]);await begin(renamed,'movies',1,[movie(1)]);assert.equal((await probe(renamed,'movies',1,'movie-1')).data.status,'online','metadata edits cannot prevent checks of the rest of the catalog');
const personal=movie(80,{source:'Personal',mode:'direct',page:'https://media.snapcdn.net/personal.mp4'}),retirement=await catalog([movie(1),movie(2),personal,series]);
const retirementFeed={...feed('movies',1,[movie(3)]),cinemaReview,retire:[movie(1),movie(2),personal,series].map(retire)};
started=await call(retirement,'start',{kind:'movies',hash:hash(1),feed:retirementFeed});assert.deepEqual(started.data.pending.map(x=>x.category),['retirement','retirement','addition']);
assert.equal((await probe(retirement,'movies',1,'movie-1',async()=>{throw Error('retirement must not fetch media')})).data.status,'retired');
await retirement.put('exclusive:item:movie-2',movie(2,{revision:2}));assert.equal((await probe(retirement,'movies',1,'movie-2')).data.status,'catalog_changed','manual edits supersede an explicit retirement');
assert.equal((await probe(retirement,'movies',1,'movie-3')).data.status,'added');
snap=await exclusiveSnapshot(retirement);assert.equal(snap.items.find(x=>x.id==='movie-1').visible,false);assert.equal(snap.items.find(x=>x.id==='movie-2').visible,true);assert.equal(snap.items.find(x=>x.id===personal.id).visible,true);assert.equal(snap.items.find(x=>x.id===series.id).visible,true);
await call(retirement,'start',{kind:'movies',hash:hash(2),feed:{...retirementFeed,generatedAt:stamp(2),requestId:'retirement-repeat'}});assert.ok(!(await call(retirement,'status')).data.movies.results.some(x=>x.id==='movie-1'),'hidden retired rows are retained without repeating a removal');

const requests=[];let deny=false,privateRedirect=false;
const fetcher=async(url,options)=>{requests.push(url);assert.equal(options.redirect,'manual');assert.ok(options.headers.Range);const u=new URL(url);
 if(privateRedirect)return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});
 if(u.pathname==='/master.m3u8')return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 if(u.pathname==='/video.m3u8')return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 return new Response(deny?'<html>expired</html>':new Uint8Array(64),{headers:{'content-type':deny?'text/html':'application/octet-stream'}});
};
const media={mode:'direct',page:'https://media.snapcdn.net/master.m3u8'};
assert.deepEqual(await inspectCatalogSource(media,{fetcher}),{ok:true,check:'playlist_and_segment'});assert.equal(requests.length,5,'checks master, rendition, key, map and actual segment');
deny=true;assert.equal((await inspectCatalogSource(media,{fetcher})).ok,false);deny=false;privateRedirect=true;requests.length=0;assert.equal((await inspectCatalogSource(media,{fetcher})).ok,false);assert.equal(requests.length,1,'private redirects are rejected before any second fetch');
let calls=0;await runCatalogMaintenance({ENVIRONMENT:'staging',CATALOG_MAINTENANCE_ENABLED:'true'},{directory:()=>{calls++}});await runCatalogMaintenance({},{directory:()=>{calls++}});assert.equal(calls,0);
const jobStore=await catalog([series]),directory=async(env,path,body={})=>catalogMaintenanceRoute(jobStore,leases,path,body,{probe:good});
await runCatalogMaintenance({CATALOG_MAINTENANCE_ENABLED:'true'},{directory,fetcher:async url=>new Response(url===BEERUS_PAGE?episode(1).page:JSON.stringify(feed(url.endsWith('beerus.json')?'beerus':'movies',1))) });
assert.equal((await call(jobStore,'status')).data.beerus.state,'completed');
for(const p of ['/catalog-maintenance-start','/accounts/catalog-maintenance-start']){const r=await worker.fetch(new Request('https://api.snaptvnow.com'+p,{method:'POST',body:JSON.stringify({kind:'movies'})}),{TICKET_SECRET:'test-maintenance-secret'});assert.ok([400,401,403,404].includes(r.status),'no public maintenance mutation route');}
console.log('PASS: validated data feeds, daily episode limit, idempotent and concurrent maintenance, stale/manual edit protection, real media checks, source repair, capped atomic rotation, unavailable-title retention, private reports and staging isolation.');

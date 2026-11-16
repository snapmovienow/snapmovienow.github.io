import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {clientHistorySchema,recordPlayback,readClientHistory} from '../src/client-history.mjs';
import {cleanSeriesUsageContent,readSeriesUsage,summarizeSeriesUsage} from '../src/series-usage.mjs';

const NOW=1794870000000,DAY=86400000,ACCOUNT='account-one',SERIES='lqsa-t17-jonilar';
const episode=id=>({id:'lqsa-t17-e'+id,title:'Capítulo '+id,season:17,episode_num:id,page:'https://private.invalid/signed?password=must-not-return'});
const catalog=[{id:SERIES,name:'La que se avecina',type:'series',visible:true,rootServer:'ccf',rootSeriesId:'1234',episodes:[episode(1),episode(2),episode(3)]}];
const content=(n=1)=>({type:'series',id:SERIES,name:'La que se avecina',episodeId:'lqsa-t17-e'+n,season:17,episode:n,rootServer:'ccf',rootSeriesId:'1234'});
function record(n,overrides={},dataOverrides={}){
 return {id:n.toString(16).padStart(64,'0'),account_id:ACCOUNT,line_id:'line-one',username:'ViewerOne',kind:'playback',started_at:NOW-100000,
  last_seen_at:NOW-10000,ended_at:NOW-10000,lease_id:'PRIVATE-LEASE-'+n,
  data:JSON.stringify({type:'series',title:'Capítulo 1',seriesTitle:'La que se avecina',season:17,episode:1,content:content(),trafficObserved:true,
   request_id:'PRIVATE-REQUEST',client:{ip:'PRIVATE-IP'},source:'https://private.invalid/signed?password=must-not-return',...dataOverrides}),...overrides};
}
class Store{
 constructor(sql){this.rows=new Map();this.calls=[];if(sql){this.db=new DatabaseSync(':memory:');this.sql={exec:(query,...args)=>{this.calls.push({query,args});let rows=[];if(args.length||!query.includes(';'))rows=this.db.prepare(query).all(...args);else this.db.exec(query);return {toArray:()=>rows,one:()=>rows[0]};}};}clientHistorySchema(this.sql);}
 async list({prefix}){return new Map([...this.rows].filter(([key])=>key.startsWith(prefix)));}
 async get(key){return structuredClone(this.rows.get(key));}
 async put(key,value){this.rows.set(key,structuredClone(value));}
 async delete(key){this.rows.delete(key);}
 insert(row,key=row.id){this.rows.set('client-history:'+key,row);if(this.sql)this.db.prepare('INSERT INTO smn_client_history(id,account_id,line_id,username,kind,started_at,last_seen_at,ended_at,lease_id,data) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...['id','account_id','line_id','username','kind','started_at','last_seen_at','ended_at','lease_id','data'].map(k=>row[k]));}
 close(){this.db?.close();}
}

test('trusted content projection drops URLs, secrets and invalid identifiers',()=>{
 const safe=cleanSeriesUsageContent({...content(),page:'https://private.invalid/',password:'private-fixture',rootSeriesId:1234});
 assert.deepEqual(safe,{...content(),rootSeriesId:'1234'});
 assert.equal(cleanSeriesUsageContent({...content(),id:'https://private.invalid/'}),null);
 assert.equal(cleanSeriesUsageContent({...content(),name:'password=private-fixture'}),null);
 assert.equal(cleanSeriesUsageContent({...content(),rootServer:'https://private.invalid/'}).rootServer,undefined);
});

test('a zero-use supplemental series exposes its existing root reference without moving its identity',()=>{
 const report=summarizeSeriesUsage([],{accountId:ACCOUNT},[{...catalog[0],rootServer:undefined,rootSeriesId:undefined,supplement:{server:'ccf',seriesId:'1234'}}],NOW);
 assert.equal(report.series[0].id,SERIES);assert.equal(report.series[0].rootServer,'ccf');assert.equal(report.series[0].rootSeriesId,'1234');
 assert.equal(report.series[0].sessions,0);assert.equal(report.episodes.length,3);
});

for(const sql of [false,true])test('account-scoped series and episode counts, zero-use items and safe output; SQL='+sql,async()=>{
 const store=new Store(sql);
 try{
  store.insert(record(1));store.insert(record(2,{line_id:'line-one',username:'RenamedViewer'},{title:'Capítulo 2',content:content(2),episode:2}));
  store.insert(record(3,{line_id:'line-two',username:'ViewerTwo'},{content:content(),trafficObserved:false}));
  store.insert(record(4,{account_id:'foreign-account',username:'ForeignViewer'}));
  store.insert(record(5,{kind:'login'}));store.insert(record(6,{}, {type:'movie'}));
  if(!sql)store.insert(record(7,{data:'not-json'}));store.insert(record(8,{}, {client:{serviceCheck:true}}));
  const response=await readSeriesUsage(store,store.sql,{accountId:ACCOUNT,pageSize:10},catalog,NOW),report=await response.json();
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(report.accountId,ACCOUNT);assert.equal(report.summary.sessions,3);assert.equal(report.summary.users,2,'rename preserves immutable line identity');
  assert.equal(report.summary.durationMs,270000);assert.equal(report.summary.episodesUsed,2);assert.equal(report.summary.trafficObservedSessions,2);
  assert.equal(report.series[0].id,SERIES);assert.equal(report.series[0].sessions,3);assert.equal(report.series[0].rootSeriesId,'1234');
  assert.equal(report.episodes.find(row=>row.id==='lqsa-t17-e1').sessions,2);assert.equal(report.episodes.find(row=>row.id==='lqsa-t17-e3').sessions,0);
  assert.equal(report.verifiedPlays,null);assert.match(report.measurement,/not_verified_playback/);
  assert.ok(!/ForeignViewer|PRIVATE-|private.invalid|password=|must-not-return/.test(JSON.stringify(report)));
  if(sql){assert.ok(store.calls.some(call=>call.query.includes('account_id=?')&&call.args[0]===ACCOUNT));assert.ok(store.calls.some(call=>call.query.includes('LIMIT ?')&&call.args.at(-1)===10001));}
 }finally{store.close();}
});

for(const sql of [false,true])test('new playback persists trusted content identity without changing old session attribution; SQL='+sql,async()=>{
 const store=new Store(sql);
 try{
  const user={id:'viewer-id',username:'viewerone',resellerBridge:{accountId:ACCOUNT,lineId:'line-one'}};
  await store.put('user:viewerone',user);
  const lease={uid:user.id,username:user.username,request_id:'PRIVATE-REQUEST',mediaKey:'series|exclusive|lqsa-t17-e1|mp4',
   content:{...content(),password:'must-not-return',url:'https://private.invalid/source'},
   activity:{title:'Capítulo 1',seriesTitle:'La que se avecina',season:17,episode:1},startedAt:NOW-20000,until:NOW+90000};
  await recordPlayback(store,store.sql,'PRIVATE-LEASE',lease,NOW-10000);
  await recordPlayback(store,store.sql,'PRIVATE-LEASE',{...lease,content:{...content(2),id:'other-series'}},NOW);
  await recordPlayback(store,store.sql,'PRIVATE-MOVIE',{...lease,request_id:'PRIVATE-OTHER',mediaKey:'movie|exclusive|movie-1|mp4'},NOW);
  const report=await(await readSeriesUsage(store,store.sql,{accountId:ACCOUNT},catalog,NOW)).json();
  assert.equal(report.summary.sessions,1);assert.equal(report.rows[0].seriesId,SERIES);assert.equal(report.rows[0].episodeId,'lqsa-t17-e1');
  const history=await(await readClientHistory(store,store.sql,{accountId:ACCOUNT},NOW)).json();
  const series=history.rows.find(row=>row.type==='series'),movie=history.rows.find(row=>row.type==='movie');
  assert.deepEqual(series.content,content());assert.equal(movie.content,undefined);
  assert.ok(!JSON.stringify(history).includes('must-not-return'));assert.ok(!JSON.stringify(history).includes('private.invalid'));
 }finally{store.close();}
});

test('duplicate history IDs are not counted twice and newer heartbeats update the same session',()=>{
 const first=record(1),renewed=record(1,{last_seen_at:NOW-1000,ended_at:NOW-1000});
 const report=summarizeSeriesUsage([first,renewed,record(1,{account_id:'foreign-account'})],{accountId:ACCOUNT},catalog,NOW);
 assert.equal(report.summary.sessions,1);assert.equal(report.summary.durationMs,99000);
});

test('legacy title groups remain separate from a same-named catalog item',()=>{
 const report=summarizeSeriesUsage([record(1),record(2,{}, {content:undefined})],{accountId:ACCOUNT},catalog,NOW);
 assert.equal(report.series.length,2);assert.equal(report.series.find(row=>row.id===SERIES).sessions,1);
 const legacy=report.series.find(row=>row.identityEvidence==='legacy_title');assert.match(legacy.id,/^legacy-title:/);assert.equal(legacy.sessions,1);
 assert.equal(report.summary.legacySessions,1);
 const filtered=summarizeSeriesUsage([record(1),record(2,{}, {content:undefined})],{accountId:ACCOUNT,seriesId:legacy.id},catalog,NOW);
 assert.equal(filtered.summary.sessions,1);assert.ok(filtered.rows.every(row=>row.identityEvidence==='legacy_title'));
});

test('legacy Unicode title keys remain bounded and can be used as exact filters',()=>{
 const history=[record(1,{}, {content:undefined,seriesTitle:'\ufdfa'.repeat(180)})];
 const report=summarizeSeriesUsage(history,{accountId:ACCOUNT},[],NOW),id=report.series[0].id;
 assert.ok(id.length<=1024);assert.equal(summarizeSeriesUsage(history,{accountId:ACCOUNT,seriesId:id},[],NOW).summary.sessions,1);
});

test('connection durations are clipped to the requested interval and active time is not invented',()=>{
 const old=record(1,{started_at:NOW-200000,last_seen_at:NOW-5000,ended_at:null});
 const report=summarizeSeriesUsage([old],{accountId:ACCOUNT,from:NOW-100000,to:NOW-10000},catalog,NOW);
 assert.equal(report.rows[0].durationMs,90000);assert.equal(report.rows[0].windowStartedAt,NOW-100000);assert.equal(report.rows[0].windowEndedAt,NOW-10000);
 assert.equal(report.rows[0].estimatedEnd,true);
 const current=summarizeSeriesUsage([old],{accountId:ACCOUNT},catalog,NOW);assert.equal(current.rows[0].durationMs,195000);
 const historical=summarizeSeriesUsage([old],{accountId:ACCOUNT,to:NOW-100000},catalog,NOW);assert.equal(historical.summary.active,0);
});

test('bounded filters and pagination preserve per-episode identity and account scope',async()=>{
 const records=Array.from({length:12},(_,n)=>record(n+1,{started_at:NOW-100000+n},{title:'Capítulo '+((n%2)+1),content:content((n%2)+1),episode:(n%2)+1}));
 let report=summarizeSeriesUsage(records,{accountId:ACCOUNT,pageSize:10,page:2},catalog,NOW);assert.equal(report.rows.length,2);assert.equal(report.pagination.total,12);
 report=summarizeSeriesUsage(records,{accountId:ACCOUNT,seriesId:SERIES,episodeId:'lqsa-t17-e2',username:'ViewerOne'},catalog,NOW);assert.equal(report.summary.sessions,6);assert.equal(report.episodes.length,1);
 report=summarizeSeriesUsage(records,{accountId:ACCOUNT,q:"' OR 1=1 --"},catalog,NOW);assert.equal(report.summary.sessions,0);
 const store=new Store(false);for(const invalid of [{accountId:'https://secret.invalid'},{accountId:ACCOUNT,pageSize:1000},{accountId:ACCOUNT,from:NOW-40*DAY},{accountId:ACCOUNT,to:NOW+120000},{accountId:ACCOUNT,q:'x'.repeat(101)}])assert.equal((await readSeriesUsage(store,null,invalid,catalog,NOW)).status,400);
});

test('record and aggregate caps are explicit without overstating complete history',()=>{
 const records=Array.from({length:10001},(_,n)=>record(n+1,{started_at:NOW-100000+n}));
 const report=summarizeSeriesUsage(records,{accountId:ACCOUNT,pageSize:10},catalog,NOW);
 assert.equal(report.recordsTruncated,true);assert.equal(report.summary.sessions,10000);assert.equal(report.rows.length,10);
 const many=Array.from({length:501},(_,n)=>record(n+1,{}, {content:{...content(),episodeId:'episode-'+n,episode:n+1}}));
 const grouped=summarizeSeriesUsage(many,{accountId:ACCOUNT},[],NOW);assert.equal(grouped.groupsTruncated,true);assert.equal(grouped.episodes.length,500);assert.equal(grouped.summary.episodesUsed,501);
});

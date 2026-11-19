import test from 'node:test';
import assert from 'node:assert/strict';
import {createLqsaBootstrap} from '../src/lqsa-bootstrap.mjs';
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'};
const row=(server='ccf',id='42',name='La que se avecina')=>({_server:server,series_id:id,name,cover:'https://images.test/cover.jpg',year:'2007'});
const detail=()=>({info:{name:'La que se avecina',cover:'https://images.test/cover.jpg',plot:'Public plot',year:'2007',password:'private-fixture'},episodes:{'1':[{direct_source:'https://provider.test/series/user/private-fixture/1.mp4'}]}});
const harness=({rows=[row()],status={state:'pending'},details=detail(),now=()=>1000,retryMs=300000}={})=>{
 const tasks=[],calls=[],catalogCalls=[];
 const directory=async(_env,path,body)=>{calls.push({path,body});return Response.json(path==='/lqsa-import-status'?status:{state:'running'});};
 const catalogFactory=()=>async(...args)=>{catalogCalls.push(args);if(args[0]==='get_series')return rows;if(details instanceof Error)throw details;return details;};
 const boot=createLqsaBootstrap({directory,catalogFactory,now,retryMs}),ctx={waitUntil:p=>tasks.push(p)};
 return {boot,ctx,tasks,calls,catalogCalls,drain:async()=>{await Promise.all(tasks);}};
};
test('bootstrap is production-only, requires maintenance and waitUntil, and exposes no public target input',async()=>{
 const h=harness();h.boot({...env,ENVIRONMENT:'staging'},h.ctx);h.boot({...env,CATALOG_MAINTENANCE_ENABLED:'false'},h.ctx);h.boot(env);h.boot({},h.ctx);assert.equal(h.tasks.length,0);
});
test('one isolate queues only once and skips terminal jobs before reading provider data',async()=>{
 for(const state of ['completed','failed']){
  const h=harness({status:{state}});for(let i=0;i<10;i++)h.boot(env,h.ctx);await h.drain();h.boot(env,h.ctx,{force:true});await h.drain();
  assert.equal(h.tasks.length,1);assert.deepEqual(h.calls.map(x=>x.path),['/lqsa-import-status']);assert.equal(h.catalogCalls.length,0);
 }
});
test('exact-title discovery selects the unique primary CCF and projects only bounded identity metadata',async()=>{
 const h=harness({rows:[{...row(),password:'private-fixture'},row('backup','52'),row('ccf','99','La que se avecina: extras')]});
 for(let i=0;i<10;i++)h.boot(env,h.ctx);await h.drain();
 assert.equal(h.tasks.length,1);assert.equal(h.catalogCalls.length,2);assert.deepEqual(h.catalogCalls[0],['get_series',undefined,{}, {fresh:true}]);
 assert.deepEqual(h.catalogCalls[1],['get_series_info','ccf',{series_id:'42'},{fresh:true}]);
 const run=h.calls.find(c=>c.path==='/lqsa-import-run').body;
 assert.equal(run.candidates.length,2);assert.equal(run.server,'ccf');assert.equal(run.seriesId,'42');assert.deepEqual(run.details,{info:{name:'La que se avecina',cover:'https://images.test/cover.jpg',plot:'Public plot',year:2007},episodes:{}});
 assert.ok(!JSON.stringify(run).includes('private-fixture')&&!JSON.stringify(run).includes('direct_source'));
});
test('empty and ambiguous valid lists are handed to the private job with null details for persisted status',async()=>{
 for(const rows of [[],[row('backup-a','1'),row('backup-b','2')],[row('ccf','1'),row('ccf','2')]]){
  const h=harness({rows});h.boot(env,h.ctx);await h.drain();assert.equal(h.catalogCalls.length,1);
  const run=h.calls.find(c=>c.path==='/lqsa-import-run').body;assert.equal(run.details,null);assert.equal(run.server,undefined);assert.equal(run.seriesId,undefined);assert.equal(run.candidates.length,rows.length);
 }
});
test('invalid or oversized lists are rejected before a private mutation payload and logs contain no raw errors',async()=>{
 const logs=[],original=console.error;console.error=value=>logs.push(value);
 try{
  for(const rows of [{error:'private-fixture'},[null],new Array(50001).fill(row()),new Array(9).fill(row())]){
   const h=harness({rows});h.boot(env,h.ctx);await h.drain();assert.ok(!h.calls.some(c=>c.path==='/lqsa-import-run'));
  }
 }finally{console.error=original;}
 assert.equal(logs.length,4);assert.ok(logs.every(x=>x.event==='lqsa_bootstrap'&&x.phase==='catalog'));assert.ok(!JSON.stringify(logs).includes('private-fixture'));
});
test('failed or malformed details keep the selected exact identity but are retried by the private job',async()=>{
 for(const details of [new Error('private-fixture'),[],{info:[],episodes:{}},{info:{name:'x'.repeat(181)},episodes:{}}]){
  const h=harness({details});h.boot(env,h.ctx);await h.drain();const run=h.calls.find(c=>c.path==='/lqsa-import-run').body;
  assert.equal(run.details,null);assert.equal(run.server,'ccf');assert.equal(run.seriesId,'42');assert.ok(!JSON.stringify(run).includes('private-fixture'));
 }
});
test('forced cron retries are debounced, do not overlap, and remain capped at three per isolate',async()=>{
 let time=1000;const h=harness({now:()=>time});h.boot(env,h.ctx);h.boot(env,h.ctx,{force:true});await h.drain();
 h.boot(env,h.ctx,{force:true});assert.equal(h.tasks.length,1);
 for(let i=0;i<4;i++){time+=300001;h.boot(env,h.ctx,{force:true});h.boot(env,h.ctx,{force:true});await h.drain();}
 assert.equal(h.tasks.length,3);assert.equal(h.calls.filter(x=>x.path==='/lqsa-import-run').length,3);
});

test('a public request to a cold production Worker does not wake the catalog import', async () => {
 const {default: worker} = await import('../src/index.js');
 const calls = [];
 const background = [];
 const production = {
  ...env,
  PLAYBACK_SESSIONS: {
   idFromName: name => name,
   get: () => ({fetch: async url => {
    calls.push(new URL(url).pathname);
    return Response.json({state: 'completed'});
   }})
  }
 };
 const response = await worker.fetch(
  new Request('https://api.snaptvnow.com/', {method: 'OPTIONS'}),
  production,
  {waitUntil: task => background.push(task)}
 );
 await Promise.all(background);
 assert.equal(response.status, 204);
 assert.ok(!calls.includes('/accounts/lqsa-import-status'));
});

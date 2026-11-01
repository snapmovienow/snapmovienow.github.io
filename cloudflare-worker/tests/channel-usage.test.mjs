import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openLeaseStore} from '../src/lease-store.mjs';
import {recordPlayback,touchPlayback,finishPlayback} from '../src/client-history.mjs';
import {usageChannel,observeChannelUsage,readChannelUsage} from '../src/channel-usage.mjs';
import {accountsFetch} from '../src/accounts.mjs';
import {LOCAL_TV_CHANNELS} from '../src/official-live.mjs';
class Store{
 constructor(sql){this.data=new Map();this.calls=[];if(sql){this.db=new DatabaseSync(':memory:');this.sql={exec:(q,...args)=>{this.calls.push({q,args});let rows=[];if(args.length||!q.includes(';'))rows=this.db.prepare(q).all(...args);else this.db.exec(q);return {toArray:()=>rows,one:()=>rows[0]};}};}}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){return this.data.delete(k);}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}async transaction(fn){return fn(this);}
}
for(const sql of [false,true]){
 const store=new Store(sql),leases=await openLeaseStore(store),now=Date.now(),row={...LOCAL_TV_CHANNELS[0],name:'Synthetic local',type:'movie',mode:'gnula',visible:true,adult:false,profileServer:'exclusive',playbackRevision:1},second={...row,id:'custom-live',page:'https://media.example.org/live.m3u8',mode:'direct',usageKind:'channel',name:'Unused channel'},channel=usageChannel(row),catalog=[row,second];
 const user={id:'viewer-a',username:'synthetic-a',status:'active',version:1,resellerBridge:{accountId:'account-a',lineId:'line-a'},permissions:{tv:true,movies:true}},foreign={...user,id:'viewer-b',username:'synthetic-b',resellerBridge:{accountId:'account-b',lineId:'line-b'}};
 await store.put('user:'+user.username,user);await store.put('user:'+foreign.username,foreign);
 const lease={uid:user.id,username:user.username,sid:'PRIVATE-session',version:1,request_id:'PRIVATE-request',channel,exclusiveId:row.id,exclusiveParentId:row.id,playbackRevision:1,mediaKey:'movie|exclusive|'+row.id+'|m3u8',activity:{title:row.name},startedAt:now-200000,until:now+90000};
 await recordPlayback(store,store.sql,'lease-a',lease,now-200000);await touchPlayback(store,store.sql,'lease-a',now-10000,true);
 await observeChannelUsage(store,store.sql,'lease-a',{kind:'media',startupMs:2300},now-190000);
 await observeChannelUsage(store,store.sql,'lease-a',{kind:'failure',code:'upstream_timeout'},now-8000);await observeChannelUsage(store,store.sql,'lease-a',{kind:'failure',code:'upstream_timeout'},now-7000);
 await observeChannelUsage(store,store.sql,'lease-a',{kind:'media',startupMs:90000},now-6000);await finishPlayback(store,store.sql,'lease-a','player_closed',now-5000);
 await recordPlayback(store,store.sql,'foreign',{...lease,uid:foreign.id,username:foreign.username},now-15000);
 await recordPlayback(store,store.sql,'legacy',{...lease,channel:undefined,request_id:'legacy',activity:{title:row.name}},now-14000);
 const read=async(input={})=>{const r=await readChannelUsage(store,store.sql,{accountId:'account-a',from:now-100000,to:now,pageSize:10,...input},catalog,now);assert.equal(r.status,200);return r.json();};
 let report=await read();assert.equal(report.rows.length,1);assert.equal(report.rows[0].durationMs,95000,'cross-boundary sessions are clipped, not omitted');assert.equal(report.summary.users,1);assert.equal(report.summary.sessions,1);assert.equal(report.channels.find(c=>c.id===second.id).durationMs,0);assert.equal(report.summary.incidents,1);assert.equal(report.summary.pendingIssues,0);assert.equal(report.rows[0].startupMs,null,'startup before the review window is not a new startup');assert.equal(report.events[0].kind,'recovered');assert.equal(report.events[0].evidence,'video_bytes');assert.ok(!/PRIVATE|synthetic-b|https:|lease-a/.test(JSON.stringify(report)),'no foreign users, raw identifiers or URLs');
 report=await read({from:now-300000});assert.equal(report.summary.meanStartupMs,2300,'recovery cannot replace original startup');assert.equal((await read({username:'synthetic-b'})).rows.length,0);assert.equal((await read({q:'Unused'})).channels.length,1);assert.equal((await read({folder:'unmatched'})).channels.length,0);
 assert.equal((await readChannelUsage(store,store.sql,{accountId:'account-a',from:now-32*86400000},catalog,now)).status,400);
 assert.equal((await readChannelUsage(store,store.sql,{accountId:'account-a',pageSize:500},catalog,now)).status,400);
 // Reusing an active lease and a timeout retain independently attributed sessions.
 await leases.put('active',{...lease,request_id:'active',startedAt:now-10000});await observeChannelUsage(store,store.sql,'active',{kind:'quality',reportId:'q1',watchMs:10000,stallMs:300,errors:1,decoded:20},now);await observeChannelUsage(store,store.sql,'active',{kind:'quality',reportId:'q1',watchMs:10000,stallMs:300,errors:1,decoded:20},now);
 report=await read({from:now-300000});assert.equal(report.summary.incidents,2);assert.equal(report.summary.active,1);assert.equal(report.summary.pendingIssues,1);
 await observeChannelUsage(store,store.sql,'active',{kind:'quality',reportId:'q2',watchMs:10000,stallMs:0,errors:0,decoded:20},now+1);report=await read({to:now+1});assert.equal(report.summary.pendingIssues,0);
 const call=async(path,body)=>{const r=await accountsFetch({storage:store},{},new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 await store.put('exclusive:index',{ids:catalog.map(c=>c.id),revision:1});for(const c of catalog)await store.put('exclusive:item:'+c.id,c);await store.put('playback:'+lease.sid,{request_id:'active'});
 const scope={sid:lease.sid,lease_id:'active',request_id:'active',exclusiveId:row.id,parentId:row.id,playbackRevision:1};
 assert.equal((await call('/channel-usage-observe',{...scope,sid:'foreign',kind:'failure',code:'upstream_http'})).status,410);
 assert.equal((await call('/channel-usage-observe',{...scope,kind:'failure',code:'https://private.invalid/password=secret'})).status,400);
 assert.equal((await call('/channel-usage-observe',{...scope,kind:'failure',code:'upstream_http'})).status,200);
 assert.equal((await call('/heartbeat',{...scope,localVideo:true})).body.localVideoProbe,true);
 assert.equal((await call('/local-startup-observe',{...scope,stage:'firstVideoBytes',durationMs:4500})).status,200);
 assert.equal((await read()).summary.pendingIssues,0);
 const failedBody={sid:lease.sid,username:user.username,uid:user.id,version:1,request_id:'active',exclusiveId:row.id,playbackRevision:1,live:true};
 const beforeCount=await leases.count({uid:user.id});assert.equal((await call('/channel-startup-failure',failedBody)).status,200);assert.equal((await call('/channel-startup-failure',failedBody)).status,200);assert.equal(await leases.count({uid:user.id}),beforeCount,'failed resolver records never reserve a slot');const failedReport=await(await readChannelUsage(store,store.sql,{accountId:'account-a',from:now-100000,to:Date.now(),pageSize:10},catalog,Date.now())).json();const failed=failedReport.rows.filter(r=>r.durationMs===0&&r.incidentCount===1);assert.equal(failed.length,1,'replaying failed resolution does not duplicate a session');
 await store.put('exclusive:item:'+row.id,{...row,visible:false});assert.equal((await call('/channel-usage-observe',{...scope,kind:'failure',code:'upstream_http'})).status,410);
 assert.equal((await call('/reseller-channel-usage',{accountId:'account-b',pageSize:10})).body.rows.every(r=>r.username===foreign.username),true);
 if(sql){store.calls=[];await read();assert.ok(store.calls.some(c=>c.q.includes('account_id=?')&&c.args[0]==='account-a'));store.db.close();}
}
console.log('PASS: scoped SQLite/KV channel usage, zero-use channels, immutable identity, legacy exclusion, overlap clipping, durations, failures/recovery, metric deduplication, safe projections, pagination bounds and current-lease authorization.');

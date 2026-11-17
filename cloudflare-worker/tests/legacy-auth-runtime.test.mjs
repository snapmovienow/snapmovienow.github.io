import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';

class Store{
 data=new Map();queue=Promise.resolve();
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){return this.data.delete(k);}
 async deleteAll(){this.data.clear();}
 async setAlarm(){}
 async list({prefix='',end,limit}={}){let entries=[...this.data].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>a.localeCompare(b));if(limit)entries=entries.slice(0,limit);return new Map(structuredClone(entries));}
 transaction(fn){const r=this.queue.then(async()=>{const previous=structuredClone(this.data);try{return await fn(this);}catch(error){this.data=previous;throw error;}});this.queue=r.catch(()=>{});return r;}
}
function fixture({clearFails=false,beginFails=false}={}){
 const objects=new Map(),env={TICKET_SECRET:'synthetic-legacy-runtime-secret-only',ENVIRONMENT:'production'};
 env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,options)=>{
  const path=new URL(url).pathname;
  if(clearFails&&path==='/accounts/legacy-auth-success'||beginFails&&path==='/accounts/legacy-auth-begin')throw Error('synthetic-private-budget-unavailable');
  return objects.get(id).fetch(new Request(url,options));
 }};}};
 const call=async(body,client='192.0.2.11')=>{
  const response=await worker.fetch(new Request('https://api.snaptvnow.com/',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':client},body:JSON.stringify(body)}),env);
  return{response,status:response.status,data:await response.json()};
 };
 return{call,objects,env};
}

test('real Worker rejects excess legacy logins before upstream and leaves active sessions/catalog outside the auth budget',async()=>{
 const originalFetch=globalThis.fetch,originalLog=console.log,originalNow=Date.now;
 let authReads=0,catalogReads=0;
 Date.now=()=>1800000000000;console.log=()=>{};
 globalThis.fetch=async raw=>{
  const u=new URL(raw);assert.equal(u.pathname,'/player_api.php','only synthetic provider adapter is used');
  if(u.searchParams.has('action')){catalogReads++;return Response.json([]);}
  authReads++;return Response.json({user_info:{auth:u.searchParams.get('password')==='synthetic-valid-password'?1:0,status:'Active',max_connections:3}});
 };
 try{
  const f=fixture();
  for(let i=0;i<10;i++)assert.equal((await f.call({op:'auth',username:'LegacyViewer',password:'synthetic-wrong'})).status,401);
  const denied=await f.call({op:'auth',username:'LEGACYVIEWER',password:'synthetic-valid-password',client:'untrusted-body-client'});
  assert.equal(denied.status,429);assert.equal(denied.response.headers.get('Retry-After'),'900');assert.equal(authReads,10,'blocked login never reaches upstream');
  const otherNetwork=await f.call({op:'auth',username:'LegacyViewer',password:'synthetic-valid-password'},'192.0.2.12');assert.equal(otherNetwork.status,200);
  assert.equal((await f.call({op:'session_info',access_token:otherNetwork.data.access_token})).status,200);

  const n=fixture();authReads=0;
  const valid=await n.call({op:'auth',username:'ActiveViewer',password:'synthetic-valid-password'});assert.equal(valid.status,200);
  for(let i=0;i<119;i++)assert.equal((await n.call({op:'auth',username:'spray-'+i,password:'synthetic-wrong'})).status,401);
  assert.equal((await n.call({op:'auth',username:'spray-next',password:'synthetic-valid-password'})).status,429);assert.equal(authReads,120);
  const state=n.objects.get('__smn_accounts_v1').state.storage,budgetBefore=JSON.stringify([...state.data].filter(([k])=>k.startsWith('legacy-auth-')));
  for(let i=0;i<130;i++)assert.equal((await n.call({op:'session_info',access_token:valid.data.access_token})).status,200);
  assert.equal((await n.call({op:'vod',access_token:valid.data.access_token})).status,200);assert.equal(catalogReads,1);
  const expired=await worker.fetch(new Request('https://api.snaptvnow.com/stream?t=invalid'),n.env);assert.equal(expired.status,410);await expired.body.cancel();
  assert.equal(JSON.stringify([...state.data].filter(([k])=>k.startsWith('legacy-auth-'))),budgetBefore,'authenticated traffic and media do not touch login counters');
  const cleanupFailure=fixture({clearFails:true}),created=await cleanupFailure.call({op:'auth',username:'ActiveViewer',password:'synthetic-valid-password'});
  assert.equal(created.status,200,'optional counter cleanup failure cannot orphan a verified session');assert.equal((await cleanupFailure.call({op:'session_info',access_token:created.data.access_token})).status,200);
  const unavailable=fixture({beginFails:true}),before=authReads;
  assert.equal((await unavailable.call({op:'auth',username:'ActiveViewer',password:'synthetic-valid-password'})).status,502);assert.equal(authReads,before,'required budget failure stays closed before upstream');
 }finally{globalThis.fetch=originalFetch;console.log=originalLog;Date.now=originalNow;}
});

import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k))}
 async put(k,v){if(typeof k==='object'){for(const [name,value]of Object.entries(k))this.data.set(name,structuredClone(value));}else this.data.set(k,structuredClone(v))}
 async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}
}
const objects=new Map(),env={TICKET_SECRET:'test-affinity-secret-only',ADMIN_SETUP_SECRET:'test-affinity-setup-12345678901234567890'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {async fetch(url,options){
 return objects.get(id).fetch(new Request(url,options));
}}}};
let offset=0;const now=Date.now;Date.now=()=>now()+offset;
const row=id=>['<a>'+id+'</a>','<a>source'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="source-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=fixture; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:1,data:[1].map(row)});
 if(u.pathname==='/player_api.php'){
  const action=u.searchParams.get('action');if(action==='get_vod_streams')return Response.json([44,45].map(stream_id=>({stream_id,name:'Fixture movie '+stream_id,container_extension:'mp4'})));if(action==='get_live_streams')return Response.json([10,11,12,13].map(stream_id=>({stream_id,name:'Channel '+stream_id})));
  if(action)return Response.json([]);return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
 }
 if(u.pathname.startsWith('/live/')){
  return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([0x47,1,2,3]))}}),{headers:{'content-type':'video/mp2t'}});
 }
 throw Error('Unexpected fixture request');
};
const origin='https://api.example.com',ctx={waitUntil(p){void p.catch(()=>{})}};
const post=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');
const token=(await post({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token;
const admin=(action,body={})=>post({action,access_token:token,...body},'/admin');
await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'});
await admin('save',{create:true,username:'fixture-user',password:'viewer-password-test',status:'active'});
const headers=()=>({'CF-Connecting-IP':'198.51.100.10','User-Agent':'IPTVSmarters-fixture'});
const api=async client=>{const r=await worker.fetch(new Request(origin+'/player_api.php?username=fixture-user&password=viewer-password-test&action=get_live_streams',{headers:headers(client)}),env,ctx);assert.equal(r.status,200);return r.json()};
const channels=await api('smarters');
const storage=objects.get('__smn_accounts_v1').state.storage,leases=await openLeaseStore(storage);
// A third-party player can have minutes of buffered VOD while its HTTP
// connection remains open. A pause in downstream reads is not source silence.
const fixtureBytes=Uint8Array.from({length:4096},(_,i)=>i%251);
const savedFetch=globalThis.fetch,savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
let movieOpens=0;
globalThis.fetch=(url,options={})=>{
 if(new URL(url).pathname.startsWith('/movie/')){
  movieOpens++;let sent=0;
  return Promise.resolve(new Response(new ReadableStream({pull(c){
   if(sent===fixtureBytes.length){c.close();return}
   const end=Math.min(sent+64,fixtureBytes.length);c.enqueue(fixtureBytes.slice(sent,end));sent=end;
  }}),{status:206,headers:{'content-type':'video/mp4','content-length':String(fixtureBytes.length),'content-range':`bytes 0-${fixtureBytes.length-1}/${fixtureBytes.length}`,'accept-ranges':'bytes'}}));
 }
 return savedFetch(url,options);
};
try{
 const listed=await worker.fetch(new Request(origin+'/player_api.php?username=fixture-user&password=viewer-password-test&action=get_vod_streams',{headers:headers('smarters')}),env,ctx);
 const movies=await listed.json();
 let tick;
 globalThis.setInterval=(fn,ms)=>ms===25000?(tick=fn,1):savedInterval(fn,ms);
 globalThis.clearInterval=id=>{if(id!==1)savedClear(id)};
 const response=await worker.fetch(new Request(origin+'/movie/fixture-user/viewer-password-test/'+movies[0].stream_id+'.mp4',{
  headers:{'CF-Connecting-IP':'198.51.100.10','User-Agent':'VLC/3.0.21 LibVLC/3.0.21',Range:'bytes=0-4095'}
 }),env,ctx);
 assert.equal(response.status,206);
 assert.equal(response.headers.get('content-range'),'bytes 0-4095/4096');
 const reader=response.body.getReader(),first=await reader.read();
 assert.equal(first.done,false);assert.equal(await leases.count(),1);
 await new Promise(resolve=>setTimeout(resolve,0));
 for(let step=1;step<=13;step++){
  offset+=25000;await tick();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(await leases.count(),1,'an authorized buffered movie retains its exact reservation');
 }
 const received=[...first.value];
 for(;;){const next=await reader.read();if(next.done)break;received.push(...next.value)}
 assert.deepEqual(received,[...fixtureBytes],'reading after the pause resumes the exact file without a restart');
 assert.equal(movieOpens,1,'a buffered consumer does not reopen the upstream file');
 assert.equal(await leases.count(),0,'finite VOD completion still releases the reservation');
 console.log(JSON.stringify({normalXtreamMovie:true,client:'VLC',nativeMonitorHeader:false,consumerReadPauseMs:325000,sourceOpens:movieOpens,exactBytes:received.length,reservationReleased:true}));
 // TV continues to apply the existing silence/idle limit.
 offset=0;tick=undefined;
 const live=await worker.fetch(new Request(origin+'/live/fixture-user/viewer-password-test/'+channels[0].stream_id+'.ts',{headers:headers('smarters')}),env,ctx);
 const liveReader=live.body.getReader();await liveReader.read();
 const pending=liveReader.read(),rejected=assert.rejects(pending,/stream_idle/);
 await new Promise(resolve=>setTimeout(resolve,0));offset+=25000;await tick();offset+=25001;await tick();await rejected;
 assert.equal(await leases.count(),0,'a stalled live response still releases at the existing guard');
 console.log('PASS: third-party VOD survives downstream backpressure beyond five minutes; exact bytes, range and release preserved; live source idle guard unchanged.');
}finally{
 offset=0;Date.now=now;globalThis.fetch=savedFetch;globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;
}

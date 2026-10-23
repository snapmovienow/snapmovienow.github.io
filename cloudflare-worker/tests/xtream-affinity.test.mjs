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
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const validations=[],signals=[];let failedSource=null,offset=0;const now=Date.now;Date.now=()=>now()+offset;
const row=id=>['<a>'+id+'</a>','<a>source'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="source-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=fixture; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:3,data:[1,2,3].map(row)});
 if(u.pathname==='/player_api.php'){
  const action=u.searchParams.get('action');if(action==='get_vod_streams')return Response.json([{stream_id:44,name:'Fixture movie',container_extension:'mp4'}]);if(action==='get_live_streams')return Response.json([10,11,12,13].map(stream_id=>({stream_id,name:'Channel '+stream_id})));
  if(action)return Response.json([]);validations.push(u.searchParams.get('username'));return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
 }
 if(u.pathname.startsWith('/movie/')){signals.push(u.pathname.split('/')[2]);return new Response('fixture video',{status:206,headers:{'content-type':'video/mp4','content-length':'13','content-range':'bytes 0-12/100'}});}
 if(u.pathname.startsWith('/live/')){
  const source=u.pathname.split('/')[2];signals.push(source);
  if(failedSource==='*'||source===failedSource)return new Response('unavailable',{status:503});
  if(u.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([0x47,1,2,3]))}}),{headers:{'content-type':'video/mp2t'}});
 }
 if(u.pathname==='/segment.ts')return new Response(new Uint8Array([0x47,1,2,3]),{headers:{'content-type':'video/mp2t'}});
 throw Error('Unexpected fixture request');
};
const origin='https://api.example.com',ctx={waitUntil(p){void p.catch(()=>{})}};
const post=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');
const token=(await post({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token;
const admin=(action,body={})=>post({action,access_token:token,...body},'/admin');
await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'});
await admin('save',{create:true,username:'fixture-user',password:'viewer-password-test',status:'active'});
const headers=client=>({'CF-Connecting-IP':'198.51.100.10','User-Agent':client==='smarters'?'IPTVSmarters-fixture':'LegacyRebrand-fixture'});
const api=async client=>{const r=await worker.fetch(new Request(origin+'/player_api.php?username=fixture-user&password=viewer-password-test&action=get_live_streams',{headers:headers(client)}),env,ctx);assert.equal(r.status,200);return r.json()};
const channels=await api('smarters');await api('legacy');validations.length=0;
const storage=objects.get('__smn_accounts_v1').state.storage,leases=await openLeaseStore(storage);
const play=async(client,index,ext)=>{const r=await worker.fetch(new Request(origin+'/live/fixture-user/viewer-password-test/'+channels[index].stream_id+'.'+ext,{headers:headers(client)}),env,ctx);assert.equal(r.status,200);return r};
const only=async()=>[...(await leases.active()).values()][0];
let r=await play('smarters',0,'ts');const initial=await only();assert.deepEqual(validations,['source1']);
await r.body.cancel();assert.equal(await leases.count(),0);
// Both legacy app shapes use ordinary Xtream endpoints, with no native UUID,
// native release endpoint or APK-specific headers required for sticky routing.
await storage.put('provider-health',{'account|2':{at:Date.now(),ok:true,ms:1}});
r=await play('smarters',1,'m3u8');await r.text();assert.equal((await only()).provider_id,initial.provider_id);assert.equal(validations.length,1,'a quick channel change does not repeat source account validation');
r=await play('smarters',2,'ts');const late=r;assert.equal((await only()).provider_id,initial.provider_id);
r=await play('smarters',3,'ts');await late.body.cancel();assert.equal(await leases.count(),1,'late TS close preserves the newer channel');await r.body.cancel();
await storage.put('provider-health',{'account|2':{at:Date.now(),ok:true,ms:1}});
const legacy=await play('legacy',0,'ts'),legacyLease=await only();assert.equal(legacyLease.provider_id,'1','new app sessions retain the user assignment while counting separate slots');
r=await play('smarters',0,'m3u8');await r.text();let active=await leases.active();assert.equal(active.size,2);assert.equal([...active.values()].find(l=>l.sid!==legacyLease.sid).provider_id,'1');
await legacy.body.cancel();assert.equal(await leases.count(),1,'different apps on the same IP have independent bindings and slots');
offset+=31000;r=await play('smarters',1,'m3u8');await r.text();assert.equal(validations.filter(v=>v==='source1').length,2,'validation refreshes after thirty seconds while the CCF account remains assigned');
failedSource='source1';r=await play('smarters',2,'ts');assert.equal((await only()).provider_id,'2');assert.deepEqual(signals.slice(-2),['source1','source2']);await r.body.cancel();
failedSource=null;r=await play('smarters',3,'m3u8');await r.text();assert.equal((await only()).provider_id,'2','successful failover becomes the new stable assignment');
const source2=(await only()).provider_id;
for(let i=0;i<6;i++){r=await play('smarters',i%4,i%2?'ts':'m3u8');if(i%2)await r.body.cancel();else await r.text();const rows=await leases.active();assert.ok(rows.size<=1);assert.ok([...rows.values()].every(l=>l.provider_id===source2));}
failedSource='*';
const broken=await worker.fetch(new Request(origin+'/live/fixture-user/viewer-password-test/'+channels[0].stream_id+'.ts',{headers:headers('smarters')}),env,ctx);
assert.ok(broken.status>=500);await broken.body.cancel();assert.equal(await leases.count(),0);
assert.equal((await storage.get('playback:'+initial.sid)).affinities.ccf,undefined,'failed TS response cancellation cannot repin the last failed source');failedSource=null;
// The same affinity/recent validation applies to movie and episode byte ranges.
const moviesResponse=await worker.fetch(new Request(origin+'/player_api.php?username=fixture-user&password=viewer-password-test&action=get_vod_streams',{headers:headers('smarters')}),env,ctx),movies=await moviesResponse.json();
const vodUrl=origin+'/movie/fixture-user/viewer-password-test/'+movies[0].stream_id+'.mp4',beforeValidation=validations.length;
for(let i=0;i<3;i++){const vod=await worker.fetch(new Request(vodUrl,{headers:{...headers('smarters'),Range:'bytes=0-12'}}),env,ctx);assert.equal(vod.status,206);assert.equal(await vod.text(),'fixture video');assert.equal(validations.length,beforeValidation,'fresh media proof avoids another metadata validation when opening VOD');}
const auth=(await post({op:'auth',username:'fixture-user',password:'viewer-password-test'})).data.access_token;
await admin('save',{username:'fixture-user',password:'changed-viewer-password-test',status:'active'});
const stale=await worker.fetch(new Request(origin+'/player_api.php?username=fixture-user&password=viewer-password-test',{headers:headers('smarters')}),env,ctx);assert.equal(stale.status,401);
assert.equal((await post({op:'playback_heartbeat',access_token:auth,lease_id:initial.lease_id})).status,401);assert.equal(await leases.count(),0);
console.log('PASS: real Xtream HTTP routing for Smarters and legacy rebrand retains CCF source across TS/HLS and rapid zapping, skips only recent validation, fails over once and keeps viewers/revocation isolated.');

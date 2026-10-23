import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
import {ownPlaybackCanaryAdapter} from '../src/own-playback-canary.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
{
 const storage=new Store(),requests=[],prepared=[],controller=new AbortController(),session={sid:'dedicated-canary-session',token:'private-test-token'};
 let preferred=null,bad=new Set(['1']),catalogReads=0;
 const adapter=ownPlaybackCanaryAdapter({env:{ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'testowner'},storage,directory:async(env,path,body)=>{assert.equal(path,'/canary-sample');assert.equal(body.username,'testowner');return Response.json({sample:preferred})},request:async request=>{
  const body=await request.json();assert.equal(body.access_token,session.token);requests.push(body.op);
  if(body.op==='live'){catalogReads++;return Response.json([{stream_id:1,name:'First dead channel'},{stream_id:2,name:'Working channel'},{stream_id:3,name:'Another working channel'}])}
  if(body.op==='stream_token'){prepared.push(body);assert.equal(body.ext,'ts','live fallback follows the installed app TS transport');return bad.has(body.id)?Response.json({error:'sample_missing'},{status:body.id==='99'?403:404}):Response.json({url:'https://api.snaptvnow.com/stream?t=private-test-ticket'})}
  throw Error('unexpected operation');
 }});
 const select=()=>adapter.select(session,{username:'testowner',type:'live'},{signal:controller.signal});
 let selected=await select();assert.equal(selected.type,'live');assert.deepEqual(prepared.map(b=>b.id),['1','2'],'invalid first catalog candidate rotates immediately');
 assert.equal(await storage.get('canary-sample-cursor:live'),2);
 await storage.delete('canary-sample:live');await select();assert.equal(prepared.at(-1).id,'3','failed open/cleared sample advances durable cursor rather than repeating first row');
 preferred={type:'live',id:'99',server:'ccf',ext:'ts'};const before=catalogReads;await select();assert.equal(prepared.at(-1).id,'99');assert.equal(catalogReads,before,'recent successful sample is prepared before reading the catalog');
 bad.add('99');preferred={type:'live',id:'99',server:'ccf',ext:'ts'};await storage.delete('canary-sample:live');await select();assert.notEqual(prepared.at(-1).id,'99','known sample still uses normal signed permission/preparation checks and can fall back');
 assert.ok(prepared.every(b=>b.request_id&&Number.isInteger(b.revision)));assert.equal(session.sid,'dedicated-canary-session');
 assert.ok(!JSON.stringify(selected).includes(session.token),'target does not expose the normal account token');
}
const objects=new Map(),env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'testowner',TICKET_SECRET:'test-canary-secret-only',ADMIN_SETUP_SECRET:'test-setup-secret-long-enough-1234567890'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store(),waitUntil:p=>void p.catch(()=>{})},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
const originalFetch=globalThis.fetch;let blocked=false;
const video=new Uint8Array(188);video.set([0x47,0x40,0,0x10]);
globalThis.fetch=async(url,opts={})=>{const u=new URL(url),action=u.searchParams.get('action');
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:1,data:[['<a>1</a>','<a>source1</a>','<span class="table-trunc-copy-cell__text tooltip" title="source-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01']]});
 if(u.pathname==='/player_api.php'){
  if(action==='get_live_streams')return Response.json([{stream_id:123,name:'Canary channel'}]);
  if(action==='get_series')return Response.json([{series_id:456,name:'Canary series'}]);
  if(action==='get_series_info')return Response.json({info:{name:'Canary series'},episodes:{1:[{id:789,title:'Episode',season:1,episode_num:1,container_extension:'ts'}]}});
  if(action)return Response.json([]);return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
 }
 if(blocked)return new Response('unavailable',{status:503});
 if(u.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 return new Response(video,{headers:{'content-type':'video/mp2t','content-length':String(video.length)}});
};
const origin='https://api.snaptvnow.com',pending=[],ctx={waitUntil:p=>pending.push(p)},call=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
try{
 await call({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');
 const adminToken=(await call({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token,admin=(action,body={})=>call({action,access_token:adminToken,...body},'/admin');
 assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'})).status,200);
 for(const username of ['testowner','customer'])assert.equal((await admin('save',{create:true,username,password:'viewer-password-test',status:'active'})).status,200);
 const customerToken=(await call({op:'auth',username:'customer',password:'viewer-password-test'})).data.access_token;
 assert.equal((await call({op:'stream_token',access_token:customerToken,type:'live',id:123,ext:'m3u8',request_id:'customer-playback',revision:1})).status,200);
 const leases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage),before=[...(await leases.active()).values()];assert.equal(before.length,1);
 const probe=async username=>{const r=await env.PLAYBACK_SESSIONS.get('__smn_canary_v1').fetch('https://private/canary-run',{method:'POST',body:JSON.stringify({username,type:'live'})});return {status:r.status,data:await r.json()}};
 assert.equal((await probe('customer')).status,403,'private probe cannot select any customer account');
 let result=await probe('testowner');assert.equal(result.status,200);assert.equal(result.data.ok,true,JSON.stringify(result.data));assert.equal(result.data.status,'healthy');assert.ok(result.data.bytes>0);assert.ok(!JSON.stringify(result.data).includes('testowner'));assert.ok(!JSON.stringify(result.data).includes('source-password'));
 assert.deepEqual([...(await leases.active()).values()].map(v=>v.sid),before.map(v=>v.sid),'only the dedicated canary session is released');
 for(const object of objects.values())if((await object.state.storage.get('identity'))?.username==='testowner')assert.fail('canary session must be deleted after completion');
 blocked=true;result=await probe('testowner');assert.equal(result.data.ok,false);assert.equal(await leases.count(),1,'source failure cannot leak probe reservations or remove the customer');
 assert.equal((await call({username:'testowner',type:'live'},'/canary-run')).status,403,'private adapter is not a public route');
 await Promise.all(pending);console.log('PASS: recent successful sample selection, bounded durable rotation, signed TS playback and permission/capacity checks; own-session cleanup and customer isolation on success and failure.');
}finally{globalThis.fetch=originalFetch}

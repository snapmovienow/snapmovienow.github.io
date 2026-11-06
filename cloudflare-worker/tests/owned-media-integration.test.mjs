import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {OWNED_MEDIA_FILES,OWNED_MEDIA_ORIGIN,OWNED_MEDIA_SERIES,ownedMediaForEpisode} from '../src/owned-media-source.mjs';
import {EMPRESS_SERIES_META,EMPRESS_EPISODES} from '../src/empress-catalog.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){if(Array.isArray(key))return new Map(key.filter(key=>this.data.has(key)).map(key=>[key,structuredClone(this.data.get(key))]));return structuredClone(this.data.get(key));}
 async put(key,value){if(typeof key==='object')for(const [k,v]of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}async deleteAll(){this.data.clear();}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={TICKET_SECRET:'owned-media-fixture-encryption-secret',ADMIN_SETUP_SECRET:'owned-media-fixture-admin-setup-secret',SNAP_OWNED_MEDIA_SITE_TOKEN:'fixture-private-site-credential-01234567890123456789'};
const objects=new Map();env.PLAYBACK_SESSIONS={idFromName:name=>name,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,init)=>objects.get(id).fetch(new Request(url,init))};}};
const origin='https://api.snaptvnow.com',customer={username:'owned-media-client',password:'owned-media-customer-fixture-password'},body=new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
const post=async(value,path='/')=>{const response=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(value)}),env);return{status:response.status,data:await response.json()};};
const call=(path,value)=>env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_xtream_catalog_v1')).fetch('https://private/accounts'+path,{method:'POST',body:JSON.stringify(value)});
const originalNow=Date.now;Date.now=()=>Date.parse('2026-11-04T19:00:00Z');
const originalFetch=globalThis.fetch,served=[];let savedTicket;
globalThis.fetch=async(target,init={})=>{
 const url=new URL(target);assert.equal(url.origin,OWNED_MEDIA_ORIGIN);assert.equal(init.redirect,'manual');
 const headers=new Headers(init.headers);assert.equal(headers.get('OAI-Sites-Authorization'),'Bearer '+env.SNAP_OWNED_MEDIA_SITE_TOKEN);
 const source=OWNED_MEDIA_FILES.find(file=>file.url===url.href);assert.ok(source,'private requests are restricted to the eight copies');
 const ticket=headers.get('Authorization')?.slice(7);assert.ok(ticket);savedTicket={ticket,id:source.id};
 const authorized=await worker.fetch(new Request(origin+'/exclusive-owned-authorize',{method:'POST',body:JSON.stringify({ticket,id:source.id,range:headers.get('range'),head:init.method==='HEAD'})}),env);
 assert.equal(authorized.status,200,await authorized.clone().text());assert.deepEqual(await authorized.json(),{ok:true,id:source.id});served.push(source.exclusiveId);
 if(headers.get('range')==='bytes=9999999999-')return new Response(null,{status:416,headers:{'content-range':'bytes */'+source.size}});
 return new Response(init.method==='HEAD'?null:body,{status:headers.has('range')?206:200,headers:{'content-type':'video/mp4','content-length':String(body.length),'accept-ranges':'bytes',...(headers.has('range')?{'content-range':'bytes 0-15/'+source.size}:{})}});
};
try{
 assert.equal((await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owned-media-admin-fixture-password'},'/admin')).status,200);
 const login=await post({action:'login',username:'owner',password:'owned-media-admin-fixture-password'},'/admin');assert.equal(login.status,200);
 const admin=(action,value={})=>post({action,...value,access_token:login.data.access_token},'/admin');
 assert.equal((await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{series:true,movies:false,tv:false,adults:false}})).status,200);
 const item={...EMPRESS_SERIES_META,type:'series',mode:'direct',source:'SNAPTVNOW · COPIA PROPIA',page:'',visible:true,adult:false,episodes:EMPRESS_EPISODES.map(episode=>({...episode,page:ownedMediaForEpisode(episode.id).url,alternatives:episode.alternatives.map(option=>({...option,page:ownedMediaForEpisode(option.id).url}))}))};
 assert.equal((await admin('exclusive-save',{item,revision:0})).status,200);
 const ids=await(await call('/xtream-register',{entries:OWNED_MEDIA_FILES.map(file=>({kind:'episode',server:'smn-owned-series',upstreamId:String(file.episode*1000+file.option),parentId:'1',ext:'mp4'}))})).json();
 for(const [index,file]of OWNED_MEDIA_FILES.entries()){
  const response=await worker.fetch(new Request(origin+'/series/'+customer.username+'/'+customer.password+'/'+ids[index]+'.mp4',{headers:{Range:'bytes=0-15','User-Agent':'Owned-DNS-Fixture/1','CF-Connecting-IP':'198.51.100.30'}}),env);
  assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'video/mp4');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),body);assert.equal(served.at(-1),file.exclusiveId);
  assert.equal([...response.headers.values()].join(' ').includes(env.SNAP_OWNED_MEDIA_SITE_TOKEN),false);
 }
 const webLogin=await post({op:'auth',...customer});assert.equal(webLogin.status,200);let revision=0,previous;
 for(const file of OWNED_MEDIA_FILES){
  const prepared=await post({op:'gnula_token',access_token:webLogin.data.access_token,id:file.exclusiveId,request_id:crypto.randomUUID(),revision:++revision});assert.equal(prepared.status,200);
  assert.equal(new URL(prepared.data.url).origin,origin);assert.equal(JSON.stringify(prepared.data).includes('.chatgpt.site'),false);
  const appRange=(range,method='GET')=>worker.fetch(new Request(prepared.data.url,{method,headers:{Range:range}}),env);
  if(previous){const stale=await worker.fetch(new Request(previous),env);assert.equal(stale.status,410,'an option change revokes the previous ticket');await stale.body?.cancel();}
  const head=await appRange('bytes=0-15','HEAD');assert.equal(head.status,206);
  const first=await appRange('bytes=0-15');assert.equal(first.status,206);assert.deepEqual(new Uint8Array(await first.arrayBuffer()),body);
  const cancelled=await appRange('bytes=0-15');assert.equal(cancelled.status,206);await cancelled.body.cancel();
  assert.equal((await appRange('bytes=9999999999-')).status,416);
  const retry=await appRange('bytes=0-15');assert.equal(retry.status,206);assert.deepEqual(new Uint8Array(await retry.arrayBuffer()),body);assert.equal(served.at(-1),file.exclusiveId);
  previous=prepared.data.url;
  if(file===OWNED_MEDIA_FILES.at(-1)){
   const released=await post({op:'playback_release',access_token:webLogin.data.access_token,lease_id:prepared.data.lease_id,request_id:prepared.data.request_id});assert.equal(released.status,200);
   const stale=await appRange('bytes=0-15');assert.equal(stale.status,410,'closing playback still revokes the ticket');await stale.body?.cancel();
  }
 }
 const wrong=await post({...savedTicket,id:OWNED_MEDIA_FILES.find(file=>file.id!==savedTicket.id).id},'/exclusive-owned-authorize');assert.equal(wrong.status,403);
 assert.equal((await post({ticket:'x'.repeat(60),id:OWNED_MEDIA_FILES[0].id},'/exclusive-owned-authorize')).status,403);
 assert.equal((await post({ticket:'',id:OWNED_MEDIA_FILES[0].id},'/exclusive-owned-authorize')).status,401);
 const oversized=await worker.fetch(new Request(origin+'/exclusive-owned-authorize',{method:'POST',body:'x'.repeat(20001)}),env);assert.equal(oversized.status,413);
 const dnsRange=range=>worker.fetch(new Request(origin+'/series/'+customer.username+'/'+customer.password+'/'+ids[0]+'.mp4',{headers:{Range:range,'User-Agent':'Owned-DNS-Fixture/1','CF-Connecting-IP':'198.51.100.30'}}),env);
 const invalidRange=await dnsRange('bytes=9999999999-');assert.equal(invalidRange.status,416);assert.equal(invalidRange.headers.get('content-range'),'bytes */'+OWNED_MEDIA_FILES[0].size);
 const leases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage),[dnsLease]=await leases.active();
 assert.ok(dnsLease,'the DNS playback survives an unsatisfiable range');assert.equal(dnsLease[1].exclusiveId,OWNED_MEDIA_FILES[0].exclusiveId);
 for(const response of await Promise.all([dnsRange('bytes=0-15'),dnsRange('bytes=0-15')])){assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),body);}
 assert.deepEqual([...(await leases.active()).keys()],[dnsLease[0]],'parallel requests reuse the DNS lease');
 const info=await post({op:'gnula_catalog',access_token:webLogin.data.access_token});assert.equal(info.status,200);assert.ok(JSON.stringify(info.data).includes(item.name),'legacy app catalog retains the migrated series');assert.equal(JSON.stringify(info.data).includes(OWNED_MEDIA_ORIGIN),false);
 assert.equal((await admin('exclusive-save',{item:{...item,visible:false},revision:1})).status,200);
 const hidden=await worker.fetch(new Request(origin+'/series/'+customer.username+'/'+customer.password+'/'+ids[0]+'.mp4'),env);assert.equal(hidden.status,404);
 assert.equal((await leases.active()).size,0);
 console.log('PASS: eight DNS and eight app routes preserve the selected copy across range completion, cancellation, HEAD, 416 and concurrent DNS reads. Explicit close and hide revoke playback.');
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}

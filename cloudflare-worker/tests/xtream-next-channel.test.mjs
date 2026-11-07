import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k))}
 async put(k,v){if(typeof k==='object')for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value));else this.data.set(k,structuredClone(v))}
 async delete(k){this.data.delete(k)}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}
 transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result}
}
const objects=new Map(),env={TICKET_SECRET:'variant-runtime-secret',ADMIN_SETUP_SECRET:'variant-runtime-setup-secret-long'},pending=[];
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
const originalFetch=globalThis.fetch,calls=[];let catalogReads=0,allMissing=false;
globalThis.fetch=async(value,opts={})=>{
 const u=new URL(value);assert.equal(u.origin,'http://ccf.center:8444');
 if(u.pathname==='/player_api.php'){
  const action=u.searchParams.get('action');if(!action)return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
  catalogReads++;if(action==='get_live_categories')return Response.json([{category_id:1,category_name:'Peru'}]);
  if(action==='get_live_streams')return Response.json([{stream_id:55,name:'PER-ATV (M)(720)',category_id:1},{stream_id:56,name:'PER-ATV (L)(720)',category_id:1},{stream_id:57,name:'PER-ATV (TV)(720)',category_id:1},{stream_id:58,name:'PER-ATV (W)(720)',category_id:1},{stream_id:59,name:'PER-ATV (HD)(720)',category_id:1},{stream_id:60,name:'PER-Noticias',category_id:1},{stream_id:62,name:'Adult XXX',category_id:1},{stream_id:61,name:'PER-Cultura',category_id:1},{stream_id:63,name:'Other category',category_id:2}]);
  throw Error('unexpected catalog');
 }
 const matched=u.pathname.match(/^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(ts|m3u8)$/);
 if(matched){const [,account,,id,ext]=matched;calls.push({account,id,ext});if(id==='60'&&ext==='m3u8'&&!allMissing)return new Response('#EXTM3U\n#EXTINF:4,\n/dead-segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});if(id!=='61'||allMissing)return new Response('missing',{status:404});
  if(ext==='m3u8')return new Response('#EXTM3U\n#EXTINF:4,\n/segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([71,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]))}}),{headers:{'content-type':'video/mp2t'}});
 }
 if(u.pathname==='/dead-segment.ts')return new Response(null,{status:404});
 if(u.pathname==='/segment.ts')return new Response(new Uint8Array([71,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]),{headers:{'content-type':'video/mp2t'}});
 throw Error('unexpected source request');
};
const origin='https://api.snaptvnow.com',ctx={waitUntil:p=>pending.push(Promise.resolve(p).catch(()=>{}))};
const post=async(body,path='/admin')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
try{
 await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-synthetic'});
 const access_token=(await post({action:'login',username:'owner',password:'owner-password-synthetic'})).data.access_token;
 for(const username of ['source-primary','source-backup'])assert.equal((await post({action:'provider-save',access_token,mode:'single',url:'http://ccf.center:8444',username,password:'source-password-synthetic'})).status,200);
 const customer={username:'variant-viewer',password:'viewer-password-synthetic'};
 assert.equal((await post({action:'save',access_token,create:true,...customer,status:'active',permissions:{movies:true,series:true,tv:true,adults:false}})).status,200);
 const api=async action=>worker.fetch(new Request(origin+'/player_api.php?'+new URLSearchParams({...customer,action})),env,ctx);
 assert.equal((await api('get_live_categories')).status,200);
 const rows=await(await api('get_live_streams')).json(),chosen=rows.find(x=>x.smn_profile?.id==='55');assert.ok(chosen);
 const before=catalogReads;
 for(const ext of ['ts','m3u8']){
  calls.length=0;const r=await worker.fetch(new Request(origin+'/live/'+customer.username+'/'+customer.password+'/'+chosen.stream_id+'.'+ext),env,ctx);
  assert.equal(r.status,200);assert.deepEqual(calls.map(x=>x.id),['55','56','57','58','59','60','61']);assert.equal(r.headers.get('X-SMN-Live-Fallback'),'next-channel');
  if(ext==='ts'){const reader=r.body.getReader();assert.equal((await reader.read()).value[0],71);await reader.cancel();}
  else{
   const master=await r.text();assert.match(master,/#EXTM3U/);assert.ok(!master.includes('source-password-synthetic'));
   const target=master.split('\n').find(x=>x.startsWith('https://')),playlist=await worker.fetch(new Request(target),env,ctx),text=await playlist.text();
   const segment=text.split('\n').find(x=>x.startsWith('https://'));assert.ok(segment);const bytes=await worker.fetch(new Request(segment),env,ctx);assert.equal(new Uint8Array(await bytes.arrayBuffer())[0],71);
  }
 }
 assert.equal(catalogReads,before,'fallback uses existing snapshots without fetching provider catalogs');
 allMissing=true;calls.length=0;const failed=await worker.fetch(new Request(origin+'/live/'+customer.username+'/'+customer.password+'/'+chosen.stream_id+'.ts'),env,ctx);
 assert.equal(failed.status,404);assert.ok(calls.length<=13);assert.equal(new Set(calls.map(x=>x.id)).size,calls.length,'no failed channel is revisited');assert.ok(!calls.some(x=>['62','63'].includes(x.id)),'adult and other-category channels are never tried');

 // The native app owns its visible countdown; the server must not silently
 // replace its channel or interfere with its five-recovery policy.
 await objects.get('__smn_accounts_v1').state.storage.delete('provider-health');calls.length=0;
 const native=await worker.fetch(new Request(origin+'/live/'+customer.username+'/'+customer.password+'/'+chosen.stream_id+'.ts',{headers:{'X-SNAP-Playback-Monitor':'43cf32d9-75a8-43fc-9bd5-af4a9949ab5d'}}),env,ctx);
 assert.equal(native.status,404);await native.body?.cancel();assert.ok(!calls.some(x=>Number(x.id)>=60));assert.ok(calls.length<=3);
 calls.length=0;const denied=await worker.fetch(new Request(origin+'/live/'+customer.username+'/wrong-password/'+chosen.stream_id+'.ts'),env,ctx);assert.equal(denied.status,401);await denied.body?.cancel();assert.equal(calls.length,0);
 const leases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage);assert.equal(await leases.count(),0,'all failed allocations are released');
 await Promise.all(pending);
 console.log('PASS: five failed source attempts advance across dead channels to real TS/HLS bytes; signed segments, adult/category boundaries, native-client ownership, authentication and lease cleanup hold.');
}finally{globalThis.fetch=originalFetch}


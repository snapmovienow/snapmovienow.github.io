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
const originalFetch=globalThis.fetch,calls=[];let catalogReads=0,allMissing=false,multivariant=false,refreshes=0;
globalThis.fetch=async(value,opts={})=>{
 const u=new URL(value);assert.equal(u.origin,'http://ccf.center:8444');
 if(u.pathname==='/player_api.php'){
  const action=u.searchParams.get('action');if(!action)return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
  catalogReads++;if(action==='get_live_categories')return Response.json([{category_id:1,category_name:'Peru'}]);
  if(action==='get_live_streams')return Response.json([{stream_id:55,name:'PER-ATV (M)(720)',category_id:1},{stream_id:56,name:'PER-ATV (L)(720)',category_id:1},{stream_id:57,name:'PER-ATV+ (L)(720)',category_id:1}]);
  throw Error('unexpected catalog');
 }
 const matched=u.pathname.match(/^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(ts|m3u8)$/);
 if(matched){const [,account,,id,ext]=matched;calls.push({account,id,ext});if(id!=='56'||allMissing)return new Response('missing',{status:404});
  if(ext==='m3u8'&&multivariant)return new Response([
   '#EXTM3U',
   '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Castellano",URI="hls/audio.m3u8"',
   '#EXT-X-STREAM-INF:BANDWIDTH=1200000,AUDIO="audio"',
   'hls/video.m3u8'
  ].join('\n'),{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  if(ext==='m3u8')return new Response('#EXTM3U\n#EXTINF:4,\n/segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([71,1,2,3]))}}),{headers:{'content-type':'video/mp2t'}});
 }
 const sourceFolder=`/live/${calls.at(-1)?.account}/source-password-synthetic/hls/`;
 if(u.pathname===sourceFolder+'video.m3u8'||u.pathname===sourceFolder+'audio.m3u8'){
  if(u.pathname.endsWith('/video.m3u8'))refreshes++;
  return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:'+refreshes+'\n#EXTINF:4,\nparts/'+refreshes+'.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 }
 if(u.pathname===sourceFolder+'parts/'+refreshes+'.ts')return new Response(new Uint8Array([71,42]),{headers:{'content-type':'video/mp2t'}});
 if(u.pathname==='/segment.ts')return new Response(new Uint8Array([71,1,2,3]),{headers:{'content-type':'video/mp2t'}});
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
  assert.equal(r.status,200);assert.deepEqual(calls.map(x=>x.id),['55','56']);assert.equal(calls[0].account,calls[1].account,'a missing link need not rotate a healthy account');
  if(ext==='ts'){const reader=r.body.getReader();assert.equal((await reader.read()).value[0],71);await reader.cancel();}
  else{
   const master=await r.text();assert.match(master,/#EXTM3U/);assert.ok(!master.includes('source-password-synthetic'));
   const target=master.split('\n').find(x=>x.startsWith('https://')),playlist=await worker.fetch(new Request(target),env,ctx),text=await playlist.text();
   assert.equal(new URL(target).pathname,'/stream/resource.m3u8','simple live playlists also have a recognizable signed refresh URL');
   const segment=text.split('\n').find(x=>x.startsWith('https://'));assert.ok(segment);const bytes=await worker.fetch(new Request(segment),env,ctx);assert.equal(new Uint8Array(await bytes.arrayBuffer())[0],71);
  }
 }
 multivariant=true;calls.length=0;
 const multivariantResponse=await worker.fetch(new Request(chosen.direct_source),env,ctx);
 assert.equal(multivariantResponse.status,200);
 assert.equal(multivariantResponse.headers.get('cache-control'),'no-store');
 assert.equal(multivariantResponse.headers.has('X-SMN-Prepared-Master'),false);
 const multivariantText=await multivariantResponse.text();
 assert.match(multivariantText,/#EXT-X-STREAM-INF:BANDWIDTH=1200000,AUDIO="audio"/,'preserve the real master, including its rendition group');
 assert.doesNotMatch(multivariantText,/source-password-synthetic|hls\/|viewer-password-synthetic/);
 const signedUrl=(line,ext='m3u8')=>{
  const url=new URL(line);
  assert.equal(url.origin,origin);
  assert.equal(url.pathname,'/stream/resource.'+ext);
  assert.ok(url.searchParams.get('t'));
  return url;
 };
 const video=signedUrl(multivariantText.split('\n').find(line=>line.startsWith('https://')));
 const audio=signedUrl(multivariantText.match(/URI="([^"]+)"/)[1]);
 const get=url=>worker.fetch(new Request(url),env,ctx);
 const signedPlaylist=async url=>{
  const response=await get(url);
  assert.equal(response.status,200);
  const text=await response.text();
  assert.match(text,/#EXTINF/);
  assert.doesNotMatch(text,/#EXT-X-STREAM-INF|source-password-synthetic/);
  return text;
 };
 await signedPlaylist(audio);
 for(let sequence=1;sequence<=2;sequence++){
  const media=await signedPlaylist(video);
  assert.ok(media.includes('#EXT-X-MEDIA-SEQUENCE:'+sequence+'\n'),'refresh advances under the same signed variant URL');
  const url=signedUrl(media.split('\n').find(line=>line.startsWith('https://')),'ts');
  const bytes=await get(url);
  assert.equal(bytes.status,200);
  assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()),new Uint8Array([71,42]));
 }
 assert.deepEqual(calls.map(call=>call.id),['55','56'],'child retries and refreshes do not reopen the Xtream root');
 const activeLeases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage);
 assert.equal(await activeLeases.count(),1,'all variants and segment fetches share the current lease');
 const changedSuffix=new URL(video);
 changedSuffix.pathname='/stream/resource.ts';
 assert.equal((await get(changedSuffix)).status,410,'a signed playlist cannot be relabeled as binary media');
 const unknownSuffix=new URL(video);
 unknownSuffix.pathname='/stream/resource.html';
 assert.notEqual((await get(unknownSuffix)).status,200,'unrecognized filenames are never admitted as signed relay routes');
 const oldPath=new URL(video);
 oldPath.pathname='/stream';
 await signedPlaylist(oldPath);
 const untrusted=new URL(video);
 untrusted.searchParams.set('t','invalid');
 assert.equal((await get(untrusted)).status,410);
 multivariant=false;
 assert.equal(catalogReads,before,'fallback uses existing snapshots without fetching provider catalogs');
 allMissing=true;calls.length=0;const failed=await worker.fetch(new Request(origin+'/live/'+customer.username+'/'+customer.password+'/'+chosen.stream_id+'.ts'),env,ctx);
 assert.equal(failed.status,404);assert.deepEqual(calls.map(x=>x.id),['55','56','56','57'],'after exhausted source attempts the relay checks the next channel once');
 assert.equal((await get(video)).status,410,'the signed variant stops working after playback is superseded');
 const leases=await openLeaseStore(objects.get('__smn_accounts_v1').state.storage);assert.equal(await leases.count(),0,'all failed allocations are released');
 await Promise.all(pending);
 console.log('PASS: real Xtream TS/HLS requests recover the same channel using a verified alternative, signed segments work, no catalog traffic is added, and failed retries leave no leases.');
}finally{globalThis.fetch=originalFetch}


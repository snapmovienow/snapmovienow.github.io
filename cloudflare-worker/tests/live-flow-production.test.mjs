import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';

// Full public Xtream -> authenticated ticket -> media Durable Object path.
// All identities, origins, media and credentials here are synthetic/local.
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key))}
 async put(key,value){if(typeof key==='object')for(const [k,v]of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value))}
 async delete(key){this.data.delete(key)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const task=this.queue.then(()=>fn(this));this.queue=task.catch(()=>{});return task}
}
const realFetch=globalThis.fetch,realLog=console.log,realError=console.error;
const records=[],requests=[],tasks=[],objects=new Map(),at=Date.now();
const env={TICKET_SECRET:'flow-fixture-ticket-secret-only',ADMIN_SETUP_SECRET:'flow-fixture-setup-secret-12345678901234567890',
 LIVE_FLOW_DIAGNOSTIC_USERNAME:'fixture-target',LIVE_FLOW_DIAGNOSTIC_CASE:'62ff7c38-2ab2-48cd-a3ca-46d13b55a28b',LIVE_FLOW_DIAGNOSTIC_FROM:String(at-1000),LIVE_FLOW_DIAGNOSTIC_UNTIL:String(at+3600000)};
env.PLAYBACK_SESSIONS={idFromName:id=>id,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const upstream='https://flow-origin.example.test',origin='https://api.example.test',ctx={waitUntil:p=>tasks.push(Promise.resolve(p).catch(()=>{}))};
let mediaStatus=200;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input instanceof Request?input.url:input);assert.equal(url.origin,upstream,'no external network calls');
 if(url.pathname==='/player_api.php'){
  const action=url.searchParams.get('action');
  if(!action)return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
  if(action==='get_live_streams')return Response.json([{stream_id:100,name:'Synthetic live',category_id:'1'}]);
  return Response.json([]);
 }
 assert.match(url.pathname,/^\/live\/fixture-source\/fixture-source-password\/100\.(ts|m3u8)$/);
 const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));requests.push({range:headers.get('range')});
 if(url.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n/fragment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 const range=headers.get('range'),status=mediaStatus===200&&range?206:mediaStatus;
 return new Response(new Uint8Array([0x47,1,2,3]),{status,headers:{'content-type':'video/mp2t','content-length':'4',...(range?{'content-range':'bytes 0-3/100','accept-ranges':'bytes'}:{})}});
};
console.log=value=>{if(value?.event?.startsWith('live_flow_'))records.push(structuredClone(value))};
console.error=()=>{};
const request=(path,options={})=>worker.fetch(new Request(origin+path,options),env,ctx);
const post=async(body,path='/admin')=>{const r=await request(path,{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
try{
 await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'fixture-owner',password:'fixture-owner-password'});
 const token=(await post({action:'login',username:'fixture-owner',password:'fixture-owner-password'})).access_token;
 const admin=(action,body={})=>post({action,access_token:token,...body});
 await admin('provider-save',{mode:'single',url:upstream,username:'fixture-source',password:'fixture-source-password'});
 for(const username of ['fixture-target','fixture-other'])await admin('save',{create:true,username,password:'fixture-viewer-password',status:'active'});
 const catalog=await request('/player_api.php?'+new URLSearchParams({username:'fixture-target',password:'fixture-viewer-password',action:'get_live_streams'}));
 assert.equal(catalog.status,200);const id=(await catalog.json())[0].stream_id;
 const media=(username='fixture-target',ext='ts',options={},password='fixture-viewer-password')=>request('/live/'+username+'/'+password+'/'+id+'.'+ext,options);
 const nativeHeaders={'X-SNAP-Playback-Monitor':'612da663-28a7-42e5-88bf-2d36ec310599'};
 let response=await media('fixture-target','ts',{headers:nativeHeaders});assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0x47,1,2,3]);
 let starts=records.filter(r=>r.event==='live_flow_start'),ends=records.filter(r=>r.event==='live_flow_end');
 assert.equal(starts.length,1);assert.equal(ends.length,1);assert.equal(ends[0].flow_id,starts[0].flow_id);assert.equal(ends[0].reason,'relay_complete');assert.equal(ends[0].relay_bytes,4);assert.equal(ends[0].status,200);assert.equal(ends[0].public_id,String(id));
 assert.equal(ends[0].origin_observed,false,'hostname fetch without TCP measurements must not claim origin observation');
 const attempts=records.filter(r=>r.event==='live_flow_attempt');
 assert.equal(attempts.length,1);
 const {request_id,public_id,requested_origin_id,selected_origin_id,recovery,phase,status,attempt,elapsed_ms}=attempts[0];
 assert.equal(request_id,response.headers.get('X-SMN-Request-ID'));
 assert.deepEqual({public_id,requested_origin_id,selected_origin_id,recovery,phase,status,attempt},
  {public_id:String(id),requested_origin_id:'100',selected_origin_id:'100',recovery:'original',phase:'relay',status:200,attempt:1});
 assert.ok(Number.isInteger(elapsed_ms)&&elapsed_ms>=0);
 const beforeRange=records.length;response=await media('fixture-target','ts',{headers:{Range:'bytes=0-3','If-Range':'fixture-validator'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-3/100');await response.arrayBuffer();assert.equal(requests.at(-1).range,'bytes=0-3');assert.equal(records.slice(beforeRange).filter(r=>r.event==='live_flow_end').length,1);
 const quiet=async run=>{const count=records.length;const r=await run();await r.arrayBuffer();assert.equal(records.length,count,'unselected requests cannot enable observation');return r};
 await quiet(()=>media('fixture-other','ts',{headers:{'X-Live-Flow-Diagnostic':'enabled','X-SMN-Request-ID':'forged-case','CF-Connecting-IP':'198.51.100.20'}}));
 await quiet(()=>media('fixture-target','ts',{method:'HEAD'}));
 await quiet(()=>media('fixture-target','m3u8'));
 const rejected=await quiet(()=>media('fixture-target','ts',{},'wrong-fixture-password'));assert.equal(rejected.status,401);
 env.LIVE_FLOW_DIAGNOSTIC_UNTIL=String(at-1);await quiet(()=>media());
 env.LIVE_FLOW_DIAGNOSTIC_UNTIL=String(at+3600000);mediaStatus=404;
 response=await media();assert.ok(response.status>=400);await response.arrayBuffer();
 starts=records.filter(r=>r.event==='live_flow_start');ends=records.filter(r=>r.event==='live_flow_end');
 assert.equal(new Set(starts.map(r=>r.flow_id)).size,starts.length,'retries have separate diagnostic flows');
 assert.ok(ends.some(r=>r.reason==='startup_failed'&&r.status>=400));
 assert.equal(ends.length,starts.length,'each completed/failed fixture flow ends once');
 const logged=JSON.stringify(records);for(const value of ['fixture-target','fixture-other','fixture-viewer-password','fixture-source','fixture-source-password',upstream,'198.51.100.20','forged-case','fixture-validator'])assert.equal(logged.includes(value),false,'private identity or request metadata leaked: '+value);
 assert.equal(/https?:\/\//.test(logged),false);
 await Promise.all(tasks);
}finally{globalThis.fetch=realFetch;console.log=realLog;console.error=realError}
console.log('PASS: authenticated exact-target TS flows cross the real Worker/DO boundary; EOF, Range, privacy, retries, disabled/expired scope, forged headers and other clients remain isolated.');

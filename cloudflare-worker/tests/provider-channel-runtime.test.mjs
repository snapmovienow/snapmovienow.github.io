import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {readChannelObservations} from '../src/provider-channel-observations.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k))}async put(k,v){if(typeof k==='object'){for(const [name,value]of Object.entries(k))this.data.set(name,structuredClone(value));}else this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work}}
const objects=new Map(),pending=[],env={TICKET_SECRET:'passive-channel-runtime-secret',ADMIN_SETUP_SECRET:'passive-channel-runtime-setup-secret',PLAYBACK_CANARY_USERNAME:'dieguito2026'},ctx={waitUntil:p=>pending.push(Promise.resolve(p).catch(()=>{}))};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store(),waitUntil:ctx.waitUntil},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
const catalog=[123,124,125,126,127].map(stream_id=>({stream_id,name:stream_id===127?'PPV EVENT OFFLINE':'Synthetic channel '+stream_id,category_id:'1'}));
let failed=false,mediaCalls=0,providerCalls=0;
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:1,data:[['<a>1</a>','<a>source1</a>','<span class="table-trunc-copy-cell__text tooltip" title="provider-test-password">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01']]});
 if(u.pathname==='/player_api.php'){providerCalls++;const action=u.searchParams.get('action');return Response.json(!action?{user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}}:action==='get_live_categories'?[{category_id:'1',category_name:'Events'}]:catalog)}
 if(u.pathname.startsWith('/live/')){mediaCalls++;if(failed)return new Response('failed',{status:503});if(/\/(124|125)\./.test(u.pathname))return new Response('#EXTM3U\n#EXT-X-VERSION:3\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});return new Response(new Uint8Array([0x47,0x40,0,0x10,1,2,3,4]),{headers:{'content-type':'video/mp2t','X-SMN-Initial-Evidence':'manifest'}})}
 throw Error('unexpected synthetic request');
};
const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0))};
const call=async(body,path='/')=>{const response=await worker.fetch(new Request('https://api.example.com'+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:response.status,data:await response.json()}};
await call({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');const adminToken=(await call({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token;
const admin=(action,body={})=>call({action,access_token:adminToken,...body},'/admin');await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'});
const tokens={};for(const username of ['viewer-test','dieguito2026']){await admin('save',{create:true,username,password:'viewer-password-test',status:'active'});tokens[username]=(await call({op:'auth',username,password:'viewer-password-test'})).data.access_token;}
assert.equal((await call({op:'live',access_token:tokens['viewer-test']})).status,200);await flush();
let revision=0;const prepare=(id,ext='ts',username='viewer-test')=>call({op:'stream_token',access_token:tokens[username],type:'live',id,ext,request_id:'channel-test-'+(++revision),revision});
const play=async(id,ext='ts',username='viewer-test')=>{const prepared=await prepare(id,ext,username);assert.equal(prepared.status,200);const response=await worker.fetch(new Request(prepared.data.url),env,ctx);assert.equal(response.headers.has('X-SMN-Initial-Evidence'),false,'internal evidence never reaches a viewer');await response.arrayBuffer();await flush();return {prepared,status:response.status}};
await play(123);failed=true;assert.equal((await play(123)).status,503);failed=false;
await play(124,'ts');await play(125,'m3u8');await play(123,'ts','dieguito2026');
const nativeCatalogResponse=await worker.fetch(new Request('https://api.example.com/player_api.php?username=viewer-test&password=viewer-password-test&action=get_live_streams'),env,ctx),nativeCatalog=await nativeCatalogResponse.json();assert.equal(nativeCatalogResponse.status,200);
const nativeChannel=nativeCatalog.find(row=>row.name==='Synthetic channel 126');assert.ok(nativeChannel);
const nativeResponse=await worker.fetch(new Request('https://api.example.com/live/viewer-test/viewer-password-test/'+nativeChannel.stream_id+'.ts'),env,ctx);assert.equal(nativeResponse.status,200);assert.equal(nativeResponse.headers.has('X-SMN-Initial-Evidence'),false);await nativeResponse.arrayBuffer();await flush();
const before={mediaCalls,providerCalls},data=(await admin('playback-diagnostics')).data;assert.deepEqual({mediaCalls,providerCalls},before,'diagnostic read never opens media or provider catalogs');
const customer=data.channels.groups.find(g=>g.cohort==='customer'),owner=data.channels.groups.find(g=>g.cohort==='owner_test');
assert.equal(data.channels.catalog.total,5);assert.equal(customer.observed,4);assert.equal(customer.mixed,1);assert.equal(customer.successOnly,3);assert.equal(customer.unobserved,1,'PPV events remain in the catalog denominator');assert.equal(customer.bytesSuccess,2);assert.equal(customer.manifestSuccess,2,'actual manifests are not counted as bytes even for a TS request');assert.equal(owner.observed,1);
assert.equal((await call({action:'playback-diagnostics'},'/admin')).status,401);assert.equal((await call({action:'playback-diagnostics',access_token:tokens['viewer-test']},'/admin')).status,401);
const storage=objects.get('__smn_accounts_v1').state.storage,privateCall=async(path,body={})=>{const response=await objects.get('__smn_accounts_v1').fetch(new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}};
assert.equal((await privateCall('/provider-result',{sid:'forged',lease_id:'forged',request_id:'forged',provider_id:'1',stage:'signal',ok:true,evidence:'bytes',canary:true})).status,403);
for(const access_token of Object.values(tokens))await call({op:'logout',access_token});
const user=await storage.get('user:dieguito2026'),body={sid:'synthetic-own-canary',uid:user.id,username:user.username,version:user.version,canary:true,server:'ccf',mediaKey:'live|ccf|123|ts',request_id:'canary-channel-test'};
await privateCall('/release-session',{sid:'synthetic-own-canary'});await privateCall('/playback-begin',body);const acquired=await privateCall('/acquire',body);assert.equal(acquired.status,200);
const result={...body,...acquired.data,stage:'signal',ok:true,evidence:'bytes'};assert.equal((await privateCall('/provider-result',result)).status,200);
assert.equal((await privateCall('/provider-result',{...result,ok:false,httpStatus:503})).data.duplicate,true,'a duplicate cannot fabricate a mixed result');
const retained=await readChannelObservations(storage);assert.ok(retained.rows['123'].canary.bytesAt);assert.equal(retained.rows['123'].canary.failureAt,undefined);
const serialized=JSON.stringify(retained)+JSON.stringify(data.channels);for(const value of ['viewer-test','dieguito2026','provider-test-password','synthetic-own-canary'])assert.ok(!serialized.includes(value));
const savedGet=storage.get.bind(storage);storage.get=async key=>{if(typeof key==='string'&&key.startsWith('provider-channel-observations:'))throw Error('synthetic optional ledger error');return savedGet(key)};
const degraded=await admin('playback-diagnostics');assert.equal(degraded.status,200,'optional channel reader cannot bring down existing diagnostics');assert.ok(Array.isArray(degraded.data.providers.circuits));assert.ok(Array.isArray(degraded.data.timings.groups));assert.equal(degraded.data.channels.status,'unavailable');assert.equal(degraded.data.channels.groups[0].observed,null);assert.equal(degraded.data.channels.groups[0].successOnlyPercent,null);storage.get=savedGet;
await privateCall('/release-session',{sid:body.sid});await flush();
console.log('PASS: lease-validated channel cohorts, byte/manifest evidence independent of extension, duplicate isolation, admin-only aggregates and zero added provider traffic.');

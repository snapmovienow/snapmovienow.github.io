import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const objects=new Map(),env={TICKET_SECRET:'test-startup-secret-only',ADMIN_SETUP_SECRET:'test-setup-secret-long-enough-1234567890'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
const validations=[],signals=[];let allBroken=false;
const row=id=>['<a>'+id+'</a>','<a>source'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="source-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
globalThis.fetch=async(url,opts={})=>{const u=new URL(url);
 if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});
 if(u.pathname.endsWith('/table'))return Response.json({recordsFiltered:4,data:[1,2,3,4].map(row)});
 if(u.pathname==='/player_api.php'){const user=u.searchParams.get('username'),action=u.searchParams.get('action');if(action)return Response.json([{stream_id:123,name:'Test live',_server:'ccf'}]);validations.push(user);return Response.json({user_info:{auth:allBroken||user!=='source1'?1:0,status:'Active',max_connections:'3',active_cons:'0'}});}
 if(u.pathname.endsWith('.m3u8')){const name=u.pathname.split('/')[2];signals.push(name);return allBroken||name==='source2'?new Response('not found',{status:404}):new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});}
 return new Response('video');
};
const origin='https://api.example.com',ctx={waitUntil(p){void p.catch(()=>{})}};
const req=async(body,path='/')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env,ctx);return {status:r.status,data:await r.json()}};
await req({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');
const adminToken=(await req({action:'login',username:'owner',password:'owner-password-test'},'/admin')).data.access_token;
const admin=(action,body={})=>req({action,access_token:adminToken,...body},'/admin');
assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'})).status,200);
const tokens=[];for(let i=0;i<3;i++){await admin('save',{create:true,username:'viewer'+i,password:'viewer-password-test',status:'active'});tokens.push((await req({op:'auth',username:'viewer'+i,password:'viewer-password-test'})).data.access_token);}
validations.length=0;
const play=i=>req({op:'stream_token',access_token:tokens[i],type:'live',id:123,ext:'m3u8',request_id:'request-'+i,revision:1});
let result=await play(0);assert.equal(result.status,200);assert.deepEqual(validations,['source1','source2','source3']);assert.deepEqual(signals,['source2','source3']);
validations.length=0;signals.length=0;result=await play(1);assert.equal(result.status,200);assert.deepEqual(validations,['source3'],'a recently successful signal is selected before another unknown/failed source');
const storage=objects.get('__smn_accounts_v1').state.storage,leases=await openLeaseStore(storage);assert.equal(await leases.count(),2,'failed account and signal attempts release their reservations');
await storage.delete('provider-health');allBroken=true;validations.length=0;signals.length=0;result=await play(2);assert.ok(result.status>=500);assert.equal(validations.length,3,'validation and signal retries share exactly three candidates, never three times three');assert.equal(signals.length,3);assert.equal(await leases.count(),2,'a failed startup cannot leak reservations or remove other sessions');
console.log('PASS: real allocation + validation + signal fallback share three attempts; recent successful source wins; failed startup preserves other leases without exceeding capacity.');

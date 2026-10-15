import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {exclusiveURL,exportExclusives,validExclusiveBackup,restoreExclusives,exclusiveCatalogRoute} from '../src/exclusive-catalog.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store {
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){if(Array.isArray(key))return new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))]));return structuredClone(this.data.get(key));}
 async put(key,value){if(typeof key==='object')for(const[k,v]of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result;}
}
const objects=new Map(),env={TICKET_SECRET:'exclusive-test-only-secret',ADMIN_SETUP_SECRET:'exclusive-test-setup-12345678901234567890'};
env.PLAYBACK_SESSIONS={idFromName:n=>n,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))};}};
const origin='https://api.snaptvnow.com',customer={username:'exclusive-client',password:'exclusive-customer-test'},originalFetch=globalThis.fetch;
const upstream=[];let redirect=false,html=false;
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(url);upstream.push(u.href);assert.equal(u.hostname,'media.snapcdn.net','only validated public media can be fetched');assert.equal(new Headers(opts.headers).get('authorization'),null);
 if(redirect)return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private.mp4'}});
 if(html)return new Response('<html>login</html>',{headers:{'content-type':'text/html'}});
 if(u.pathname.endsWith('.m3u8'))return new Response(opts.method==='HEAD'?null:'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 if(u.pathname.endsWith('key.bin'))return new Response(new Uint8Array(16),{headers:{'content-type':'application/octet-stream'}});
 if(u.pathname.endsWith('segment.ts'))return new Response(new Uint8Array([0x47,1,2,3]),{headers:{'content-type':'video/mp2t'}});
 const ranged=new Headers(opts.headers).get('range');return new Response(opts.method==='HEAD'?null:'abcd',{status:ranged?206:200,headers:{'content-type':'video/mp4','content-length':'4','accept-ranges':'bytes',...(ranged?{'content-range':'bytes 0-3/4'}:{})}});
};
const post=async(body,path='')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()};};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'exclusive-admin-test'},'/admin');
const login=await post({action:'login',username:'owner',password:'exclusive-admin-test'},'/admin');assert.equal(login.status,200);
const admin=(action,body={})=>post({action,...body,access_token:login.data.access_token},'/admin');
assert.equal((await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000})).status,200);
const api=(action,extra={},device=1)=>worker.fetch(new Request(origin+'/player_api.php?'+new URLSearchParams({...customer,action,...extra}),{headers:{'CF-Connecting-IP':'198.51.100.'+device,'User-Agent':'SNAPTVNOW-test/'+device}}),env);
const play=(id,ext='m3u8',device=1,options={})=>worker.fetch(new Request(`${origin}/exclusive/${customer.username}/${customer.password}/${id}.${ext}`,{...options,headers:{'CF-Connecting-IP':'198.51.100.'+device,'User-Agent':'SNAPTVNOW-test/'+device,...options.headers}}),env);
const leases=async()=>[...(await(await openLeaseStore(objects.get('__smn_accounts_v1').state.storage)).active()).values()];
try{
 assert.equal((await post({action:'exclusive-list'},'/admin')).status,401);
 const seeds=await admin('exclusive-list');assert.equal(seeds.status,200);assert.equal(seeds.data.items.length,18);assert.ok(seeds.data.items.every(row=>row.page&&row.profileServer==='gnula'));
 const publicSeeds=await(await api('get_exclusive_catalog')).json();assert.equal(publicSeeds.items.length,18);assert.ok(!JSON.stringify(publicSeeds).includes('preferredEmbed'));assert.ok(publicSeeds.items.every(row=>!('page' in row)&&!('episodes' in row)));assert.equal(upstream.length,0,'catalog listing never resolves or fetches videos');
 const movie={id:'custom-test-movie',name:'Película de prueba',type:'movie',source:'Propia',mode:'direct',page:'https://media.snapcdn.net/movie.mp4',poster:'',year:2026,plot:'Prueba',visible:true,adult:false,episodes:[]};
 let saved=await admin('exclusive-save',{item:movie,revision:0});assert.equal(saved.status,200);assert.equal(saved.data.item.playbackRevision,1);
 assert.equal((await admin('exclusive-save',{item:movie,revision:0})).status,409,'a duplicate save cannot overwrite a newer revision');
 saved=await admin('exclusive-save',{item:{...movie,name:'Nuevo título'},revision:1});assert.equal(saved.data.item.playbackRevision,1,'metadata edits preserve ongoing playback');
 const before=upstream.length;
 for(const page of ['http://media.snapcdn.net/x.mp4','https://localhost/x.mp4','https://127.1/x.mp4','https://2130706433/x.mp4','https://[::1]/x.mp4','https://api.snaptvnow.com/x.mp4','https://user:pass@media.snapcdn.net/x.mp4','https://metadata.google.internal/x.mp4','https://x.nip.io/x.mp4','https://media.snapcdn.net/a.html'])assert.equal((await admin('exclusive-save',{item:{...movie,id:'custom-bad',page},revision:0})).status,400,page);
 assert.equal(upstream.length,before,'invalid URLs never make network requests');
 assert.throws(()=>exclusiveURL('https://media.snapcdn.net:8444/movie.mp4'));
 let response=await play(movie.id,'mp4',1,{headers:{Range:'bytes=0-3','X-SNAP-Playback-Monitor':crypto.randomUUID()}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-3/4');assert.ok(response.headers.get('X-SNAP-Playback-Quality'));assert.equal(await response.text(),'abcd');assert.equal((await leases()).length,0,'completed finite media releases its slot');
 const hls={...movie,id:'custom-test-hls',page:'https://media.snapcdn.net/path/master.m3u8'};assert.equal((await admin('exclusive-save',{item:hls,revision:0})).status,200);
 response=await play(hls.id);assert.equal(response.status,200);const playlist=await response.text();assert.ok(playlist.startsWith('#EXTM3U'));assert.ok(!playlist.includes('media.snapcdn.net'));const segment=playlist.split('\n').find(line=>line.startsWith('https://')),key=playlist.match(/URI="([^"]+)"/)[1];
 assert.equal(new URL(segment).origin,origin);let chunk=await worker.fetch(new Request(segment),env);assert.equal(chunk.status,200);assert.equal((await chunk.arrayBuffer()).byteLength,4);chunk=await worker.fetch(new Request(key),env);assert.equal((await chunk.arrayBuffer()).byteLength,16);
 const altered=new URL(segment);altered.searchParams.set('path','https://127.0.0.1/private');chunk=await worker.fetch(new Request(altered),env);assert.equal(chunk.status,200,'unsigned query parameters cannot change the encrypted destination');await chunk.body.cancel();
 assert.equal((await leases()).length,1);response=await play(hls.id,'m3u8',2);await response.body.cancel();response=await play(hls.id,'m3u8',3);await response.body.cancel();assert.equal((await leases()).length,3);response=await play(hls.id,'m3u8',4);assert.equal(response.status,409,'a fourth device cannot bypass the connection limit');
 response=await play(hls.id,'m3u8',2,{method:'HEAD'});assert.equal(response.status,200);assert.equal((await leases()).length,2,'HEAD checks do not retain a slot');
 assert.equal((await admin('exclusive-save',{item:{...hls,visible:false},revision:1})).status,200);assert.equal((await worker.fetch(new Request(segment),env)).status,410,'hiding invalidates existing signed playback');assert.equal((await play(hls.id)).status,404);assert.equal((await leases()).length,0,'hidden titles release occupied connection slots immediately');
 const series={...movie,id:'custom-test-series',type:'series',page:'',episodes:[{id:'custom-ep-two',title:'Dos',season:1,episode_num:2,page:'https://media.snapcdn.net/two.mp4'},{id:'custom-ep-one',title:'Uno',season:1,episode_num:1,page:'https://media.snapcdn.net/one.mp4'}]};
 assert.equal((await admin('exclusive-save',{item:series,revision:0})).status,200);const info=await(await api('get_exclusive_series_info',{series_id:series.id})).json();assert.equal(info.episodes['1'][0].id,'custom-ep-one');assert.equal(info.episodes['1'][0].smn_profile.episodeId,'custom-ep-one');assert.ok(!JSON.stringify(info).includes('media.snapcdn.net'));
 assert.equal((await admin('exclusive-save',{item:{...series,id:'custom-duplicate'},revision:0})).status,409,'episodes belong to one series only');
 assert.equal((await admin('exclusive-save',{item:{...series,id:'custom-empty',episodes:[]},revision:0})).status,400);
 redirect=true;const checked=await admin('exclusive-check',{id:movie.id});assert.equal(checked.status,400);redirect=false;
 html=true;assert.equal((await admin('exclusive-check',{id:movie.id})).data.ok,false);html=false;assert.equal((await admin('exclusive-check',{id:movie.id})).data.ok,true);
 const store=objects.get('__smn_accounts_v1').state.storage;
 // A real, tiny PNG verifies cover upload, retrieval and encrypted backup persistence.
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFeQAAAAASUVORK5CYII=';
 const cover=await admin('exclusive-cover',{data:png});assert.equal(cover.status,200);response=await worker.fetch(new Request(origin+cover.data.poster),env);assert.equal(response.headers.get('content-type'),'image/png');assert.equal((await response.arrayBuffer()).byteLength,68);
 assert.equal((await admin('exclusive-cover',{data:'data:image/png;base64,'+btoa('<script>alert(1)</script>')})).status,400);
 const backup=await exportExclusives(store);assert.ok(validExclusiveBackup(backup));const restored=new Store();await restoreExclusives(restored,backup);assert.equal((await(await exclusiveCatalogRoute(restored,'/exclusive-read',{})).json()).items.length,21);assert.deepEqual(await exportExclusives(restored),backup);assert.equal(validExclusiveBackup({...backup,covers:[['exclusive:cover:bad',{type:'image/svg+xml',data:'bad'}]]}),false);
 assert.equal((await admin('save',{username:customer.username,status:'active',permissions:{movies:false,series:true,tv:true,adults:false}})).status,200);
 const restricted=await(await api('get_exclusive_catalog')).json();assert.equal(restricted.items.length,1);assert.equal(restricted.items[0].type,'series');assert.equal((await play(movie.id,'mp4')).status,404);
 console.log('PASS: exclusive admin ownership, seeded catalog, revisions, source privacy, SSRF rejection, movie ranges, signed HLS/key resources, three-device limits, hide revocation, series episodes, media checks, cover upload/backup and content permissions.');
}finally{globalThis.fetch=originalFetch;}

import assert from 'node:assert/strict';
import {runPlaybackCanary,cleanCanarySettings,defaultCanarySettings,cleanCanaryResult} from '../src/playback-canary.mjs';
import {OperationsMonitor,applyObservations} from '../src/monitor.mjs';
const config={username:'owner-test',type:'live'},session={private:'private-session-secret'},target={url:'https://private-provider/private-password'};
let released=0,cancelled=0;
const ts=new Uint8Array(376);ts.set([0x47,0x40,0x11,0x10]);ts.set([0x47,0x40,0x11,0x10],188);
const binary=()=>new Response(new ReadableStream({start(c){c.enqueue(ts)},cancel(){cancelled++}}),{headers:{'content-type':'video/mp2t'}});
const adapter={authenticate:async()=>session,select:async()=>target,open:async()=>binary(),release:async(s,t)=>{assert.equal(s,session);released++}};
const result=await runPlaybackCanary(config,adapter);
assert.equal(result.ok,true);assert.equal(result.bytes,376);assert.ok(result.firstMediaByteMs>=0);assert.equal(cancelled,1);assert.equal(released,1);
assert.ok(!JSON.stringify(result).includes('private'),'opaque credentials and media URLs never enter results');
assert.deepEqual(Object.keys(result.stages).sort(),['authenticationMs','catalogPrepareMs','firstMediaByteMs','mediaHeadersMs']);

released=0;cancelled=0;
const silent=await runPlaybackCanary(config,{...adapter,open:async()=>new Response(new ReadableStream({cancel(){cancelled++}}))},{timeoutMs:20});
assert.equal(silent.ok,false);assert.equal(silent.reason,'timeout');assert.equal(cancelled,1);assert.equal(released,1,'silent HTTP200 still releases its test session');
const busy=await runPlaybackCanary(config,{...adapter,open:async()=>new Response('',{status:409})});
assert.equal(busy.status,'busy');assert.equal(busy.reason,'capacity_busy','a full own account is not classified as provider failure');
const rejected=await runPlaybackCanary(config,{...adapter,authenticate:async()=>{throw Error('https://private/password=sensitive')}});
assert.equal(rejected.reason,'playback_unavailable');assert.ok(!JSON.stringify(rejected).includes('sensitive'));

let hops=[];
const hls=await runPlaybackCanary(config,{...adapter,open:async()=>new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariant.m3u8\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}),openResource:async(s,path)=>{hops.push(path);return path==='variant.m3u8'?new Response('#EXTM3U\n#EXTINF:2,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}):binary()}});
assert.equal(hls.ok,true);assert.deepEqual(hops,['variant.m3u8','segment.ts']);assert.equal(hls.bytes,376,'playlist bytes are not counted as video');
for(const [body,content]of [['<html>provider error</html>','text/html'],['{"error":"invalid login"}','application/json'],['Access denied due to provider problem','video/mp2t'],['Gateway service is unavailable','application/octet-stream']]){
 const bogus=await runPlaybackCanary(config,{...adapter,open:async()=>new Response(body,{headers:{'content-type':content}})});assert.equal(bogus.reason,'invalid_media','HTTP200 error text cannot prove working video');
}
const mp4=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,1]);
const split=await runPlaybackCanary({...config,type:'series'},{...adapter,open:async()=>new Response(new ReadableStream({start(c){c.enqueue(mp4.subarray(0,2));c.enqueue(mp4.subarray(2,7));c.enqueue(mp4.subarray(7));c.close()}}),{headers:{'content-type':'application/octet-stream'}})});
assert.equal(split.ok,true);assert.equal(split.bytes,16,'small first chunks are combined before checking the media signature');
const coalesced=new Uint8Array(131072);coalesced.set(mp4);
const large=await runPlaybackCanary({...config,type:'series'},{...adapter,open:async()=>new Response(coalesced,{headers:{'content-type':'video/mp4'}})});
assert.equal(large.ok,true);assert.equal(large.bytes,65536,'a coalesced native read is capped and cancelled, not mistaken for invalid video');
const noSegment=await runPlaybackCanary(config,{...adapter,open:async()=>new Response('#EXTM3U\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}),openResource:async()=>{throw Error('must not fetch')}});
assert.equal(noSegment.reason,'invalid_playlist');
const huge=await runPlaybackCanary(config,{...adapter,open:async()=>new Response('#EXTM3U\n'+'x'.repeat(65536),{headers:{'content-type':'application/vnd.apple.mpegurl'}}),openResource:async()=>binary()});
assert.equal(huge.reason,'invalid_playlist');
let lateCancelled=false;
await runPlaybackCanary(config,{...adapter,open:async()=>{await new Promise(r=>setTimeout(r,25));return new Response(new ReadableStream({cancel(){lateCancelled=true}}))}},{timeoutMs:5});
await new Promise(r=>setTimeout(r,35));assert.equal(lateCancelled,true,'late stream responses cannot retain a provider connection after a deadline');
let lateReleased=0;
await runPlaybackCanary(config,{...adapter,authenticate:async()=>{await new Promise(r=>setTimeout(r,25));return session},release:async()=>{lateReleased++}},{timeoutMs:5});
await new Promise(r=>setTimeout(r,35));assert.equal(lateReleased,1,'late authentication cannot leak the unique synthetic session');

assert.equal(cleanCanarySettings({enabled:true},undefined).error,'canary_account_not_configured');
assert.equal(cleanCanarySettings({enabled:true,username:'customer'},'owner-test').error,'canary_account_not_allowed');
assert.equal(cleanCanarySettings({enabled:true,types:['live','live']},'owner-test').error,'invalid_canary_types');
assert.equal(defaultCanarySettings({}).enabled,false);
assert.equal(defaultCanarySettings({PLAYBACK_CANARY_USERNAME:'owner-test'}).enabled,true);
assert.equal(defaultCanarySettings({PLAYBACK_CANARY_USERNAME:'owner-test',PLAYBACK_CANARY_ENABLED:'false'}).enabled,false);
assert.ok(!JSON.stringify(cleanCanaryResult({ok:false,status:'failed',reason:'https://private/password',stages:{url:'private'},extra:'private'},'live')).includes('private'));

class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}}
const actualNow=Date.now;let now=1800000000000;Date.now=()=>now;
try{
 const store=new Store();let probes=0,active=0,max=0;
 const env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'owner-test',PLAYBACK_SESSIONS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
  assert.equal(name,'__smn_canary_v1');assert.equal(new URL(url).pathname,'/canary-run');const b=JSON.parse(options.body);assert.equal(b.username,'owner-test');probes++;active++;max=Math.max(max,active);await Promise.resolve();active--;return Response.json({ok:true,status:'healthy',reason:'ok',type:b.type,firstMediaByteMs:100,bytes:10,stages:{authenticationMs:2}})
 }})}};
 const monitor=new OperationsMonitor({storage:store},env);
 await Promise.all([monitor.runCanary(),monitor.runCanary()]);assert.equal(probes,1);assert.equal(max,1,'concurrent cron/manual requests share a durable test reservation');
 let status=await (await monitor.status()).json();assert.equal(status.canary.lastResult.type,'live');assert.equal(status.canary.configured,true);
 now+=300000;await monitor.runCanary();status=await (await monitor.status()).json();assert.equal(probes,2);assert.equal(status.canary.lastResult.type,'series');assert.equal(status.canary.results.length,2);
 const settings=body=>monitor.fetch(new Request('https://private/canary/settings',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await settings({enabled:true,username:'customer'})).status,400);
 await settings({enabled:false});now+=300000;await monitor.runCanary();assert.equal(probes,2);assert.equal((await (await monitor.status()).json()).canary.status,'disabled');
 const stage=new OperationsMonitor({storage:new Store()},{...env,ENVIRONMENT:'staging'});await stage.runCanary();assert.equal(probes,2);
 const unknown=new OperationsMonitor({storage:new Store()},{...env,PLAYBACK_CANARY_USERNAME:undefined});await unknown.runCanary();assert.equal(probes,2);assert.equal((await (await unknown.status()).json()).canary.status,'not_configured');
 const state={createdAt:now,config:{channel:'panel'},checks:{},incidents:{},history:[],outbox:[]};
 const snapshot={providers:{providers:[]},playback:{groups:[]},backups:{lastAutomaticAt:now},canary:{enabled:true,results:[{type:'live',at:now,status:'failed',reason:'timeout'}]}};
 applyObservations(state,snapshot,now);assert.equal(Object.keys(state.incidents).length,0);
 now+=300000;applyObservations(state,snapshot,now);assert.equal(Object.keys(state.incidents).length,0,'reusing the same failed probe cannot amplify it into multiple failures');
 snapshot.canary.results[0].at=now;applyObservations(state,snapshot,now);assert.equal(state.incidents['canary:live'].status,'open');
 snapshot.canary.results=[];now+=300000;applyObservations(state,snapshot,now);assert.equal(state.incidents['canary:live'].waitingForSamples,true);
 snapshot.canary.results=[{type:'live',at:now,status:'healthy',reason:'ok'}];applyObservations(state,snapshot,now);
 now+=300000;snapshot.canary.results[0].at=now;applyObservations(state,snapshot,now);assert.equal(state.incidents['canary:live'].status,'resolved','recovery requires two new successful video probes');
}finally{Date.now=actualNow}
console.log('PASS: own-account-only synthetic playback, bounded video-byte/HLS probes, late-response cleanup, redacted stage timings, durable single-flight, scheduling, explicit unknown state and sample-confirmed recovery.');

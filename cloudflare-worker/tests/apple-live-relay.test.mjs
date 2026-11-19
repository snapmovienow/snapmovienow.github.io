import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import worker,{PlaybackSession} from '../src/index.js';

// Node loads the same compiled WebAssembly.Module that Wrangler's Wasm module rule supplies.
// The transport fixture is a 1.2 s locally generated testsrc2 and sine wave, with H.264 and MP2.
registerHooks({load(url,context,nextLoad){
  if(!url.endsWith('/apple-segment-codec.wasm'))return nextLoad(url,context);
  const source="import {readFileSync} from 'node:fs'; export default new WebAssembly.Module(readFileSync(new URL("+JSON.stringify(url)+")));";
  return {format:'module',shortCircuit:true,source};
}});
const fixture=readFileSync(new URL('./fixtures/apple-live-synthetic.mpegts.bin',import.meta.url));
const origin='https://origin.example.test', edge='https://api.snaptvnow.com';
const account='diagnostic-synthetic', sid='synth-relay', secret='private-synthetic-fixture';
const env={TICKET_SECRET:secret};
let allowed=true,checks=0,dropped=false,sliding=false,fetches=0;
const relay=new PlaybackSession({waitUntil(){},storage:{}},env);
env.PLAYBACK_SESSIONS={
  idFromName:id=>id,
  get:id=>({fetch:async(input,opts)=>{
    const request=input instanceof Request?input:new Request(input,opts);
    if(id==='__smn_media_v1:'+sid) return relay.fetch(request);
    assert.ok(['__smn_accounts_v1',sid].includes(id));
    assert.ok(['/check','/accounts/lease-check','/accounts/heartbeat'].includes(new URL(request.url).pathname));
    checks++;
    return new Response(null,{status:allowed?200:403});
  }})
};
const cryptoKey=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),{name:'AES-GCM'},false,['encrypt']);
async function fixtureTicket(data){
  const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,new TextEncoder().encode(JSON.stringify(data)));
  return Buffer.concat([Buffer.from(iv),Buffer.from(bytes)]).toString('base64url');
}
const rootClaim={sid,username:account,password:'fixture',origin,lease_id:'fixture-lease',request_id:'fixture-request',xtream:true,type:'live',id:'42',ext:'m3u8',exp:Date.now()+3600000,appleFmp4:true};
const signed=async claim=>edge+'/stream/resource.m3u8?t='+await fixtureTicket(claim);
const playlist=await signed(rootClaim);
const read=async(url,headers={},method='GET')=>worker.fetch(new Request(url,{method,headers}),env,{});
const original=globalThis.fetch;
globalThis.fetch=async(input,opts={})=>{
  const url=new URL(input instanceof Request ? input.url : input);
  assert.equal(url.origin,origin);
  if(url.pathname.endsWith('.m3u8')){
    if(url.pathname.startsWith('/live/')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.4d401f,mp4a.40.33"\n/child.m3u8\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
    const start=sliding?18:12;
    return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:'+start+'\n'+[start,start+1,start+2].map(i=>'#EXTINF:1.2,\n/seg'+i+'.ts\n').join(''),{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  }
  const seq=Number(url.pathname.match(/seg(\d+)\.ts$/)?.[1]);
  assert.ok(Number.isInteger(seq));
  assert.equal(new Headers(opts.headers).has('range'),false,'never forward fMP4 range to source TS');
  fetches++;
  if(seq<18&&dropped) return new Response(null,{status:404});
  return new Response(fixture,{headers:{'content-type':'video/mp2t','content-length':fixture.length}});
};
try {
  const rootResponse=await read(playlist);
  assert.equal(rootResponse.status,200);
  const master=await rootResponse.text(),child=master.split('\n').find(x=>x.startsWith('https://'));
  assert.ok(child);assert.ok(!master.includes('mp4a.40.33'));
  const media=await (await read(child)).text();
  assert.match(media,/#EXT-X-MAP:/);
  assert.ok(!media.includes(account)&&!media.includes(origin));
  assert.equal(fetches,1,'preflight converts exactly one segment');
  const firstInit=media.match(/#EXT-X-MAP:URI="([^"]+)"/)[1];
  const parts=media.split('\n').filter(x=>x.startsWith(edge+'/stream/resource.m4s?'));
  assert.equal(parts.length,3);
  const check=await read(parts[1],{Range:'bytes=0-1'},'HEAD');
  assert.equal(check.status,206);assert.equal(check.headers.get('content-length'),'2');
  assert.equal(fetches,1,'preflight media remains reusable after a client HEAD');
  const fragment=await read(parts[0]);
  assert.equal(fragment.headers.get('content-type'),'video/iso.segment');
  assert.ok(Buffer.from(await fragment.arrayBuffer()).includes(Buffer.from('moof')));
  const before=fetches;
  sliding=true;dropped=true;
  const refreshed=await (await read(child)).text();
  const secondInit=refreshed.match(/#EXT-X-MAP:URI="([^"]+)"/)[1];
  assert.equal(firstInit,secondInit,'same period keeps stable init after the old origin segments disappear');
  const init=await read(secondInit);
  assert.equal(init.status,200);assert.ok(Buffer.from(await init.arrayBuffer()).includes(Buffer.from('moov')));
  assert.equal(fetches,before,'no origin fetch to refresh verified configuration or return signed init');
  allowed=false;
  for(const ticket of [secondInit,parts[0]]){
    const prior=fetches, denied=await read(ticket);
    assert.equal(denied.status,410);assert.equal(fetches,prior);
  }
  assert.ok(checks>=8);
} finally {globalThis.fetch=original;}
console.log('PASS: authorized Apple fMP4 media, sliding HLS, signed init, native ranges and revocation through the live Worker route.');

import assert from 'node:assert/strict';
import worker from '../src/index.js';

// Exercise the actual public media handler with an encrypted synthetic ticket.
// No provider credentials or external connections are used.
const original={now:Date.now,fetch:globalThis.fetch,set:setTimeout,clear:clearTimeout};
let clock=1000,tick,releases=0,canceled=0;
const tasks=[],source='https://strm1.uqload.vc/test/movie.mp4',env={TICKET_SECRET:'synthetic-gnula-expiry-only'};
env.PLAYBACK_SESSIONS={idFromName:value=>value,get(){return {async fetch(url,options){const path=new URL(url).pathname;if(path==='/accounts/release-session'){assert.equal(JSON.parse(options.body).sid,'test-session');releases++;return Response.json({ok:true})}assert.equal(path,'/check');return new Response('ok')}}}};
try{
 Date.now=()=>clock;
 globalThis.setTimeout=(fn)=>{tick=fn;return 1};globalThis.clearTimeout=()=>{};
 globalThis.fetch=async url=>{assert.equal(String(url),source);return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]))},cancel(){canceled++}}),{headers:{'Content-Type':'video/mp4'}})};
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.TICKET_SECRET)),{name:'AES-GCM'},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({kind:'gnula',sid:'test-session',source,exp:1100}))));
 const token=Buffer.concat([iv,cipher]).toString('base64url');
 const response=await worker.fetch(new Request('https://edge.example.test/gnula-media?t='+token),env,{waitUntil:task=>tasks.push(task)});
 assert.equal(response.status,200);
 const reader=response.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2,3]);
 const rejected=assert.rejects(reader.read(),/access_expired/);
 clock=1100;tick();await rejected;await Promise.all(tasks);
 assert.equal(canceled,1);
 assert.equal(releases,1,'the actual expiry handler must release the session, not call a shadowed path string');
 console.log('PASS: public GNULA media expiry closes its upstream and releases the correct session exactly once.');
}finally{Date.now=original.now;globalThis.fetch=original.fetch;globalThis.setTimeout=original.set;globalThis.clearTimeout=original.clear}

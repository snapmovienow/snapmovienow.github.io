import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CCF_MEDIA_ORIGIN,fetchApprovedMediaIP} from '../src/ip-media.mjs';
import {fetchValidatedMedia} from '../src/media-origin.mjs';

const target='http://89.44.33.22:8080/synthetic.ts';
const nativeFactory=()=>new TransformStream();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function observation(){
 const data={bytes:0,readWaits:[],writeWaits:[],ends:[]};
 return {data,observer:{originBytes:n=>data.bytes+=n,originReadWait:n=>data.readWaits.push(n),originWriteWait:n=>data.writeWaits.push(n),originEnd:reason=>data.ends.push(reason)}};
}
function transport(parts,{byob=false,stall=false,readError=false}={}){
 const queue=parts.map(value=>typeof value==='string'?new TextEncoder().encode(value):value);let cursor=0;
 const state={closed:0,cancelled:0,byobReads:0};
 const read=async()=>{
  if(cursor<queue.length)return {done:false,value:queue[cursor++]};
  if(stall)return new Promise(()=>{});
  if(readError)throw Error('private-origin-error-with-secret');
  return {done:true};
 };
 const reader=()=>({read,cancel:async()=>{state.cancelled++},releaseLock(){}});
 return {state,connect(){return {opened:Promise.resolve(),closed:Promise.resolve(),close:async()=>{state.closed++},writable:new WritableStream(),
  readable:{getReader(options){
   if(options?.mode==='byob'){
    if(!byob)throw TypeError('BYOB unavailable');
    return {...reader(),async readAtLeast(minimum,buffer){state.byobReads++;const result=await read();if(result.done)return result;assert.ok(result.value.length<=buffer.length);buffer.set(result.value);return {done:false,value:buffer.subarray(0,result.value.length)}}};
   }
   return reader();
  }}
 }}};
}
const request=(fixture,observer,native=nativeFactory,signal)=>fetchApprovedMediaIP(target,new Headers(),fixture.connect,native,CCF_MEDIA_ORIGIN,null,8000,signal,observer);

test('native BYOB counts body prefix and remaining media without counting headers',async()=>{
 const fixture=transport(['HTTP/1.0 200 OK\r\nContent-Type: video/mp2t\r\n\r\nabc','d','efg'],{byob:true}),o=observation();
 assert.equal(await (await request(fixture,o.observer)).text(),'abcdefg');
 assert.equal(o.data.bytes,7);assert.deepEqual(o.data.ends,['origin_eof']);assert.equal(fixture.state.byobReads,3);
 assert.ok(o.data.readWaits.length>=3);assert.equal(o.data.writeWaits.length,3);
 assert.ok([...o.data.readWaits,...o.data.writeWaits].every(n=>Number.isFinite(n)&&n>=0));
});

test('content length completion is distinct from actual socket EOF',async()=>{
 const fixture=transport(['HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhello'],{stall:true}),o=observation();
 assert.equal(await (await request(fixture,o.observer)).text(),'hello');
 assert.equal(o.data.bytes,5);assert.deepEqual(o.data.ends,['origin_complete']);assert.equal(fixture.state.closed,1);
});

test('fragmented chunked fallback counts media only, not framing or trailers',async()=>{
 const wire='HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;tag=private\r\nhello\r\n6\r\n world\r\n0\r\n\r\n';
 const fixture=transport([...wire]),o=observation();
 assert.equal(await (await request(fixture,o.observer,false)).text(),'hello world');
 assert.equal(o.data.bytes,11);assert.deepEqual(o.data.ends,['origin_complete']);assert.ok(o.data.readWaits.length>0);assert.equal(o.data.writeWaits.length,0);
});

for(const native of [false,nativeFactory])test('truncated media reports a safe reason '+(native?'native':'fallback'),async()=>{
 const fixture=transport(['HTTP/1.0 200 OK\r\nContent-Length: 8\r\n\r\nshort']),o=observation();
 await assert.rejects((await request(fixture,o.observer,native)).text(),/truncated_http_body/);
 assert.equal(o.data.bytes,5);assert.deepEqual(o.data.ends,['origin_truncated']);
});

test('unknown source errors do not expose their message through the observer',async()=>{
 const fixture=transport(['HTTP/1.0 200 OK\r\n\r\nx'],{readError:true}),o=observation();
 await assert.rejects((await request(fixture,o.observer)).text(),/private-origin-error/);
 assert.deepEqual(o.data.ends,['origin_error']);assert.ok(!JSON.stringify(o.data).includes('private-origin'));
});

test('non-success and redirect bodies are excluded from media continuity statistics',async()=>{
 for(const status of [302,404]){
  const fixture=transport(['HTTP/1.0 '+status+' Status\r\nContent-Length: 6\r\n\r\nsecret']),o=observation();
  assert.equal(await (await request(fixture,o.observer)).text(),'secret');
  assert.deepEqual(o.data,{bytes:0,readWaits:[],writeWaits:[],ends:[]});
 }
});

test('throwing observer does not change media bytes or completion',async()=>{
 const observer=new Proxy({},{get(){return ()=>{throw Error('observer failure')}}});
 const fixture=transport(['HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhe','llo']);
 assert.equal(await (await request(fixture,observer)).text(),'hello');assert.equal(fixture.state.closed,1);
});

test('native downstream cancellation and request abort are not reported as origin failure',async()=>{
 for(const abortRequest of [false,true]){
  const fixture=transport(['HTTP/1.0 200 OK\r\nContent-Length: 100\r\n\r\n'],{stall:true}),o=observation(),abort=new AbortController();
  const response=await request(fixture,o.observer,nativeFactory,abort.signal),reader=response.body.getReader(),reading=reader.read();
  const rejected=abortRequest?assert.rejects(reading,/viewer_abort/):null;
  await tick();
  if(abortRequest)abort.abort(Error('viewer_abort'));else await reader.cancel('viewer_cancel');
  if(rejected)await rejected;else assert.equal((await reading).done,true);
  await tick();assert.deepEqual(o.data.ends,[]);assert.equal(fixture.state.closed,1);
 }
});

test('validated redirect chain forwards observer only to TCP transport',async()=>{
 const observer={},calls=[];
 const fetched=await fetchValidatedMedia(CCF_MEDIA_ORIGIN+'/synthetic.ts',new Headers(),'live',CCF_MEDIA_ORIGIN,{flowMonitor:observer,
  fetchHost:async(url,options)=>{calls.push('hostname');assert.equal(options.flowMonitor,undefined);return new Response(null,{status:302,headers:{location:target}})},
  fetchIP:async(...args)=>{calls.push('tcp');assert.equal(args[8],observer);return new Response('media')}
 });
 assert.equal(await fetched.response.text(),'media');assert.deepEqual(calls,['hostname','tcp']);
});

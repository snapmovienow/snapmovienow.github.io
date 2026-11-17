import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchApprovedMediaIP,fetchWillaxMediaIP,isApprovedMediaIP} from '../src/ip-media.mjs';
import {willaxMediaFetcher} from '../src/willax-transport.mjs';

const root='http://190.93.224.42/WILLAX/index.m3u8';
const segment='http://190.93.224.42/WILLAX/tracks-v1a1/2026/11/17/00/02/46-07200.ts';
const encoder=new TextEncoder();
function wire(reply='HTTP/1.0 200 OK\r\nContent-Length: 3\r\nContent-Type: video/mp2t\r\n\r\nabc',{blockedConnect=false,openBody=false}={}){
 let connects=0,closes=0,written='',target,transportOptions;
 const socket={opened:blockedConnect?new Promise(()=>{}):Promise.resolve(),closed:Promise.resolve(),close:async()=>{closes++},
  writable:new WritableStream({write(bytes){written+=new TextDecoder().decode(bytes)}}),
  readable:new ReadableStream({start(controller){controller.enqueue(encoder.encode(reply));if(!openBody)controller.close();}})};
 return {connect:(address,options)=>{connects++;target=address;transportOptions=options;return socket;},state:()=>({connects,closes,written,target,transportOptions})};
}

test('Willax transport has a separate exact destination policy',async()=>{
 assert.equal(isApprovedMediaIP(new URL(root)),false);
 const blocked=()=>{throw Error('invalid destination must not reach socket')};
 await assert.rejects(fetchApprovedMediaIP(root,new Headers(),blocked),/invalid_media_origin/);
 for(const value of [
  'http://127.0.0.1/WILLAX/index.m3u8',
  'http://169.254.169.254/WILLAX/index.m3u8',
  'http://190.93.224.42:8080/WILLAX/index.m3u8',
  'http://190.93.224.42/OTHER/index.m3u8',
  'http://190.93.224.42/WILLAX/index.m3u8?url=http://127.0.0.1/',
  'http://user:secret@190.93.224.42/WILLAX/index.m3u8',
  'http://190.93.224.42/WILLAX/index.m3u8#fragment',
  'http://190.93.224.42/WILLAX/../WILLAX/index.m3u8',
  'http://190.93.224.42/WILLAX/%2e%2e/WILLAX/index.m3u8',
  'http://190.93.224.42/WILLAX/tracks-v1a1/private.key'
 ])await assert.rejects(fetchWillaxMediaIP(value,new Headers(),blocked),/invalid_media_origin/,value);
});

test('Willax uses the existing finite HTTP parser and forwards only byte range headers',async()=>{
 const fixture=wire('HTTP/1.0 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 4-6/10\r\nContent-Type: video/mp2t\r\n\r\nabc');
 const response=await fetchWillaxMediaIP(segment,new Headers({range:'bytes=4-6','if-range':'"version"',authorization:'Bearer private',cookie:'private=value'}),fixture.connect);
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 4-6/10');assert.equal(await response.text(),'abc');
 const state=fixture.state();assert.deepEqual(state.target,{hostname:'190.93.224.42',port:80});assert.deepEqual(state.transportOptions,{secureTransport:'off'});
 assert.match(state.written,/^GET \/WILLAX\/tracks-v1a1\/2026\/11\/17\/00\/02\/46-07200\.ts HTTP\/1\.0\r\n/);
 assert.match(state.written,/Host: 190\.93\.224\.42\r\n/);assert.match(state.written,/range: bytes=4-6\r\n/);assert.match(state.written,/if-range: "version"\r\n/);
 assert.doesNotMatch(state.written,/private|authorization|cookie/i);assert.equal(state.closes,1);
});

test('redirects remain visible for caller validation and cannot reach another HTTP origin',async()=>{
 const fixture=wire('HTTP/1.0 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\n\r\n');let hostFetches=0;
 const fetcher=willaxMediaFetcher(async()=>{hostFetches++;throw Error('no fallback');},{connectSocket:fixture.connect});
 const response=await fetcher(root);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'http://127.0.0.1/private');await response.body?.cancel();
 assert.equal(fixture.state().connects,1);assert.equal(hostFetches,0);
 await assert.rejects(fetcher(response.headers.get('location')),/invalid_media_origin/);assert.equal(fixture.state().connects,1);
});

test('HEAD cancels the upstream body and releases its socket',async()=>{
 const fixture=wire('HTTP/1.0 200 OK\r\nContent-Length: 3\r\nContent-Type: video/mp2t\r\n\r\n',{openBody:true});
 const fetcher=willaxMediaFetcher(undefined,{connectSocket:fixture.connect});
 const response=await fetcher(segment,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),'3');assert.equal(response.body,null);assert.equal(fixture.state().closes,1);
});

test('caller cancellation closes a blocked Willax connection and preserves its reason',async()=>{
 const fixture=wire(undefined,{blockedConnect:true}),controller=new AbortController(),reason=Error('viewer_stopped');
 const fetcher=willaxMediaFetcher(undefined,{connectSocket:fixture.connect});
 const pending=fetcher(root,{signal:controller.signal});controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(fixture.state().connects,1);assert.equal(fixture.state().closes,1);
 const already=wire(),cancelled=new AbortController();cancelled.abort(reason);
 await assert.rejects(willaxMediaFetcher(undefined,{connectSocket:already.connect})(root,{signal:cancelled.signal}),error=>error===reason);assert.equal(already.state().connects,0);
});

test('native body streaming preserves finite lengths and truncated-body failures',async()=>{
 const fixture=wire(),factory=()=>new TransformStream();
 const response=await willaxMediaFetcher(undefined,{connectSocket:fixture.connect,nativeStreamFactory:factory})(segment);assert.equal(await response.text(),'abc');assert.equal(fixture.state().closes,1);
 const truncated=wire('HTTP/1.0 200 OK\r\nContent-Length: 8\r\n\r\nshort');
 const broken=await willaxMediaFetcher(undefined,{connectSocket:truncated.connect,nativeStreamFactory:factory})(segment);
 await assert.rejects(broken.text(),/truncated_http_body/);assert.equal(truncated.state().closes,1);
});

test('HTTPS keeps the normal fetch transport and unsupported methods never connect',async()=>{
 let fetched,options,connected=false;
 const fetcher=willaxMediaFetcher(async(url,init)=>{fetched=url;options=init;return new Response('page')},{connectSocket:()=>{connected=true;throw Error('no socket')}});
 assert.equal(await (await fetcher('https://willax.pe/en-vivo',{redirect:'follow'})).text(),'page');assert.equal(fetched,'https://willax.pe/en-vivo');assert.equal(options.redirect,'manual');
 for(const method of ['POST','PUT','DELETE'])await assert.rejects(fetcher(root,{method}),/invalid_media_method/);
 await assert.rejects(fetcher(root,{body:'body'}),/invalid_media_method/);assert.equal(connected,false);
});

test('an internal fixture fetchIP still requires the exact station URL before invocation',async()=>{
 let calls=0,passedSignal;const controller=new AbortController();
 const fetcher=willaxMediaFetcher(undefined,{fetchIP:async(value,headers,_connect,_native,_deadline,_budget,signal)=>{calls++;assert.equal(value,root);assert.equal(headers.get('range'),'bytes=0-10');passedSignal=signal;return new Response('fixture');}});
 assert.equal(await (await fetcher(root,{headers:{range:'bytes=0-10'},signal:controller.signal})).text(),'fixture');assert.equal(passedSignal,controller.signal);
 await assert.rejects(fetcher('http://127.0.0.1/WILLAX/index.m3u8'),/invalid_media_origin/);assert.equal(calls,1);
});

import assert from 'node:assert/strict';
import {fetchApprovedMediaIP,CCF_MEDIA_ORIGIN} from '../src/ip-media.mjs';
import {fetchControlMediaIP} from '../src/playback-control-ip.mjs';
import {fetchValidatedMedia} from '../src/media-origin.mjs';
import {LiveStartup} from '../src/live-startup.mjs';

// Entirely synthetic sockets: no DNS, provider accounts or HTTP traffic.
function wire(raw){
 const data=new TextEncoder().encode(raw);let offset=0,written='',closed=0;
 const connect=()=>({opened:Promise.resolve(),closed:Promise.resolve(),close:async()=>{closed++;},
  writable:new WritableStream({write(bytes){written+=new TextDecoder().decode(bytes);}}),
  readable:new ReadableStream({pull(c){if(offset===data.length)c.close();else{const end=Math.min(data.length,offset+7);c.enqueue(data.slice(offset,end));offset=end;}}})});
 return {connect,state:()=>({written,closed})};
}
const target=CCF_MEDIA_ORIGIN+'/movie/fixture/fixture/101.mp4';
const final206='HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-3/100\r\nContent-Length: 4\r\nETag: "current"\r\n\r\nabcd';
const final416='HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */100\r\nContent-Length: 0\r\n\r\n';
const hint='HTTP/1.1 103 Early Hints\r\nLink: </ignored>; rel=preload\r\nContent-Range: bytes */999\r\n\r\n';

for(const range of ['bytes=0-3','bytes=3-','bytes=-4','bytes=0-0,3-3']){
 const original=new Request('https://synthetic.invalid/movie',{headers:{Range:range,'If-Range':'"current"'}});
 const prepared=new LiveStartup().prepare(original),relayRequest=new Request('https://synthetic.invalid/stream',prepared);
 const headers=new Headers();for(const name of ['range','if-range'])headers.set(name,relayRequest.headers.get(name));
 const hops=[];const response=await fetchValidatedMedia(target,headers,'movie',CCF_MEDIA_ORIGIN,{
  fetchHost:async(url,options)=>{hops.push(new Headers(options.headers));return new Response(null,{status:302,headers:{location:'http://89.44.33.22:8080/signed'}});},
  fetchIP:async(url,h)=>{hops.push(new Headers(h));return new Response(null,{status:416,headers:{'content-range':'bytes */100'}});}
 });
 assert.equal(response.response.status,416);assert.equal(response.response.headers.get('content-range'),'bytes */100');
 assert.equal(hops.length,2);for(const h of hops){assert.equal(h.get('range'),range);assert.equal(h.get('if-range'),'"current"');}
}
console.log('PASS: initial preparation, relay Request cloning and redirects preserve closed/open/suffix/multipart Range and If-Range; final 416 metadata is unchanged.');

for(const raw of [hint+final206,'HTTP/1.1 100 Continue\r\n\r\n'+hint+final206,hint+final416,hint.repeat(3)+final416]){
 const requestHeaders=new Headers({range:'bytes=0-3','if-range':'"current"'}),controlWire=wire(raw),relayWire=wire(raw);
 const control=await fetchControlMediaIP(target,requestHeaders,controlWire.connect,undefined,CCF_MEDIA_ORIGIN);
 const relay=await fetchApprovedMediaIP(target,requestHeaders,relayWire.connect,undefined,CCF_MEDIA_ORIGIN);
 assert.equal(relay.status,control.status,'relay and independent control must agree on the final response, not reject its informational prefix');
 assert.equal(relay.headers.get('content-range'),control.headers.get('content-range'));
 assert.equal(relay.headers.get('link'),null,'interim headers cannot leak into the final response');
 assert.equal(await relay.text(),relay.status===206?'abcd':'');
 for(const w of [controlWire,relayWire]){assert.match(w.state().written,/\r\nrange: bytes=0-3\r\n/);assert.match(w.state().written,/\r\nif-range: "current"\r\n/);assert.ok(w.state().closed);}
}
console.log('PASS: 100/103 prefixes preserve final 206 bytes or 416 size and match the independent control, with unchanged outgoing range/validator.');

const largeHint='HTTP/1.1 103 Early Hints\r\nX-Padding: '+'x'.repeat(33000)+'\r\n\r\n';
for(const raw of [hint.repeat(4)+final206,'HTTP/1.1 101 Switching Protocols\r\n\r\n'+final206,largeHint.repeat(2)+final206]){
 const w=wire(raw);await assert.rejects(fetchApprovedMediaIP(target,new Headers(),w.connect,undefined,CCF_MEDIA_ORIGIN),/invalid_http_response/);assert.ok(w.state().closed);
}
console.log('PASS: bounded interim count, unsupported protocol upgrade and total header-size limit reject and close sockets.');

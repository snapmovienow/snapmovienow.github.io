import assert from 'node:assert/strict';
import {CCF_MEDIA_ORIGIN,fetchApprovedMediaIP,isApprovedMediaIP,isPublicMediaIPv4} from '../src/ip-media.mjs';
function transport(raw,split=7){const bytes=new TextEncoder().encode(raw);let offset=0,closed=false,written='';return {connect(){return {opened:Promise.resolve(),closed:Promise.resolve(),close:async()=>{closed=true},readable:new ReadableStream({pull(c){if(offset>=bytes.length)c.close();else{c.enqueue(bytes.slice(offset,offset+split));offset+=split}}}),writable:new WritableStream({write(b){written+=new TextDecoder().decode(b)}})}},state:()=>({closed,written})}}
const allowed='http://192.101.68.144/a.m3u8';
assert.ok(isApprovedMediaIP(new URL(allowed)));for(const u of ['http://127.0.0.1/','http://192.101.68.144:8080/','https://192.101.68.144/','http://user:password@192.101.68.144/'])assert.ok(!isApprovedMediaIP(new URL(u)));
let t=transport('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nContent-Type: text/plain\r\n\r\nhello world');let r=await fetchApprovedMediaIP(allowed,new Headers({range:'bytes=0-10'}),t.connect);assert.equal(await r.text(),'hello world');assert.ok(t.state().closed);assert.ok(t.state().written.includes('range: bytes=0-10'));
t=transport('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;extension=yes\r\nhello\r\n6\r\n world\r\n0\r\n\r\n',1);r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect);assert.equal(await r.text(),'hello world');assert.equal(r.headers.get('transfer-encoding'),null);
t=transport('HTTP/1.1 302 Found\r\nLocation: /other.m3u8\r\nContent-Length: 0\r\n\r\n');r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect);assert.equal(r.status,302);await r.body.cancel();assert.ok(t.state().closed);
t=transport('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort');r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect);await assert.rejects(r.text(),/truncated/);
await assert.rejects(fetchApprovedMediaIP('http://127.0.0.1/',new Headers(),t.connect),/invalid_media_origin/);
console.log('PASS: allowlisted destination, fragmented headers, range forwarding, content length, chunked response, cancellation, truncated body rejection.');


for(const host of ['23.153.217.88','194.147.150.141'])assert.ok(isApprovedMediaIP(new URL('http://'+host+'/live/test.m3u8')));

const nativeLengths=[];
const nativeFactory=length=>{nativeLengths.push(length);let count=0;return new TransformStream({transform(chunk,c){count+=chunk.length;if(length!==null&&count>length)throw Error('invalid_media_length');c.enqueue(chunk)},flush(){if(length!==null&&count!==length)throw Error('truncated_http_body')}})};
const large='x'.repeat(3*1024*1024);
t=transport('HTTP/1.0 206 OK\r\nContent-Length: '+large.length+'\r\nContent-Range: bytes 0-'+(large.length-1)+'/'+large.length+'\r\n\r\n'+large,1397);
r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect,nativeFactory);
assert.equal((await r.arrayBuffer()).byteLength,large.length);
assert.equal(nativeLengths.at(-1),large.length);
assert.ok(t.state().written.includes('HTTP/1.0'),'request disables chunk framing for native byte transport');
t=transport('HTTP/1.0 206 OK\r\nContent-Range: bytes 10-15/100\r\n\r\nabcdef',3);
r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect,nativeFactory);assert.equal(await r.text(),'abcdef');assert.equal(nativeLengths.at(-1),6);
t=transport('HTTP/1.0 200 OK\r\nContent-Length: 10\r\n\r\nshort',4);
r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect,nativeFactory);await assert.rejects(r.text(),/truncated_http_body/);
t=transport('HTTP/1.0 200 OK\r\nContent-Length: 10000\r\n\r\n'+'x'.repeat(10000),100);
r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect,nativeFactory);await r.body.cancel();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(t.state().closed,'canceling native transport closes the provider socket');
console.log('PASS: native multi-megabyte transfer, HTTP/1.0 framing, range-derived length, truncated EOF rejection and cancellation.');

// A server can leave its TCP connection open after delivering Content-Length.
// Completing a finite HTTP body must not depend on a subsequent socket EOF.
function openSocket(raw){
 const bytes=new TextEncoder().encode(raw);let sent=false,closed=false;
 return {connect(){return {opened:Promise.resolve(),closed:Promise.resolve(),close:async()=>{closed=true},
  readable:new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(bytes)}else return new Promise(()=>{})}}),
  writable:new WritableStream()}},state:()=>({closed})};
}
t=openSocket('HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhello');
r=await fetchApprovedMediaIP(allowed,new Headers(),t.connect,nativeFactory);
let deadline;
try{assert.equal(await Promise.race([r.text(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('finite_body_waited_for_socket_eof')),250)})]),'hello')}
finally{clearTimeout(deadline)}
assert.ok(t.state().closed,'finite body completion closes the upstream socket');
console.log('PASS: a complete finite response does not wait for upstream socket EOF.');

for(const host of ['89.44.33.22','11.22.33.44','45.90.28.10']){
 assert.ok(isPublicMediaIPv4(host));
 assert.ok(isApprovedMediaIP(new URL('http://'+host+':8080/live.m3u8'),CCF_MEDIA_ORIGIN));
 assert.ok(!isApprovedMediaIP(new URL('http://'+host+'/live.m3u8')));
 assert.ok(!isApprovedMediaIP(new URL('http://'+host+'/live.m3u8'),'https://other.example'));
}
for(const host of ['0.1.2.3','10.0.0.1','100.64.0.1','100.127.255.255','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','192.0.0.1','192.0.2.1','192.88.99.1','198.18.0.1','198.19.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','255.255.255.255','1.2.3.256','1.2.3','localhost','[::1]'])assert.ok(!isPublicMediaIPv4(host),host);
for(const value of ['http://2130706433/','http://0x7f000001/','http://0177.0.0.1/','https://89.44.33.22/','http://user:password@89.44.33.22/','http://89.44.33.22:25/'])assert.ok(!isApprovedMediaIP(new URL(value),CCF_MEDIA_ORIGIN));
t=transport('HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhello');let destination;
r=await fetchApprovedMediaIP('http://89.44.33.22:8080/signed/live.m3u8',new Headers(),(target,options)=>{destination=target;assert.equal(options.secureTransport,'off');return t.connect()},undefined,CCF_MEDIA_ORIGIN);
assert.equal(await r.text(),'hello');assert.deepEqual(destination,{hostname:'89.44.33.22',port:8080});assert.ok(t.state().written.includes('Host: 89.44.33.22:8080\r\n'));
console.log('PASS: public IPv4 rotation requires trusted CCF provenance, reserved networks remain blocked, and the provider HTTP port is preserved.');
// Exercise the actual socket header timer without a nine-second wall-clock
// sleep. The timer must use the declared content budget, then the shared
// remaining deadline, while the body retains its independent idle timeout.
const realSetTimeout=globalThis.setTimeout,realNow=Date.now;let timerClock=1000,headerTimers=[];
globalThis.setTimeout=(fn,delay,...args)=>{headerTimers.push(delay);return realSetTimeout(fn,delay,...args)};Date.now=()=>timerClock;
try{
 for(const budget of [8000,12000]){
  headerTimers=[];timerClock=1000;const wire=transport('HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhello',7);
  const response=await fetchApprovedMediaIP(allowed,new Headers(),wire.connect,undefined,CCF_MEDIA_ORIGIN,1000+budget,budget);
  const beforeBody=[...headerTimers];assert.ok(beforeBody.length>2);assert.ok(beforeBody.every(ms=>ms===budget),'the socket, write and header reads share the content-specific deadline');
  assert.equal(await response.text(),'hello');
 }
 headerTimers=[];timerClock=10000;const wire=transport('HTTP/1.0 200 OK\r\nContent-Length: 0\r\n\r\n');
 await fetchApprovedMediaIP(allowed,new Headers(),wire.connect,undefined,CCF_MEDIA_ORIGIN,13000,12000);assert.ok(headerTimers.every(ms=>ms===3000),'later socket hops cannot create another twelve seconds');
}finally{globalThis.setTimeout=realSetTimeout;Date.now=realNow;}
console.log('PASS: live/VOD socket header deadlines and shared remaining redirect budget.');

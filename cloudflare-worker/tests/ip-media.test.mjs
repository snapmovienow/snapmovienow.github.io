import assert from 'node:assert/strict';
import {fetchApprovedMediaIP,isApprovedMediaIP} from '../src/ip-media.mjs';
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

import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {join} from 'node:path';
import {createHTTPSProxy} from 'workers-fetch-proxy/https';
import {subtls} from 'workers-fetch-proxy/subtls';

const root=readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'root.pem'),'utf8');
const credentials={cert:readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'server.pem')),
  key:readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'server.key'))};
const connections=new Set();
const origin=https.createServer(credentials,(request,response)=>{
  assert.equal(request.headers['proxy-authorization'],undefined,'proxy login must never reach the origin');
  response.writeHead(request.headers.range?206:200,{'Content-Type':'application/json'});
  response.end(JSON.stringify({path:request.url,range:request.headers.range||null}));
});
origin.on('connection',s=>{connections.add(s);s.on('close',()=>connections.delete(s))});
origin.listen(0,'127.0.0.1');await once(origin,'listening');
const proxy=tls.createServer(credentials, socket=>{
  let head='';
  function readHead(chunk){
    head+=chunk.toString();
    if(head.length>8192){socket.destroy();return}
    if(!head.includes('\r\n\r\n'))return;
    socket.off('data',readHead);
    if(!head.includes('Proxy-Authorization: Basic '+Buffer.from('fixture-user:fixture-password').toString('base64'))){
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');return;
    }
    const target=head.split('\r\n')[0];
    if(!/^CONNECT (origin|wrong)\.test:443 HTTP\/1\.1$/.test(target)){socket.destroy();return}
    const onward=net.connect(origin.address().port,'127.0.0.1',()=>{
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(onward);onward.pipe(socket);
    });
    connections.add(onward);onward.on('close',()=>connections.delete(onward));
    onward.on('error',()=>socket.destroy());socket.on('close',()=>onward.destroy());
  }
  socket.on('data',readHead);
});
proxy.on('connection',s=>{connections.add(s);s.on('close',()=>connections.delete(s))});
proxy.on('tlsClientError',()=>{});origin.on('tlsClientError',()=>{});
proxy.listen(0,'127.0.0.1');await once(proxy,'listening');globalThis.proxyFixturePort=proxy.address().port;
const make=(password='fixture-password',roots=root)=>createHTTPSProxy({host:'proxy.test',port:443,
  username:'fixture-user',password},{tls:subtls({rootCertificates:roots})});
try{
  const start=performance.now();
  const response=await make().fetch('https://origin.test/channel.m3u8?signature=fixture',{headers:{Range:'bytes=0-4095'}});
  assert.equal(response.status,206);
  assert.deepEqual(await response.json(),{path:'/channel.m3u8?signature=fixture',range:'bytes=0-4095'});
  const elapsed=Math.round(performance.now()-start);
  await assert.rejects(()=>make('wrong-password').fetch('https://origin.test/'),/407/);
  await assert.rejects(()=>make().fetch('https://wrong.test/'),/name|match|host/i);
  await assert.rejects(()=>make('fixture-password','').fetch('https://origin.test/'),/root|trust|certificate/i);
  console.log(JSON.stringify({result:'PASS',checks:['TLS inside TLS with certificate verification','proxy authentication','signed query and range preserved','proxy credentials not forwarded','bad credentials rejected','wrong hostname rejected','untrusted certificate rejected'],localRoundTripMs:elapsed,realSurfsharkTested:false,realMeridianoTested:false}));
}finally{
  for(const socket of connections)socket.destroy();
  await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>origin.close(resolve))]);
}

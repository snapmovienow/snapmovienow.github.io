import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {join} from 'node:path';
import {createHTTPSProxy} from 'workers-fetch-proxy/https';
import {subtls} from 'workers-fetch-proxy/subtls';
import {privateConnectionProbe} from '../private-connection-probe.mjs';
import {handlePrivatePilot,CARACAS_PROFILE_ID} from '../private-pilot-handler.mjs';
import {privateOriginProof} from '../private-origin-proof.mjs';
import {verifiedOriginProof} from './verified-origin-proof.mjs';
import {connect as fixtureConnect} from './cloudflare-socket-fixture.mjs';

const root=readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'root.pem'),'utf8');
const credentials={cert:readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'server.pem')),
  key:readFileSync(join(process.env.MERIDIANO_TLS_FIXTURE,'server.key'))};
const connections=new Set();
const origin=https.createServer(credentials,(request,response)=>{
  assert.equal(request.headers['proxy-authorization'],undefined,'proxy login must never reach the origin');
  if(request.url==='/cdn-cgi/trace'){response.writeHead(200,{'Content-Type':'text/plain','Content-Encoding':'identity'});response.end('loc=VE\n');return}
  if(request.url==='/player/metadata/video/x9sxu9y'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{code:'DM007'}}));return}
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
    if(!/^CONNECT (?:(origin|wrong)\.test|www\.(?:dailymotion|cloudflare)\.com):443 HTTP\/1\.1$/.test(target)){socket.destroy();return}
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
  let attempts=0;
  const localConnect=(address,options)=>{
    attempts++;assert.equal(address.hostname,'ve-car.prod.surfshark.com');assert.equal(address.port,443);
    return fixtureConnect({...address,hostname:'proxy.test'},options);
  };
  const ownerToken='fixture-only-owner-token-'.repeat(2);
  const fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Bearer '+ownerToken))).toString('hex');
  const env={MERIDIANO_PROBE_TOKEN_HASH:fingerprint,MERIDIANO_PROBE_EXPIRES_AT:String(Date.now()+1800000),SURFSHARK_SERVICE_USERNAME:'fixture-user',SURFSHARK_SERVICE_PASSWORD:'fixture-password'};
  const privateRequest=()=>new Request('https://owner-private.test/',{method:'POST',headers:{Authorization:'Bearer '+ownerToken}});
  assert.equal((await privateConnectionProbe(new Request('https://owner-private.test/'),env,localConnect)).status,403);
  assert.equal(attempts,0,'private probe cannot open sockets before owner authentication');
  assert.equal((await privateConnectionProbe(privateRequest(),{...env,MERIDIANO_PROBE_EXPIRES_AT:String(Date.now()-1)},localConnect)).status,403);
  assert.equal(attempts,0,'expired owner authorization cannot open sockets');
  const pilotRequest=(payload,token=ownerToken)=>new Request('https://owner-private.test/health',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const service={profileId:CARACAS_PROFILE_ID,username:'fixture-user',password:'fixture-password'};
  assert.equal((await handlePrivatePilot(pilotRequest(service,'invalid'),env,localConnect)).status,403);
  assert.equal((await handlePrivatePilot(pilotRequest({...service,profileId:'other'}),env,localConnect)).status,400);
  assert.equal((await handlePrivatePilot(pilotRequest({...service,target:'https://other.test'}),env,localConnect)).status,400);
  assert.equal(attempts,0,'authorization and input validation precede sockets');
  const pilot=await handlePrivatePilot(pilotRequest(service),env,localConnect);
  const pilotText=await pilot.text();assert.equal(JSON.parse(pilotText).proxyStatus,200);
  assert.ok(!pilotText.includes(service.password)&&!pilotText.includes(service.username)&&!pilotText.includes(ownerToken));
  const result=await (await privateConnectionProbe(privateRequest(),env,localConnect)).json();
  assert.equal(result.proxyStatus,200);assert.equal(result.liveMediaVerified,false);
  const denied=await (await privateConnectionProbe(privateRequest(),{...env,SURFSHARK_SERVICE_PASSWORD:'wrong'},localConnect)).json();
  assert.equal(denied.proxyStatus,407);
  const originDeps={connect:localConnect,upgradeTls:subtls({rootCertificates:root})};
  const country=await (await privateOriginProof('country',{username:'fixture-user',password:'fixture-password'},originDeps)).json();
  assert.equal(country.observedCountry,'VE');assert.equal(country.countryVerified,true);assert.equal(country.liveMediaVerified,false);
  const metadata=await (await privateOriginProof('metadata',{username:'fixture-user',password:'fixture-password'},originDeps)).json();
  assert.equal(metadata.geoBlocked,true);assert.equal(metadata.hlsQualitiesFound,0);assert.equal(metadata.liveMediaVerified,false);
  const badCert=await (await privateOriginProof('country',{username:'fixture-user',password:'fixture-password'},{...originDeps,upgradeTls:subtls({rootCertificates:''})})).json();
  assert.equal(badCert.error,'origin_proof_failed');assert.equal(badCert.phase,'origin_tls');
  let closedOnDeadline=false;
  const stalled=await (await privateOriginProof('country',{username:'fixture-user',password:'fixture-password'},
    {timeoutMs:5,upgradeTls:()=>{throw Error('TLS must not start')},connect:()=>({opened:new Promise(()=>{}),close:async()=>{closedOnDeadline=true}})})).json();
  assert.equal(stalled.proofFailure,'deadline');assert.equal(closedOnDeadline,true,'deadline must close the underlying native socket');
  const verifiedDeps={connect:localConnect,trust:{mode:'anchors',anchors:[root]}};
  const verifiedCountry=await (await verifiedOriginProof('country',{username:'fixture-user',password:'fixture-password'},verifiedDeps)).json();
  assert.equal(verifiedCountry.countryVerified,true);assert.equal(verifiedCountry.liveMediaVerified,false);
  const verifiedMetadata=await (await verifiedOriginProof('metadata',{username:'fixture-user',password:'fixture-password'},verifiedDeps)).json();
  assert.equal(verifiedMetadata.geoBlocked,true);assert.equal(verifiedMetadata.hlsQualitiesFound,0);
  const unknownIssuer=await verifiedOriginProof('country',{username:'fixture-user',password:'fixture-password'},{connect:localConnect});
  assert.equal(unknownIssuer.status,502,'bundled trust must reject the synthetic issuer');
  const deniedVerified=await verifiedOriginProof('country',{username:'fixture-user',password:'wrong-password'},verifiedDeps);
  const deniedText=await deniedVerified.text();assert.equal(deniedVerified.status,502);
  assert.ok(!deniedText.includes('fixture-user')&&!deniedText.includes('wrong-password'));
  console.log(JSON.stringify({result:'PASS',checks:['TLS inside TLS with certificate verification','proxy authentication','signed query and range preserved','proxy credentials not forwarded','bad credentials rejected','wrong hostname rejected','untrusted certificate rejected','private probe owner authentication and fixed destination'],localRoundTripMs:elapsed,realSurfsharkTested:false,realMeridianoTested:false}));
}finally{
  for(const socket of connections)socket.destroy();
  await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>origin.close(resolve))]);
}

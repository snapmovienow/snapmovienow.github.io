import assert from 'node:assert/strict';
import {traceRequest} from '../src/request-diagnostics.mjs';
import {gatewayDiagnostic,takeGatewayFailure} from '../src/portal-gateway-diagnostics.mjs';
import {createOwnerPortal} from '../src/owner-portal.mjs';
import {createResellerPortal,PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
const config={accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'a'.repeat(64),siteToken:'synthetic-private-token'};
const records=[];
{
 for(const type of ['owner','reseller']){
  const url=type==='owner'?'https://api.snaptvnow.com/owner-panel/api/panel?lineId=private-id':'https://resellers.snaptvnow.com/api/panel?lineId=private-id';
  const cookie=type==='owner'?'__Host-SNAP_Owner_Portal='+'x'.repeat(64):'__Host-SNAP_Resellers='+'a'.repeat(64);
  const make=type==='owner'?createOwnerPortal:createResellerPortal;
  for(const [kind,fetcher]of [['network',async()=>{throw TypeError('private network detail')}],['timeout',async()=>{throw new DOMException('private timeout','TimeoutError')}],['abort',async()=>{throw new DOMException('private abort','AbortError')}],['network',async()=>new Response(new ReadableStream({start(c){c.error(TypeError('private body interruption'))}}))],['invalid_response',async()=>new Response('private invalid body')],['scope',async()=>Response.json({actor:{id:'private-account',role:type==='owner'?'reseller':'owner'}})],['upstream_http',async()=>Response.json({error:'service_unavailable',final:false},{status:503})]]){
   const before=records.length,portal=make({getConfig:async()=>config,fetcher});
   const req=new Request(url,{headers:{Cookie:cookie,'CF-Ray':'0123456789abcdef-ORD'}}),r=await traceRequest(req,()=>portal(req,{}),{logger:r=>records.push(r.portal)}),b=await r.json();assert.equal(r.headers.get('X-SMN-Request-ID'),b.diagnostic.reference);
   assert.equal(r.status,503);assert.equal(b.final,false);assert.equal(b.diagnostic.kind,kind);assert.equal(b.diagnostic.action,'read');assert.equal(b.diagnostic.operation,'detail');assert.ok(b.message.includes(b.diagnostic.reference));assert.equal(records.length,before+1);
   assert.equal(records.at(-1).reference,b.diagnostic.reference);assert.equal(records.at(-1).platformRay,'0123456789abcdef');
  }
  const before=records.length,portal=make({getConfig:async()=>config,fetcher:async()=>Response.json({ok:true})});
  assert.equal((await portal(new Request(url,{headers:{Cookie:cookie}}),{})).status,200);assert.equal(records.length,before,'no success logs');
 }

 for(const type of ['owner','reseller']){
  let calls=0;const make=type==='owner'?createOwnerPortal:createResellerPortal;
  const url=type==='owner'?'https://api.snaptvnow.com/owner-panel/api/panel':'https://resellers.snaptvnow.com/api/panel';
  const cookie=type==='owner'?'__Host-SNAP_Owner_Portal='+'x'.repeat(64):'__Host-SNAP_Resellers='+'a'.repeat(64),origin=new URL(url).origin;
  const portal=make({getConfig:async()=>config,fetcher:async(_,options)=>{calls++;const b=JSON.parse(options.body);assert.equal(b.input.requestId,'synthetic-existing-operation');throw TypeError('write uncertain')}});
  const req=new Request(url,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'line.renew',requestId:'synthetic-existing-operation'})});
  const r=await traceRequest(req,()=>portal(req,{}),{logger:r=>records.push(r.portal)}),b=await r.json();assert.equal(calls,1);assert.equal(b.final,false);assert.equal(b.diagnostic.operation,'write');assert.ok(!JSON.stringify(b.diagnostic).includes('synthetic-existing-operation'));
 }
 const recordText=JSON.stringify(records);for(const value of ['private-id','private-account','private-token','private invalid','private network','https://','Cookie','password'])assert.ok(!recordText.includes(value));

 const req=new Request('https://synthetic.test/?q=private'),d=gatewayDiagnostic('owner',req);d.phase('not-allowlisted');d.action({action:'injected-private',query:{q:'private'}});const failure=d.failure({error:'owner_unavailable',final:false});assert.equal(failure.diagnostic.action,'unknown');d.failure({},503);assert.equal(takeGatewayFailure(req).reference,failure.diagnostic.reference);assert.equal(takeGatewayFailure(req),undefined,'ephemeral metadata consumed once');
 const c=new AbortController();c.abort();const diag=gatewayDiagnostic('owner',new Request('https://synthetic.test',{signal:c.signal}));diag.phase('fetch');assert.equal(diag.failure({},503,new DOMException('','AbortError')).diagnostic.clientDisconnected,true);
 console.log('PASS gateway failures: actual handlers + existing request wrapper, distinct causes, same response/log/header ID, no extra logs, safe metadata and abort uncertainty');
}

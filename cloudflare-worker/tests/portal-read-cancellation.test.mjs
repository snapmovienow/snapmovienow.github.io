import test from 'node:test';import assert from 'node:assert/strict';
import {createOwnerPortal} from '../src/owner-portal.mjs';
import {createResellerPortal,PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
const token='a'.repeat(64),cfg={accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret:'b'.repeat(64),siteToken:'synthetic-only'};
for(const kind of ['owner','reseller']){
 const create=kind==='owner'?createOwnerPortal:createResellerPortal,origin=kind==='owner'?'https://api.snaptvnow.com/owner-panel':'https://juanito.resellers.snaptvnow.com';
 const cookie=(kind==='owner'?'__Host-SNAP_Owner_Portal':'__Host-SNAP_Reseller')+'='+token;
 for(const phase of ['headers','body'])test(kind+' read cancellation during '+phase,async()=>{
  const c=new AbortController(),reason=Error('fixture_cancel');let signal,enter,finish;const started=new Promise(r=>enter=r);
  const handle=create({getConfig:async()=>cfg,fetcher:async(_u,o)=>{signal=o.signal;enter();if(phase==='headers')return new Promise(r=>finish=()=>r(Response.json({ok:true})));return {status:200,headers:new Headers(),text:()=>new Promise(r=>finish=()=>r('{"ok":true}'))}}});
  const pending=handle(new Request(origin+'/api/panel',{headers:{Cookie:cookie},signal:c.signal}),{});await started;if(phase==='body')await new Promise(r=>setTimeout(r,0));c.abort(reason);const aborted=signal.aborted,actual=signal.reason;finish();await pending;assert.equal(aborted,true);assert.equal(actual,reason);
 });
 for(const action of ['write','logout',...(kind==='reseller'?['login']:[])])test(kind+' '+action+' is not coupled to caller cancellation',async()=>{
  const c=new AbortController();let signal,calls=0;
  const path=action==='write'?'/api/panel':'/api/portal/'+action;
  const h=create({getConfig:async()=>cfg,fetcher:async(_u,o)=>{calls++;signal=o.signal;c.abort();return Response.json(action==='login'?{ok:true,token,accountId:PORTAL_ACCOUNT}:{ok:true})}});
  const result=await h(new Request(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:new URL(origin).origin,'Content-Type':'application/json'},body:'{}',signal:c.signal}),{});assert.equal(calls,1);assert.equal(signal.aborted,false);assert.equal(result.status,200);
 });
}
for(const kind of ['owner','reseller'])test(kind+' pending upstream is rejected on read abort, no retry',async()=>{
 const create=kind==='owner'?createOwnerPortal:createResellerPortal,origin=kind==='owner'?'https://api.snaptvnow.com/owner-panel':'https://juanito.resellers.snaptvnow.com',cookie=(kind==='owner'?'__Host-SNAP_Owner_Portal':'__Host-SNAP_Reseller')+'='+token,c=new AbortController();let enter,calls=0;const started=new Promise(r=>enter=r);
 const handle=create({getConfig:async()=>cfg,fetcher:(_u,o)=>{calls++;enter();return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))}});
 const pending=handle(new Request(origin+'/api/panel',{headers:{Cookie:cookie},signal:c.signal}),{});await started;c.abort(Error('synthetic_abort'));const result=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('fixture_wait_timeout')),100))]);assert.equal(result.status,503);assert.equal(calls,1);
});

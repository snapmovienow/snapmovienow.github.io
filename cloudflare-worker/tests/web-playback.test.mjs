import assert from 'node:assert/strict';
import {prepareWebPlayback} from '../src/web-playback.mjs';
const session={managed:true,sid:'test-session',exp:Date.now()+60000},ctx={waitUntil(){}},request={type:'live',id:'123',ext:'m3u8',request_id:'client-request',revision:100};
function setup(signals){
 const events=[],leases=new Set();let n=0;
 const deps={origin:'http://ccf.center:8444',cleanExt:x=>x||'mp4',json:(data,status=200)=>Response.json(data,{status}),
  async directory(env,path,body){events.push({path,...body});if(path==='/release')leases.delete(body.lease_id);return Response.json({ok:true})},
  async managedPlayback(env,s,server,context,excluded){assert.equal(context,ctx);assert.equal(s.request_id,'client-request');assert.equal(leases.size,0,'failed lease is released before allocating again');assert.deepEqual(excluded,Array.from({length:n},(_,i)=>'account-'+i));const provider_id='account-'+n++,lease_id='lease-'+provider_id;leases.add(lease_id);return {provider_id,credentials:{username:'fake-user',password:'fake-password'},r:Response.json({lease_id})}},
  async ticket(env,data){return data.lease_id},
  async serverStream(){const next=signals.shift();if(next instanceof Error)throw next;return new Response(next===200?'#EXTM3U\n#test': 'unavailable',{status:next})}
 };
 return {deps,events,leases};
}
let test=setup([502,200]);let response=await prepareWebPlayback(request,session,'https://example.com',{},ctx,test.deps);
assert.equal(response.status,200);assert.equal((await response.json()).request_id,'client-request');
assert.equal(test.events.filter(e=>e.path==='/playback-begin').length,1);assert.equal(test.events.filter(e=>e.path==='/release').length,1);assert.equal(test.leases.size,1);
test=setup([502,502,502]);response=await prepareWebPlayback(request,session,'https://example.com',{},ctx,test.deps);assert.equal(response.status,502);assert.equal(test.leases.size,0);
test=setup([410,200]);response=await prepareWebPlayback(request,session,'https://example.com',{},ctx,test.deps);assert.equal(response.status,410);assert.equal(test.leases.size,0);
test=setup([Error('media_origin_unapproved'),200]);response=await prepareWebPlayback(request,session,'https://example.com',{},ctx,test.deps);assert.equal(response.status,502);assert.equal((await response.json()).error,'media_origin_unapproved');assert.equal(test.leases.size,0);
console.log('PASS: live account fallback, shared request ownership, release before retry, bounded attempts, cancelled requests and blocked destinations never retried.');

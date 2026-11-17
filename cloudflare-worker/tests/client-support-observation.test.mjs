import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientSupportObservation} from '../src/client-support-observation.mjs';

const identity={uid:'user-1',username:'MixedCase01',version:3};
function fixture(options={}){const writes=[],waits=[];let at=100000;const observer=createClientSupportObservation({ctx:{waitUntil:work=>waits.push(work)},write:async body=>writes.push(body),now:()=>at,...options});return {observer,writes,waits,advance:()=>at+=25};}
test('only server-generated metadata is queued after the unchanged catalogue response',async()=>{
 const f=fixture();f.observer.start(identity,{kind:'catalog',type:'movie',selection:'source',headers:{Authorization:'private'},url:'https://private.invalid'});f.observer.reply([{password:'private-secret',direct_source:'https://secret.invalid'}]);f.advance();
 const response=Response.json([{name:'unchanged'}]);assert.equal(f.observer.finish(response),response);assert.deepEqual(await response.json(),[{name:'unchanged'}]);await Promise.all(f.waits);
 assert.equal(f.writes.length,1);const row=f.writes[0];assert.equal(row.itemCount,1);assert.equal(row.selection,'source');assert.equal(row.uid,'user-1');assert.equal(row.version,3);assert.equal(row.at,100000);assert.equal(row.respondedAt,100025);assert.match(row.requestId,/^[a-f0-9-]{36}$/);assert.ok(!JSON.stringify(row).includes('private'));assert.ok(!JSON.stringify(row).includes('https:'));
 f.observer.finish(response);await Promise.all(f.waits);assert.equal(f.writes.length,1,'one response cannot be counted twice');
});
test('HEAD, service checks, unauthenticated and unsupported observations do not write',async()=>{
 for(const options of [{method:'HEAD'},{serviceCheck:true},{ctx:null}]){const f=fixture(options);f.observer.start(identity,{kind:'catalog',type:'live'});f.observer.reply([]);f.observer.finish(Response.json([]));await Promise.all(f.waits);assert.equal(f.writes.length,0);}
 for(const [who,input]of [[null,{kind:'catalog',type:'live'}],[{...identity,version:undefined},{kind:'catalog',type:'live'}],[identity,{kind:'catalog',type:'category'}],[identity,{kind:'metric',type:'live'}]]){const f=fixture();f.observer.start(who,input);f.observer.finish(Response.json([]));await Promise.all(f.waits);assert.equal(f.writes.length,0);}
});
test('playback successes and expected policy outcomes are excluded, exact failures retain a numeric reference',async()=>{
 for(const [status,code]of [[200,null],[410,'playback_superseded'],[409,'user_connection_limit'],[403,'content_disabled']]){const f=fixture();f.observer.start(identity,{kind:'playback',type:'live',publicId:'12'});f.observer.reply(code?{error:code}:null,status);f.observer.finish(new Response(null,{status}));await Promise.all(f.waits);assert.equal(f.writes.length,0);}
 const f=fixture();f.observer.start(identity,{kind:'playback',type:'series',publicId:'876'});f.observer.reply({error:'upstream_unavailable',secret:'private'},502);f.observer.finish(new Response(null,{status:502}));await Promise.all(f.waits);assert.equal(f.writes[0].publicId,'876');assert.equal(f.writes[0].code,'upstream_unavailable');assert.equal(f.writes[0].kind,'playback');assert.ok(!JSON.stringify(f.writes).includes('private'));
});
test('a disabled section returning HTTP 200 and an empty list remains a policy observation',async()=>{
 const f=fixture();f.observer.start(identity,{kind:'catalog',type:'live',code:'content_disabled'});f.observer.reply([]);f.observer.finish(Response.json([]));await Promise.all(f.waits);assert.equal(f.writes[0].code,'content_disabled');assert.equal(f.writes[0].itemCount,0);assert.equal(f.writes[0].httpStatus,200);
});
test('failed or stalled recording cannot delay or change the response',async()=>{
 for(const write of [()=>{throw Error('private-exception');},()=>new Promise(()=>{})]){const f=fixture({write});f.observer.start(identity,{kind:'catalog',type:'live'});f.observer.reply([]);const response=Response.json([]);assert.equal(f.observer.finish(response),response);assert.deepEqual(await response.json(),[]);}
});

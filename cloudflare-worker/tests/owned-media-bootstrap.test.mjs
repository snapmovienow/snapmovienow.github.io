import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedMediaBootstrap} from '../src/owned-media-bootstrap.mjs';
test('authorized connection starts one fixed private job without request input',async()=>{
 const tasks=[];let calls=0;
 const env={ENVIRONMENT:'production',SNAP_OWNED_MEDIA_SITE_TOKEN:'private',PLAYBACK_CANARY_USERNAME:'owner-fixture',PLAYBACK_SESSIONS:{idFromName(name){assert.equal(name,'__smn_owned_media_verification_20261106');return name;},get(){return{fetch:async(url,init)=>{calls++;assert.equal(url,'https://private/owned-media-verification-run');assert.deepEqual(init,{method:'POST',body:'{}'});return Response.json({ok:true});}};}}};
 const boot=createOwnedMediaBootstrap({now:()=>Date.parse('2026-11-04T19:00:00Z')});for(let i=0;i<10;i++)boot(env,{waitUntil:promise=>tasks.push(promise)});
 await Promise.all(tasks);assert.equal(tasks.length,1);assert.equal(calls,1);
 const disabled=createOwnedMediaBootstrap({now:()=>Date.parse('2026-11-04T19:00:00Z')});disabled({...env,ENVIRONMENT:'staging'},{waitUntil:()=>{throw Error('staging must not run');}});disabled({...env,SNAP_OWNED_MEDIA_SITE_TOKEN:''},{waitUntil:()=>{throw Error('missing private connection');}});disabled(env);assert.equal(calls,1);
});

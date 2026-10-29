import test from 'node:test';
import assert from 'node:assert/strict';
import {readInitialMedia} from '../src/live-startup.mjs';
function source(parts,{supportsByob=true,readError=null}={}){
 let canceled=0;const views=[],modes=[];let index=0;
 const reader={async read(view){views.push(view?.byteLength??null);if(readError)throw readError;return index<parts.length?{done:false,value:Uint8Array.from(parts[index++])}:{done:true};},async cancel(){canceled++;}};
 return {response:{body:{getReader(options){modes.push(options?.mode||'default');if(options?.mode==='byob'&&!supportsByob)throw new TypeError('not byte stream');return reader;}},status:206,statusText:'Partial Content',headers:new Headers({'content-range':'bytes 0-3/4','content-length':'4','etag':'"same"'})},views,modes,get canceled(){return canceled;}};
}
test('BYOB reads maximum64KiB with no minimum and preserves bytes/headers',async()=>{const f=source([[1],[2,3],[4]]);const r=await readInitialMedia(f.response,Date.now()+1000);assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3,4]);assert.ok(f.views.every(n=>n===65536));assert.deepEqual(f.modes,['byob']);assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-3/4');assert.equal(r.headers.get('etag'),'"same"');});
test('non-byte fallback remains supported',async()=>{const f=source([[1,2,3,4]],{supportsByob:false});const r=await readInitialMedia(f.response,Date.now()+1000);assert.equal((await r.arrayBuffer()).byteLength,4);assert.deepEqual(f.modes,['byob','default']);assert.ok(f.views.every(n=>n===null));});
test('single first byte is returned without waiting for a full buffer',async()=>{const f=source([[7]]);const r=await readInitialMedia(f.response,Date.now()+1000),reader=r.body.getReader();assert.deepEqual([...((await reader.read()).value)],[7]);await reader.cancel();assert.equal(f.canceled,1);});
test('empty stream is rejected and canceled',async()=>{const f=source([]);await assert.rejects(readInitialMedia(f.response,Date.now()+1000),/media_empty/);assert.equal(f.canceled,1);});
test('read error is unchanged and cancels once',async()=>{const error=Error('synthetic'),f=source([],{readError:error});await assert.rejects(readInitialMedia(f.response,Date.now()+1000),e=>e===error);assert.equal(f.canceled,1);});
test('missing body remains media_empty',async()=>{await assert.rejects(readInitialMedia(new Response(null),Date.now()+1000),/media_empty/);});
test('silent body still times out and cancels',async()=>{let canceled=0;const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled++;}}));await assert.rejects(readInitialMedia(response,Date.now()+5),/live_startup_timeout/);assert.equal(canceled,1);});

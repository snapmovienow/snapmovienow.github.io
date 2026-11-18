import assert from 'node:assert/strict';
import {liveTsDocumentType} from '../src/live-ts-document.mjs';
import {readInitialMedia} from '../src/live-startup.mjs';

const encode=text=>new TextEncoder().encode(text);
function fragments(items,{finish=true,onCancel=()=>{}}={}){
 return new Response(new ReadableStream({
  start(controller){for(const item of items)controller.enqueue(item);if(finish)controller.close();},
  cancel:onCancel
 }));
}
assert.equal(liveTsDocumentType('TEXT/HTML; charset=UTF-8'),'html');
assert.equal(liveTsDocumentType('application/problem+json'),'json');
assert.equal(liveTsDocumentType('application/octet-stream'),null);
assert.equal(liveTsDocumentType('video/mp2t'),null);
const deadline=()=>Date.now()+2000;
for(const [type,parts] of [
 ['html',['\uFEFF \n<','!doc','TYPE html','><title>wait</title>']],
 ['html',['<h','ead','>']],
 ['json',['  {','"error":','"unavailable"}']],
 ['json',['[', '{"error":true}', ']']]
]){
 await assert.rejects(readInitialMedia(fragments(parts.map(encode)),deadline(),type),/invalid_live_media/);
}
for(const type of ['html','json']){
 const parts=[new Uint8Array([71,16,128,16]),new Uint8Array([0,255,33])];
 const response=await readInitialMedia(fragments(parts),deadline(),type);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([71,16,128,16,0,255,33]));
}
for(const [type,parts] of [['html',['<ht','t','payload']],['json',['{','binary']]]){
 const response=await readInitialMedia(fragments(parts.map(encode)),deadline(),type);
 assert.equal(await response.text(),parts.join(''),'all inspected chunks retained in order');
}
const excessive=' '.repeat(1024)+'<html>';
assert.equal(await (await readInitialMedia(fragments([encode(excessive)]),deadline(),'html')).text(),excessive);
const many=Array(16).fill(' ').concat('<html>');
assert.equal(await(await readInitialMedia(fragments(many.map(encode)),deadline(),'html')).text(),many.join(''));
let cancelled=false;
const pending=fragments([encode('<ht')],{finish:false,onCancel:()=>{cancelled=true;}});
await assert.rejects(readInitialMedia(pending,Date.now()+30,'html'),/live_startup_timeout/);
assert.equal(cancelled,true);
console.log('PASS: bounded TS document identification requires content evidence and preserves unconfirmed bytes and the existing startup deadline.');

import assert from 'node:assert/strict';
import test from 'node:test';
import {chooseLqsaSeries,inspectLqsaMedia,runLqsaImport,lqsaImportStatus,LQSA_IMPORT} from '../src/lqsa-import.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(row=>row.id),updatedAt:1}],...rows.map(row=>['exclusive:item:'+row.id,structuredClone(row)])]);this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}async put(key,value){this.data.set(key,structuredClone(value));}
 transaction(fn){const result=this.queue.then(async()=>{const before=structuredClone(this.data);try{return await fn(this);}catch(error){this.data=before;throw error;}});this.queue=result.catch(()=>{});return result;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'};
const target={_server:'ccf',series_id:840,name:'La que se avecina',cover:'https://cdn.provider.net/poster.jpg'};
const details={info:{name:target.name,plot:'Original provider plot',year:'2007',cover:target.cover,category_id:'17'},episodes:{'1':[{id:'7',episode_num:1}],17:[{id:'8',episode_num:1},{id:'9',episode_num:4}]}};
const catalog=async action=>structuredClone(action==='get_series'?[target]:details);
const leases={in(){return {async removeMatching(){}}}};
const good=async()=>({ok:true,rangeSupported:true,ftyp:true});
async function save(store,path,{item,revision}){
 assert.equal(path,'/exclusive-save');const old=await store.get('exclusive:item:'+item.id);
 if((old?.revision||0)!==revision)return Response.json({error:'exclusive_changed'},{status:409});
 const row={...structuredClone(item),revision:revision+1,playbackRevision:(old?.playbackRevision||0)+1,createdAt:old?.createdAt||1000};
 const index=await store.get('exclusive:index');if(!old)index.ids.push(item.id);index.revision++;
 await store.put('exclusive:index',index);await store.put('exclusive:item:'+item.id,row);return Response.json({item:row});
}
const options={catalog,probe:good,save};

test('target selection requires an exact title and an unambiguous stable identity',()=>{
 assert.equal(chooseLqsaSeries([{...target,name:'Lá que se avecina'}]).series_id,840);
 assert.equal(chooseLqsaSeries([target,{...target}]).series_id,840);
 assert.equal(chooseLqsaSeries([{...target,_server:'other'},target])._server,'ccf');
 for(const rows of [[],[{...target,name:'La que se avecina extra'}]])assert.throws(()=>chooseLqsaSeries(rows),error=>error.importCode==='series_not_found');
 assert.throws(()=>chooseLqsaSeries([target,{...target,series_id:841}]),error=>error.importCode==='ambiguous_series');
 assert.throws(()=>chooseLqsaSeries([{...target,_server:'one'},{...target,_server:'two'}]),error=>error.importCode==='ambiguous_series');
 assert.throws(()=>chooseLqsaSeries([{...target,series_id:'not-a-number'}]),error=>error.importCode==='series_identity_invalid');
});

test('successful import binds one backing row and leaves all provider data untouched',async()=>{
 const store=new Store(),original=structuredClone(details),calls=[];
 await runLqsaImport(store,leases,env,{...options,catalog:async(...args)=>{calls.push(args);return catalog(...args);}});
 const row=await store.get('exclusive:item:'+LQSA_IMPORT.id),status=await lqsaImportStatus(store);
 assert.equal(status.state,'completed');assert.deepEqual(row.supplement,{server:'ccf',seriesId:'840'});
 assert.equal(row.type,'series');assert.equal(row.mode,'direct');assert.equal(row.source,'JONILAR');
 assert.deepEqual(row.episodes.map(episode=>[episode.id,episode.season,episode.episode_num]),[['lqsa-t17-e1',17,1],['lqsa-t17-e2',17,2],['lqsa-t17-e3',17,3]]);
 assert.deepEqual(details,original,'even existing T17E1 and E4 metadata are never mutated by the import');
 assert.deepEqual(calls.map(args=>[args[0],args[1],args[2]]),[['get_series',undefined,{}],['get_series_info','ccf',{series_id:'840'}]]);
 assert.ok(!JSON.stringify(status).includes('https://'));assert.equal(status.results.length,3);
});

test('a completed job is idempotent and cannot undo later owner edits',async()=>{
 const store=new Store();let probes=0;
 await runLqsaImport(store,leases,env,{...options,probe:async()=>{probes++;return good();}});
 const row=await store.get('exclusive:item:'+LQSA_IMPORT.id);await store.put('exclusive:item:'+row.id,{...row,visible:false});
 await runLqsaImport(store,leases,env,{...options,probe:async()=>{throw Error('must not probe');}});
 assert.equal(probes,3);assert.equal((await store.get('exclusive:item:'+row.id)).visible,false);
});

test('all three sources require explicit range and MP4-byte evidence before any save',async()=>{
 const store=new Store();let saves=0,clock=1000;
 for(let attempt=0;attempt<3;attempt++){
  await runLqsaImport(store,leases,env,{...options,now:()=>clock,probe:async media=>media.page.endsWith('1702.mp4')?{ok:true}:good(),save:async()=>{saves++;throw Error('no partial import');}});clock+=300000;
 }
 const status=await lqsaImportStatus(store);assert.equal(saves,0);assert.equal(status.state,'failed');assert.equal(status.attempts,3);assert.equal(status.reason,'source_unavailable');
 assert.equal(status.results[1].status,'unavailable');assert.equal(await store.get('exclusive:item:'+LQSA_IMPORT.id),undefined);
 await runLqsaImport(store,leases,env,{...options,probe:async()=>{throw Error('retry budget exhausted');}});
});

test('ambiguous and invalid target identities never probe or save',async()=>{
 for(const rows of [[target,{...target,series_id:841}],[{...target,series_id:'https://attacker.net'}]]){
  const store=new Store();await runLqsaImport(store,leases,env,{...options,catalog:async()=>rows,probe:async()=>{throw Error('no probes');},save:async()=>{throw Error('no save');}});
  assert.equal((await lqsaImportStatus(store)).state,'failed');assert.equal(await store.get('exclusive:item:'+LQSA_IMPORT.id),undefined);
 }
});

test('catalog failures retry finitely and expose only a fixed reason',async()=>{
 const store=new Store();let clock=1000;
 for(let count=0;count<3;count++){await runLqsaImport(store,leases,env,{...options,now:()=>clock,catalog:async()=>{throw Error('https://private/username/password');}});clock+=300000;}
 const status=await lqsaImportStatus(store);assert.equal(status.state,'failed');assert.equal(status.attempts,3);assert.equal(status.reason,'catalog_unavailable');assert.ok(!JSON.stringify(status).includes('password'));
});

test('concurrent invocations hold one finite claim',async()=>{
 const store=new Store();let probes=0;const input={...options,probe:async()=>{probes++;return good();}};
 await Promise.all([runLqsaImport(store,leases,env,input),runLqsaImport(store,leases,env,input)]);
 assert.equal(probes,3);assert.equal((await lqsaImportStatus(store)).attempts,1);assert.equal((await lqsaImportStatus(store)).state,'completed');
});

test('a concurrent owner edit is preserved without publishing over it',async()=>{
 const store=new Store();let changed=false;
 await runLqsaImport(store,leases,env,{...options,probe:async()=>{if(!changed){changed=true;await store.transaction(async tx=>{await tx.put('exclusive:item:'+LQSA_IMPORT.id,{id:LQSA_IMPORT.id,name:'Owner edit',revision:5});await tx.put('exclusive:index',{revision:2,ids:[LQSA_IMPORT.id],updatedAt:2});});}return good();}});
 assert.equal((await lqsaImportStatus(store)).reason,'catalog_changed');assert.equal((await store.get('exclusive:item:'+LQSA_IMPORT.id)).name,'Owner edit');
});

test('missing persistence of the exact binding rolls back the entire save',async()=>{
 const store=new Store();await runLqsaImport(store,leases,env,{...options,save:async(tx,path,body)=>{const response=await save(tx,path,body),value=await response.json();delete value.item.supplement;await tx.put('exclusive:item:'+LQSA_IMPORT.id,value.item);return Response.json(value);}});
 assert.equal((await lqsaImportStatus(store)).reason,'catalog_save_failed');assert.equal(await store.get('exclusive:item:'+LQSA_IMPORT.id),undefined);assert.deepEqual((await store.get('exclusive:index')).ids,[]);
});

test('production and maintenance gates are required before claiming or reading catalogs',async()=>{
 const store=new Store();for(const settings of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'}])await runLqsaImport(store,leases,settings,{...options,catalog:async()=>{throw Error('should not read');}});
 await runLqsaImport(store,leases,env,{probe:good,save});assert.equal((await lqsaImportStatus(store)).state,'pending');
});

function mp4Response({status=206,type='video/mp4',range='bytes 0-31/100000',ftyp=true}={}){
 const bytes=new Uint8Array(32);bytes.set([0,0,0,32]);bytes.set(new TextEncoder().encode(ftyp?'ftyp':'html'),4);return new Response(bytes,{status,headers:{'content-type':type,...(range?{'content-range':range}:{})}});
}
const media={page:'https://ia600409.us.archive.org/23/items/1701_20261115/1701.mp4'};
test('the native verifier reads only the fixed ranged media source and verifies ftyp',async()=>{
 let calls=0;const result=await inspectLqsaMedia(media,{fetcher:async(url,init)=>{calls++;assert.equal(url,media.page);assert.equal(init.redirect,'manual');assert.deepEqual(init.headers,{Accept:'video/mp4, application/octet-stream',Range:'bytes=0-65535'});return mp4Response();}});
 assert.deepEqual(result,{ok:true,rangeSupported:true,ftyp:true,check:'range_and_mp4_bytes'});assert.equal(calls,1);
 let denied=0;assert.equal((await inspectLqsaMedia({page:'https://attacker.net/1701.mp4'},{fetcher:async()=>{denied++;}})).ok,false);assert.equal(denied,0);
});

test('HTML, ignored ranges, malformed ranges, empty or wrong bytes fail closed',async()=>{
 for(const value of [{type:'text/html'},{status:200,range:''},{range:'bytes 1-32/100000'},{range:'bytes 0-65536/100000'},{range:'bytes 0-31/31'},{range:'bytes 0-25/100000'},{ftyp:false}])assert.equal((await inspectLqsaMedia(media,{fetcher:async()=>mp4Response(value)})).ok,false);
});

test('the verifier never forwards identity or follows a new redirect destination',async()=>{
 let calls=0;const result=await inspectLqsaMedia(media,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://attacker.net/video.mp4?secret=hidden'}});}});
 assert.equal(result.ok,false);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('attacker'));
});

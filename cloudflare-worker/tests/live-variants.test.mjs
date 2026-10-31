import assert from 'node:assert/strict';
import {liveChannelIdentity,liveVariantCandidates,createLiveVariantFallback} from '../src/live-variants.mjs';
import {prepareWebPlayback} from '../src/web-playback.mjs';
const row=(stream_id,name,category_id='1',_server='ccf',extra={})=>({stream_id,name,category_id,_server,...extra});
const categories=[{category_id:'1',category_name:'Peru',_server:'ccf'},{category_id:'2',category_name:'Other',_server:'ccf'},{category_id:'3',category_name:'Adultos',_server:'ccf'}];
const rows=[row(10,'PER-ATV (M)(720)'),row(11,'PER-ATV (L)(720)'),row(12,'PER-ATV (TV)(SD)'),row(13,'PER-ATV+ (L)(720)'),row(14,'PER-ATV 2 (L)(720)'),row(15,'PER-ATV (L)(720)','2'),row(16,'PER-ATV (L)(720)','1','foreign'),row(17,'PER-ATV (L)(720)','1','ccf',{is_adult:1})];
const item={type:'live',server:'ccf',upstreamId:'10',ext:'ts'};
assert.equal(liveChannelIdentity('PER-ATV (M)(720)'),liveChannelIdentity('PER-ATV (L)(1080)'));
for(const other of ['PER-ATV+ (L)(720)','PER-ATV 2 (L)(720)','US-ATV (L)(720)','PER-ATV MAX (L)(720)'])assert.notEqual(liveChannelIdentity(other),liveChannelIdentity(rows[0].name));
assert.equal(liveChannelIdentity('https://secret.invalid'),null);
assert.deepEqual(liveVariantCandidates(rows,categories,item,{adults:false}).map(x=>x.upstreamId),['11','12']);
assert.deepEqual(liveVariantCandidates(rows,categories,item,{tv:false}),[]);
assert.deepEqual(liveVariantCandidates(rows,[],item),[]);
assert.deepEqual(liveVariantCandidates([...rows,rows[0]],categories,item),[],'ambiguous original identities cannot select an alternative');
assert.deepEqual(liveVariantCandidates(rows.map(x=>({...x,category_id:'3'})),categories,item,{adults:false}),[],'category restrictions survive variant selection');
assert.equal(liveVariantCandidates(Array.from({length:30},(_,i)=>row(i+10,'PER-ATV (L)(720)')),categories,item).length,8);
let reads=0;const cached=async(action,server,params,options)=>{reads++;assert.equal(server,'ccf');assert.equal(options.cachedOnly,true);return action==='get_live_streams'?rows:categories};
const next=createLiveVariantFallback(cached,item,{adults:false});
for(const status of [200,401,403,410,416,502,undefined])assert.equal(await next(status),null);
assert.equal(reads,0,'success, access errors and unconfirmed transport errors perform no catalog lookup');
assert.equal((await next(404)).upstreamId,'11');assert.equal((await next(404)).upstreamId,'12');assert.equal(await next(404),null);assert.equal(reads,2);
assert.equal(await createLiveVariantFallback(async()=>{throw Error('unavailable')},item,{})(404),null);

// Web preparation keeps one request, releases the failed reservation first,
// signs the alternative ID and uses only the existing shared three attempts.
for(const canary of [false,true]){
 const events=[],tickets=[],mediaKeys=[],pending=[];let allocations=0,active=0,lookups=0;
 const session={managed:true,sid:'viewer',username:'fixture',exp:Date.now()+60000,permissions:{tv:true,adults:true},...(canary?{canary:true}:{} )};
 const deps={json:(v,status=200)=>Response.json(v,{status}),cleanExt:x=>x,origin:'http://ccf.center:8444',permissions:{tv:true,adults:false},
  catalog:async(...args)=>{lookups++;return cached(...args)},
  directory:async(env,path,b)=>{events.push({path,...b});if(path==='/release')active--;return Response.json({ok:true})},
  managedPlayback:async(env,s,server,ctx,excluded,startup)=>{assert.equal(active,0);assert.ok(startup.claim());active++;allocations++;mediaKeys.push(s.mediaKey);if(allocations===2&&!canary)assert.deepEqual(excluded,[]);return {r:Response.json({lease_id:'lease'+allocations}),provider_id:'provider'+allocations,credentials:{username:'source',password:'synthetic'}}},
  ticket:async(env,d)=>{tickets.push(d);return String(d.id)},
  serverStream:async(req,env,url)=>new Response(url.searchParams.get('t')==='11'?'#EXTM3U\n#fixture':'missing',{status:url.searchParams.get('t')==='11'?200:404})
 };
 const response=await prepareWebPlayback({type:'live',server:'ccf',id:'10',ext:'m3u8',request_id:'one-request'},session,'https://gateway.invalid',{}, {waitUntil:p=>pending.push(p)},deps);
 await Promise.all(pending);
 assert.equal(response.status,canary?502:200);assert.equal(allocations,canary?3:2);assert.equal(lookups,canary?0:2);
 assert.equal(events.filter(x=>x.path==='/playback-begin').length,1);assert.equal(events.filter(x=>x.path==='/release').length,canary?3:1);
 if(!canary){assert.deepEqual(tickets.map(x=>x.id),['10','11']);assert.deepEqual(mediaKeys,['live|ccf|10|m3u8','live|ccf|11|m3u8']);assert.equal(active,1);}
}
console.log('PASS: same-channel variants preserve category/server/adult identity, cached-only reads, exact media ownership, bounded retries and diagnostic isolation.');

import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {contentPermissions,markAdultRows,isAdult} from '../src/content-permissions.mjs';
class Store {
  constructor() {this.data = new Map(); this.queue = Promise.resolve()}
  async get(key) {
    if (Array.isArray(key)) return new Map(key.filter(k => this.data.has(k)).map(k => [k, structuredClone(this.data.get(k))]));
    return structuredClone(this.data.get(key));
  }
  async put(key, value) {
    if (typeof key === 'object') {assert.ok(Object.keys(key).length <= 128); for (const [k,v] of Object.entries(key)) this.data.set(k, structuredClone(v))}
    else this.data.set(key, structuredClone(value));
  }
  async delete(key) {this.data.delete(key)}
  async deleteAll() {this.data.clear()}
  async setAlarm() {}
  async list({prefix}) {return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).map(([k,v]) => [k, structuredClone(v)]))}
  transaction(fn) {const result = this.queue.then(() => fn(this)); this.queue = result.catch(() => {}); return result}
}

const objects=new Map(),env={TICKET_SECRET:'adult-test-secret-only',ADMIN_SETUP_SECRET:'adult-setup-test-only-12345678901234567890'};
env.PLAYBACK_SESSIONS={idFromName:name=>name,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const origin='https://edge.example.test',providers=['http://ccf.center:8444','https://second.example.test'];
let mediaRequests=0;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),provider=providers.indexOf(u.origin);assert.ok(provider>=0);
 if(u.pathname==='/player_api.php'){
  const action=u.searchParams.get('action');if(!action)return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
  if(action.endsWith('_categories'))return Response.json([{category_id:'7',category_name:'Familia',parent_id:0},{category_id:'9',category_name:provider===0?'ADULTOS XXX':'Deportes',parent_id:0},{category_id:'10',category_name:'Subcarpeta',parent_id:9}]);
  if(action==='get_live_streams')return Response.json([{stream_id:101,name:'Familia',category_id:'7'},{stream_id:102,name:'Canal neutral',category_id:'9'},{stream_id:103,name:'Canal marcado',category_id:'7',is_adult:'1'},{stream_id:104,name:'Canal anidado',category_id:'10'}]);
  if(action==='get_vod_streams')return Response.json([{stream_id:201,name:'Película familiar',category_id:'7',container_extension:'mp4'},{stream_id:202,name:'Película neutral',category_id:'9',container_extension:'mp4'}]);
  if(action==='get_series')return Response.json([{series_id:301,name:'Serie familiar',category_id:'7'},{series_id:302,name:'Serie neutral',category_id:'9'}]);
  if(action==='get_series_info'){
   const id=u.searchParams.get('series_id');return Response.json({info:{name:'Serie neutral'},seasons:[{season_number:1},{season_number:2}],episodes:{1:[{id:id==='302'?'502':'501',title:'Episodio neutral',container_extension:'mp4'}],2:[{id:'503',title:'XXX',container_extension:'mp4'}]}});
  }
  if(action==='get_vod_info')return Response.json({info:{name:'Película neutral'},movie_data:{stream_id:Number(u.searchParams.get('vod_id')),category_id:'9'}});
  if(action==='get_short_epg')return Response.json({epg_listings:[{title:'Programación'}]});
  throw Error('unexpected action '+action);
 }
 mediaRequests++;
 if(u.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:4,\n/segment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 return new Response('data',{headers:{'content-type':'video/mp4','content-length':'4','accept-ranges':'bytes'}});
};
const post=async(body,path='')=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(body)}),env);return{status:r.status,data:await r.json()}};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'admin-password-test'},'/admin');
const adminToken=(await post({action:'login',username:'owner',password:'admin-password-test'},'/admin')).data.access_token;
const admin=(action,body={})=>post({action,access_token:adminToken,...body},'/admin');
for(let i=0;i<providers.length;i++)assert.equal((await admin('provider-save',{mode:'single',url:providers[i],username:'upstream-'+i,password:'provider-password-test-'+i})).status,200);
const customer={username:'family-user',password:'customer-password-test'};
const save=body=>admin('save',{...customer,status:'active',...body});
assert.equal((await save({create:true})).status,200);
assert.equal((await admin('users')).data[0].permissions.adults,true,'legacy/default access is preserved');
const native=(action='',params={})=>worker.fetch(new Request(origin+'/player_api.php?'+new URLSearchParams({...customer,action,...params})),env);
const play=(kind,id)=>worker.fetch(new Request(`${origin}/${kind}/${customer.username}/${customer.password}/${id}.${kind==='live'?'m3u8':'mp4'}`),env);
let session=(await post({op:'auth',...customer})).data.access_token;
const web=(op,body={})=>post({op,access_token:session,...body});
const oldLive=await(await native('get_live_streams')).json(),oldMovies=await(await native('get_vod_streams')).json(),oldSeries=await(await native('get_series')).json();
const adultLive=oldLive.find(x=>x.name==='Canal neutral'),adultMovie=oldMovies.find(x=>x.name==='Película neutral'),adultSeries=oldSeries.find(x=>x.name==='Serie neutral');
const oldEpisodes=await(await native('get_series_info',{series_id:adultSeries.series_id})).json(),adultEpisode=oldEpisodes.episodes[1][0].id;
const oldWebLive=(await web('live')).data,adultWebLive=oldWebLive.find(x=>x.stream_id===102);
const before=(await web('stream_token',{type:'live',server:adultWebLive._server,id:102,ext:'m3u8',request_id:crypto.randomUUID(),revision:1}));assert.equal(before.status,200);
assert.equal((await save({create:false,permissions:{movies:true,series:true,tv:true,adults:false}})).status,200);
assert.equal((await web('live')).status,401,'changing the permission revokes existing sessions');
const oldStream=await worker.fetch(new Request(before.data.url),env);assert.ok([401,403,410].includes(oldStream.status),'previous media tickets stop working');
session=(await post({op:'auth',...customer})).data.access_token;
for(const [action,op]of [['get_live_categories','live_categories'],['get_vod_categories','vod_categories'],['get_series_categories','series_categories']]){
 const a=await(await native(action)).json(),b=(await web(op)).data;
 assert.equal(a.length,4);assert.equal(b.length,4);assert.ok(!a.some(x=>x.category_name==='ADULTOS XXX'));
}
const live=await(await native('get_live_streams')).json();assert.equal(live.length,4);assert.ok(!live.some(x=>x.name==='Canal marcado'));
assert.equal((await web('live')).data.length,4);assert.equal((await web('vod')).data.length,3);assert.equal((await web('series')).data.length,3);
const secondNeutral=live.find(x=>x.name==='Canal neutral');assert.notEqual(secondNeutral.stream_id,adultLive.stream_id,'equal provider IDs are isolated');
for(const [kind,id]of [['live',adultLive.stream_id],['movie',adultMovie.stream_id],['series',adultEpisode]])assert.equal((await play(kind,id)).status,403,'direct adult playback denied');
assert.equal((await native('get_vod_info',{vod_id:adultMovie.stream_id})).status,403);
assert.equal((await native('get_series_info',{series_id:adultSeries.series_id})).status,403);
assert.deepEqual((await(await native('get_short_epg',{stream_id:adultLive.stream_id})).json()).epg_listings,[]);
const mediaBefore=mediaRequests;
for(const [type,id,extra]of [['live',102,{}],['movie',202,{}],['series',502,{series_id:302}],['series',501,{series_id:302}],['series',502,{}]]){
 const result=await web('stream_token',{type,id,server:adultWebLive._server,ext:'mp4',...extra,request_id:crypto.randomUUID(),revision:2});assert.equal(result.status,403);
}
assert.equal(mediaRequests,mediaBefore,'denied requests do not contact or reserve playback');
assert.equal((await web('vod_info',{vod_id:202,server:adultWebLive._server})).status,403);
assert.equal((await web('series_info',{series_id:302,server:adultWebLive._server})).status,403);
const familySeries=oldSeries.find(x=>x.name==='Serie familiar');
const details=await(await native('get_series_info',{series_id:familySeries.series_id})).json();assert.deepEqual(Object.keys(details.episodes),['1']);assert.equal(details.seasons.length,1);
const webDetails=await web('series_info',{series_id:301,server:adultWebLive._server});assert.equal(webDetails.status,200);assert.deepEqual(Object.keys(webDetails.data.episodes),['1']);
const legacyEpisode=await web('stream_token',{type:'series',id:501,server:adultWebLive._server,ext:'mp4',request_id:crypto.randomUUID(),revision:3});assert.equal(legacyEpisode.status,200,'existing web/API app clients can play allowed episodes without a new parent parameter');
const episodeResponse=await play('series',details.episodes[1][0].id);assert.equal(episodeResponse.status,200);await episodeResponse.body.cancel();
const good=await play('live',secondNeutral.stream_id);assert.equal(good.status,200);await good.body.cancel();
assert.equal((await save({create:false,name:'Renamed',permissions:{movies:true,series:true,tv:true}})).status,200);
assert.equal((await admin('users')).data[0].permissions.adults,false,'older clients omitting the new permission cannot enable it');
assert.equal((await save({create:false,permissions:{movies:true,series:true,tv:true,adults:true}})).status,200);
assert.equal((await(await native('get_live_streams')).json()).length,8,'re-enabling restores content and stable IDs');
assert.deepEqual(contentPermissions({movies:false}),{movies:false,series:true,tv:true,adults:true});
assert.equal(isAdult({name:'Adultos +18'}),true);assert.equal(isAdult({name:'Toy Story'}),false);
const marked=markAdultRows([{category_id:'3',_server:'a',name:'Neutral'},{category_id:'3',_server:'b',name:'Neutral'}],[{category_id:'2',_server:'a',category_name:'XXX'},{category_id:'3',_server:'a',category_name:'Child',parent_id:2}]);assert.deepEqual(marked.map(x=>x._adult),[true,false]);
console.log('PASS: adult permissions, legacy preservation, web/native lists and nested categories, provider isolation, direct media/details/EPG, episode parent enforcement, session and ticket revocation, and restoration.');

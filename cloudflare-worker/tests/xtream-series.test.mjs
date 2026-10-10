import assert from 'node:assert/strict';
import {handleXtream} from '../src/xtream.mjs';
import {publicMetadata} from '../src/provider-catalog.mjs';

// Exercise the public API contract with isolated accounts/providers. A client
// that renders seasons before episodes must not receive a blank season list
// when playable episodes exist. No Smarters binary or real customer is used.
const origin = 'https://api.example.test';
const credentials = {origin:'https://provider.example.test',username:'private-provider',password:'private-provider-password'};
const user = {username:'customer',permissions:{series:true,adults:true}};
const records = new Map([['20',{kind:'series_list',server:'test',upstreamId:'220'}]]), keys = new Map();
let next = 100, data, plays = [];
const deps = {
  authenticate:async () => ({user,username:user.username,session:{sid:'test-session'}}),
  catalog:async (action,server,params) => {
    assert.equal(action,'get_series_info');assert.equal(server,'test');assert.equal(params.series_id,'220');
    return publicMetadata(data,credentials);
  },
  register:async entries => entries.map(record => {
    const key = [record.kind,record.server,record.upstreamId].join(':');
    if (!keys.has(key)) keys.set(key,next++);
    const id = keys.get(key); records.set(String(id),{...record,id});return id;
  }),
  resolve:async id => records.get(String(id)),
  adultPolicy:{allowed:async () => true},
  play:async (req,session,record) => {plays.push(record);return new Response('episode',{status:req.headers.has('range')?206:200})},
  json:(body,status=200) => Response.json(body,{status})
};
const request = (method='GET') => new Request(origin+'/player_api.php'+(method==='GET'?'?username=customer&password=customer-test-password&action=get_series_info&series_id=20':''),
  method==='GET'?{}:{method,body:new URLSearchParams({username:'customer',password:'customer-test-password',action:'get_series_info',series_id:'20'})});
const details = async method => {const response=await handleXtream(request(method),deps);assert.equal(response.status,200);return response.json()};
const assertContract = result => {
  assert.ok(Array.isArray(result.seasons));assert.equal(Array.isArray(result.episodes),false);
  assert.deepEqual(result.seasons.map(s=>String(s.season_number)),Object.keys(result.episodes));
  for (const season of result.seasons) {
    assert.ok(Number.isInteger(season.season_number));assert.ok(Number.isInteger(season.id));
    assert.ok(season.name.length);assert.equal(season.episode_count,result.episodes[season.season_number].length);
    for (const ep of result.episodes[season.season_number]) {
      assert.equal(ep.season,season.season_number);assert.ok(Number.isInteger(ep.episode_num)&&ep.episode_num>0);
      assert.ok(ep.title.length);assert.equal(typeof ep.info,'object');assert.ok(ep.info&&!Array.isArray(ep.info));
      assert.match(ep.id,/^\d+$/);assert.equal(new URL(ep.direct_source).origin,origin);
    }
  }
  for (const secret of Object.values(credentials)) assert.equal(JSON.stringify(result).includes(secret),false);
};

// Missing season metadata and explicit episode season: the old API returns []
// for seasons, although SNAP's tolerant parser can play these episodes.
data = {info:{name:'Test series',cover:'https://images.example.test/series.jpg'},seasons:[],episodes:{'1':[
  {id:'880',title:'First episode',container_extension:'mkv',info:{plot:'Story'},direct_source:credentials.origin+'/series/private-provider/private-provider-password/880.mkv'}
]}};
let result = await details();
assert.equal(result.seasons.length,1,'playable episodes must have a selectable season');
assertContract(result);
const firstId = result.episodes['1'][0].id;
assert.deepEqual(result.episodes['1'][0].smn_profile,{type:'series',id:'220',server:'test',episodeId:'880'});
const played = await handleXtream(new Request(result.episodes['1'][0].direct_source,{headers:{range:'bytes=0-6'}}),deps);
assert.equal(played.status,206);assert.equal(plays.at(-1).upstreamId,'880');assert.equal(plays.at(-1).parentId,'220');assert.equal(plays.at(-1).ext,'mkv');

// Sparse/out-of-order seasons, specials, inconsistent numeric strings, and a
// stale metadata-only season. Episode identity must survive normalisation.
data = {info:{name:'Test series'},seasons:[
  {season_number:'02',id:'987',name:'Second season',episode_count:99,overview:'Keep this description'},
  {season_number:7,id:7,name:'Empty season'},null
],episodes:{'10':[{id:900,season:2,episode_num:'3',title:'Ten three',container_extension:'mp4',info:[]}],
  '02':[{id:882,episode_num:'2',title:'Two two',container_extension:'mkv'},null,{id:881,episode_num:1,title:'Two one',container_extension:'mkv'}],
  '1':[{id:880,episode_num:1,title:'First episode',container_extension:'mkv'}],
  '0':[{id:879,episode_num:1,title:'Special',container_extension:'mp4'}],
  '7':[], '9':[{id:'not-an-id',title:'Invalid'}]}};
result = await details('POST');assertContract(result);
assert.deepEqual(result.seasons.map(s=>s.season_number),[0,1,2,10]);
assert.equal(result.seasons[2].id,987);assert.equal(result.seasons[2].name,'Second season');
assert.equal(result.seasons[2].overview,'Keep this description');assert.equal(result.seasons[2].episode_count,2);
assert.equal(result.episodes['1'][0].id,firstId);assert.deepEqual(result.episodes['2'].map(e=>e.episode_num),[1,2]);
assert.equal(result.episodes['10'][0].season,10,'group key determines season membership');

// PHP can encode contiguous numeric season keys as arrays; always expose an
// object with canonical numeric keys to JSON clients.
data = {info:{name:'Array seasons'},seasons:{'1':{season_number:'1',id:'600',name:'First season'}},episodes:[
  [{id:950,title:'Special',episode_num:1,container_extension:'mp4'}],
  [{id:951,title:'One',episode_num:1,container_extension:'mp4'}]
]};
result=await details();assertContract(result);assert.deepEqual(Object.keys(result.episodes),['0','1']);
assert.equal(result.seasons[1].id,600);

// Permission filtering happens before constructing season metadata/counts.
user.permissions.adults=false;
data={info:{name:'Family series'},seasons:[{season_number:1,episode_count:5},{season_number:2,name:'Adult season'}],episodes:{
  '1':[{id:960,title:'Family episode',episode_num:1,container_extension:'mp4'},{id:961,title:'XXX',episode_num:2}],
  '2':[{id:962,title:'XXX',episode_num:1}]
}};
result=await details();assertContract(result);assert.deepEqual(Object.keys(result.episodes),['1']);assert.equal(result.seasons[0].episode_count,1);
assert.equal(JSON.stringify(result).includes('Adult season'),false);assert.equal(JSON.stringify(result).includes('XXX'),false);
user.permissions.series=false;
assert.equal((await handleXtream(request(),deps)).status,403);user.permissions.series=true;
deps.adultPolicy.allowed=async()=>false;
assert.equal((await handleXtream(request(),deps)).status,403);
assert.equal((await handleXtream(new Request(origin+'/series/customer/customer-test-password/'+firstId+'.mkv'),deps)).status,403);
deps.adultPolicy.allowed=async()=>true;user.permissions.adults=true;

// A series that really has no episodes stays empty. Do not invent content.
data={info:{name:'No episodes'},seasons:[{season_number:1}],episodes:{}};
result=await details();assertContract(result);assert.deepEqual(result.seasons,[]);assert.deepEqual(result.episodes,{});
console.log('PASS: Xtream series contract, selectable seasons, mapped playback, metadata, ordering and permissions.');

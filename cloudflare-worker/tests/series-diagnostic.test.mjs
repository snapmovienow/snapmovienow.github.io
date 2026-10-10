import assert from 'node:assert/strict';
import {diagnoseSeries} from '../src/series-diagnostic.mjs';
import {createAdultPolicy} from '../src/content-permissions.mjs';
const user={username:'customer',status:'active',permissions:{series:true,adults:true}};
const records=new Map();let next=20, calls=0, fresh=0;
let series={info:{name:'El Halcón (test)'},episodes:{'1':[{id:880,episode_num:1,title:'One'}]},seasons:[]};
const deps={users:[user],json:(body,status=200)=>Response.json(body,{status}),
  catalog:async(action,server,params,options)=>{calls++;if(options?.fresh)fresh++;if(action==='get_series')return[{name:'El Halcón (test)',series_id:220,_server:'private-server'}];if(action==='get_series_categories')return[];if(action==='get_series_info')return series;throw Error(action)},
  register:async entries=>entries.map(entry=>{const id=next++;records.set(String(id),entry);return id}),
  resolve:async id=>records.get(String(id))};
const run=(input={query:'El Halcon',username:'customer'})=>diagnoseSeries(deps,input,'https://gateway.example.test');
let response=await run(),result=await response.json();
assert.equal(response.status,200);assert.equal(result.results[0].state,'ready');assert.equal(result.results[0].episodes,1);assert.deepEqual(result.results[0].seasons,[{number:1,episodes:1}]);assert.ok(fresh);
assert.equal(JSON.stringify(result).includes('diagnostic-only'),false);assert.equal(JSON.stringify(result).includes('private-server'),false);assert.equal(JSON.stringify(result).includes('/series/'),false);
assert.equal((await run({query:'a',username:'customer'})).status,400);
assert.equal((await run({query:'Test',username:'unknown'})).status,404);
user.status='suspended';calls=0;assert.equal((await run()).status,403);assert.equal(calls,0);user.status='active';
user.permissions.series=false;assert.equal((await run()).status,403);user.permissions.series=true;
series={info:{name:'Family series'},episodes:[{id:880,title:'Family',season:1},{id:881,title:'XXX',season:1}]};
const policy=createAdultPolicy(deps.catalog);
assert.equal(await policy.allowed({kind:'episode',server:'private-server',upstreamId:'880',parentId:'220'}),true,'flat family episodes retain the parent and adult checks');
assert.equal(await policy.allowed({kind:'episode',server:'private-server',upstreamId:'881',parentId:'220'}),false);
assert.equal(await policy.allowed({kind:'episode',server:'private-server',upstreamId:'880'}),false);
user.permissions.adults=false;series={info:{name:'XXX'},seasons:[],episodes:{'1':[{id:880,title:'Adult'}]}};
result=await (await run()).json();assert.equal(result.results[0].httpStatus,403);assert.equal(result.results[0].episodes,0);
user.permissions.adults=true;deps.catalog=async action=>{if(action==='get_series')return[{name:'El Halcón',series_id:220,_server:'private-server'}];throw Error('https://secret-provider/password')};
result=await (await run()).json();assert.equal(result.results[0].state,'upstream_unavailable');assert.equal(JSON.stringify(result).includes('secret-provider'),false);
console.log('PASS: authenticated series diagnostic formatter, accent matching, freshness, permissions, status and no credential/playback disclosure.');

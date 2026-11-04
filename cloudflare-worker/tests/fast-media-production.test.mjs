import {test} from 'node:test';
import assert from 'node:assert/strict';

// Real default.fetch + authentication + public registry + PlaybackSession.
// Every network response and credential below belongs to this local fixture.
class Store {
  constructor(){this.data=new Map();this.queue=Promise.resolve()}
  async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])):structuredClone(this.data.get(key))}
  async put(key,value){if(typeof key==='object')for(const [k,v] of Object.entries(key))this.data.set(k,structuredClone(v));else this.data.set(key,structuredClone(value))}
  async delete(key){this.data.delete(key)}
  async deleteAll(){this.data.clear()}
  async setAlarm(){}
  async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]))}
  transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result}
}
const origin='https://snapmovienow-edge.juancanta89.workers.dev';
const provider='https://fast-media-provider.example.test';
const customer={username:'PRIVATE-LOCAL-VIEWER',password:'PRIVATE-LOCAL-PASSWORD'};
const upstream={username:'PRIVATE-UPSTREAM-USER',password:'PRIVATE-UPSTREAM-PASSWORD'};
const privateValues=[provider,...Object.values(customer),...Object.values(upstream),'PRIVATE-COOKIE','PRIVATE-IF-RANGE','PRIVATE-PROVIDER-BODY','PRIVATE-PROVIDER-HEADER','FORGED-REQUEST-ID','PRIVATE-QUERY'];

async function fixture(module,{environment='production',enabled='true'}={}){
  const objects=new Map(),calls=[],cancelled=[];
  const env={ENVIRONMENT:environment,FAST_MEDIA_FAILURE_LOGS_ENABLED:enabled,TICKET_SECRET:'fast-media-local-ticket-secret-only',ADMIN_SETUP_SECRET:'fast-media-local-setup-secret-12345678901234567890'};
  env.PLAYBACK_SESSIONS={idFromName:name=>name,get(id){if(!objects.has(id))objects.set(id,new module.PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
  let status=416;
  const providerFetch=async (input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    assert.equal(url.origin,provider,'no real provider or additional network call is permitted');
    const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
    calls.push({path:url.pathname,action:url.searchParams.get('action'),range:headers.get('range'),ifRange:headers.get('if-range')});
    if(url.pathname==='/player_api.php'){
      assert.equal(url.searchParams.get('username'),upstream.username);assert.equal(url.searchParams.get('password'),upstream.password);
      const action=url.searchParams.get('action');
      if(!action)return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
      if(action.endsWith('_categories'))return Response.json([{category_id:'7',category_name:'Local fixture',parent_id:0}]);
      if(action==='get_live_streams')return Response.json([{stream_id:9551,name:'Fixture live',category_id:'7'}]);
      if(action==='get_vod_streams')return Response.json([{stream_id:9552,name:'Fixture movie',category_id:'7',container_extension:'mp4'}]);
      if(action==='get_series')return Response.json([{series_id:9553,name:'Fixture series',category_id:'7'}]);
      if(action==='get_series_info')return Response.json({info:{name:'Fixture series',category_id:'7'},seasons:[],episodes:{'1':[{id:'9554',season:1,episode_num:1,title:'Fixture episode',container_extension:'mkv'}]}});
      throw Error('unexpected synthetic catalog action '+action);
    }
    assert.match(url.pathname,/^\/(live|movie|series)\/PRIVATE-UPSTREAM-USER\/PRIVATE-UPSTREAM-PASSWORD\/955[124]\./);
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('PRIVATE-PROVIDER-BODY'))},cancel(){cancelled.push(url.pathname)}}),{status,headers:{'content-range':'bytes */1000','accept-ranges':'bytes','x-provider-secret':'PRIVATE-PROVIDER-HEADER','set-cookie':'PRIVATE-COOKIE','etag':'PRIVATE-IF-RANGE'}});
  };
  const request=(path,options={})=>{globalThis.fetch=providerFetch;return module.default.fetch(new Request(origin+path,options),env)};
  const post=async body=>{const response=await request('/admin',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json()};
  await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'fixture-owner',password:'fixture-owner-password'});
  const login=await post({action:'login',username:'fixture-owner',password:'fixture-owner-password'});
  const admin=(action,body={})=>post({action,access_token:login.access_token,...body});
  await admin('provider-save',{mode:'single',url:provider,...upstream});
  await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000});
  const api=async action=>{const response=await request('/player_api.php?'+new URLSearchParams({...customer,action}));assert.equal(response.status,200);return response.json()};
  const live=(await api('get_live_streams'))[0].stream_id,movie=(await api('get_vod_streams'))[0].stream_id,series=(await api('get_series'))[0].series_id;
  const detailResponse=await request('/player_api.php?'+new URLSearchParams({...customer,action:'get_series_info',series_id:series}));assert.equal(detailResponse.status,200);const episode=(await detailResponse.json()).episodes['1'][0].id;
  const ids={live,movie,series:episode},extensions={live:'ts',movie:'mp4',series:'mkv'};
  return {request,env,calls,cancelled,ids,setStatus:value=>status=value,media:(kind='movie',extra={})=>{
    const {id=ids[kind],password=customer.password,headers={},...options}=extra;
    return request(`/${kind}/${customer.username}/${password}/${id}.${extensions[kind]}?t=PRIVATE-QUERY`,{...options,headers:{'CF-Connecting-IP':'198.51.100.222','User-Agent':'local-fixture','X-SMN-Request-ID':'FORGED-REQUEST-ID',cookie:'PRIVATE-COOKIE',...headers}});
  }};
}
const mediaCalls=f=>f.calls.filter(call=>/^\/(live|movie|series)\//.test(call.path));
const mediaEvents=logs=>logs.filter(log=>log?.media_failure);
function assertPrivate(logs){const text=JSON.stringify(logs);for(const value of privateValues)assert.ok(!text.includes(value),'diagnostics exclude '+value);assert.ok(!/https?:\/\//.test(text),'diagnostics contain no raw URLs')}
async function rejectRange(f,{kind='movie',method='GET'}={}){
  const before=mediaCalls(f).length,cancelled=f.cancelled.length;
  const response=await f.media(kind,{method,headers:{Range:'bytes=9999-','If-Range':'PRIVATE-IF-RANGE'}});
  assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */1000');assert.equal(response.headers.get('accept-ranges'),'bytes');
  for(const header of ['x-provider-secret','set-cookie','etag','location'])assert.equal(response.headers.get(header),null);
  assert.equal(mediaCalls(f).length,before+1,'diagnostics must not add an upstream request or retry 416');
  assert.equal(mediaCalls(f).at(-1).range,method==='HEAD'?'bytes=0-0':'bytes=9999-');
  assert.equal(f.cancelled.length,cancelled+1,'the rejected upstream body remains cancelled');
  const body=await response.text();if(method==='HEAD')assert.equal(body,'');else assert.deepEqual(JSON.parse(body),{error:'upstream_unavailable'});
  return response;
}

test('production fast-media diagnostics use the real Worker path and one isolate budget',async t=>{
  const originalFetch=globalThis.fetch,originalError=console.error,originalNow=Date.now,performanceDescriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
  let clock=0;const logs=[];console.error=value=>logs.push(value);Date.now=()=>1793750400000;
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
  const fresh=()=>import('../src/index.js?fast-media-fixture='+crypto.randomUUID());
  try{
    await t.test('explicit flag and production environment are both required',async()=>{
      for(const config of [{enabled:undefined},{enabled:'false'},{enabled:'TRUE'},{enabled:true},{environment:'staging',enabled:'true'}]){
        const module=await fresh(),f=await fixture(module,config);if(config.enabled===undefined)delete f.env.FAST_MEDIA_FAILURE_LOGS_ENABLED;
        logs.length=0;await rejectRange(f);f.setStatus(404);const response=await f.media('live');assert.equal(response.status,404);await response.text();assert.equal(mediaEvents(logs).length,0);assertPrivate(logs);
      }
    });
    await t.test('resolved fast 404 carries only public identity and the response request ID',async()=>{
      const f=await fixture(await fresh());f.setStatus(404);logs.length=0;
      const response=await f.media('live');assert.equal(response.status,404);await response.text();
      const events=mediaEvents(logs);assert.equal(events.length,1);const event=events[0];
      assert.equal(event.request_id,response.headers.get('X-SMN-Request-ID'));assert.notEqual(event.request_id,'FORGED-REQUEST-ID');assert.equal(event.route,'/live/*');assert.equal(event.status,404);assert.equal(event.event,'request_failed');assert.equal(event.diagnostic,'fast_media_failure');
      assert.deepEqual(event.media_failure,{type:'live',content_public_id:String(f.ids.live),phase:'unknown'});assert.notEqual(String(f.ids.live),'9551');assert.equal(event.elapsed_ms,0);assertPrivate(logs);
    });
    await t.test('one module budget covers requests and environments, rejects unresolved input, and resets after 60 seconds',async()=>{
      const module=await fresh(),f=await fixture(module);logs.length=0;
      for(const input of [{id:'not-numeric'},{id:'9007199254740991'},{password:'wrong-fixture-password'}]){const before=mediaCalls(f).length,response=await f.media('movie',input);assert.ok([400,401,403,404].includes(response.status));await response.text();assert.equal(mediaCalls(f).length,before)}
      assert.equal(mediaEvents(logs).length,0,'unresolved and unauthenticated requests cannot consume media quota');assertPrivate(logs);logs.length=0;
      const other=await fixture(module);logs.length=0; // A second environment still shares the same module/isolate budget.
      for(let index=0;index<11;index++){
        const active=index%2?other:f,kind=['movie','series','live'][index%3],method=index===1?'HEAD':'GET',response=await rejectRange(active,{kind,method});
        const events=mediaEvents(logs);assert.equal(events.length,Math.min(index+1,10),'ten extra events per isolate, never ten per request or environment');
        if(index<10){const event=events.at(-1);assert.equal(event.request_id,response.headers.get('X-SMN-Request-ID'));assert.equal(event.route,'/'+kind+'/*');assert.equal(event.method,method);assert.equal(event.elapsed_ms,0);assert.deepEqual(event.media_failure,{type:kind,content_public_id:String(active.ids[kind]),phase:'initial',rangeEvidence:{phase:'initial',method,incomingRange:{kind:'bytes',start:9999,end:null},outgoingRange:method==='HEAD'?{kind:'bytes',start:0,end:0}:{kind:'bytes',start:9999,end:null},reportedTotal:1000,ifRangePresent:true}})}
      }
      assertPrivate(logs);clock=59999;await rejectRange(f);assert.equal(mediaEvents(logs).length,10);clock=60000;await rejectRange(f);assert.equal(mediaEvents(logs).length,11);assertPrivate(logs);
    });
  }finally{globalThis.fetch=originalFetch;console.error=originalError;Date.now=originalNow;if(performanceDescriptor)Object.defineProperty(globalThis,'performance',performanceDescriptor);else delete globalThis.performance}
});

import assert from 'node:assert/strict';
import worker, {PlaybackSession} from '../src/index.js';
import {guardXtreamResponse, publicMetadata} from '../src/xtream-bridge.mjs';

// End-to-end Worker tests use isolated local users and two simulated providers.
// No requests or credentials are sent to a real service.
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
const objects = new Map(), env = {TICKET_SECRET:'xtream-test-secret-only', ADMIN_SETUP_SECRET:'xtream-setup-test-only-12345678901234567890'};
env.PLAYBACK_SESSIONS = {
  idFromName: name => name,
  get(id) {
    if (!objects.has(id)) objects.set(id, new PlaybackSession({storage:new Store()}, env));
    return {fetch:(url, options) => objects.get(id).fetch(new Request(url, options))};
  }
};
const origin = 'https://snapmovienow-edge.juancanta89.workers.dev';
const providerOrigins = ['http://ccf.center:8444', 'https://beta.example.test'];
const providerCalls = [], cancellations = [];
let failProvider = false, offset = 0;
const now = Date.now; Date.now = () => now() + offset;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url), provider = providerOrigins.indexOf(u.origin);
  assert.ok(provider >= 0, 'every upstream request stays with a configured test provider');
  const username = 'upstream-'+provider, password = 'provider-password-test-'+provider;
  providerCalls.push({origin:u.origin, path:u.pathname, action:u.searchParams.get('action'), id:u.searchParams.get('vod_id') || u.searchParams.get('series_id') || u.searchParams.get('stream_id')});
  if (u.pathname === '/player_api.php') {
    assert.equal(u.searchParams.get('username'), username);
    assert.equal(u.searchParams.get('password'), password);
    const action = u.searchParams.get('action');
    if (!action) return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});
    if (failProvider) return new Response('Unavailable', {status:503});
    const leaked = u.origin+'/movie/'+username+'/'+password+'/123.mp4';
    const image = 'https://images.example.test/poster.jpg';
    if (action.endsWith('_categories')) return Response.json([{category_id:'7', category_name:'Test '+provider, parent_id:0}]);
    if (action === 'get_live_streams') return Response.json([{stream_id:55, name:'Channel '+provider, category_id:'7', stream_icon:image, direct_source:leaked}]);
    if (action === 'get_vod_streams') return Response.json([{stream_id:123, name:'Movie '+provider, category_id:'7', container_extension:'mp4', stream_icon:image, direct_source:leaked, nested:{provider_url:leaked}}]);
    if (action === 'get_series') return Response.json([{series_id:22, name:'Series '+provider, category_id:'7', cover:image}]);
    if (action === 'get_vod_info') {
      assert.equal(u.searchParams.get('vod_id'), '123');
      return Response.json({info:{name:'Movie '+provider, cover_big:image, playback:leaked}, movie_data:{stream_id:123, category_id:'7', container_extension:'mp4', direct_source:leaked, username, password}});
    }
    if (action === 'get_series_info') {
      assert.equal(u.searchParams.get('series_id'), '22');
      return Response.json({info:{name:'Series '+provider, category_id:'7'}, seasons:[{season_number:1}], episodes:{'1':[{id:'88', episode_num:1, title:'Episode one', container_extension:'mkv', direct_source:leaked, info:{movie_image:image}}]}});
    }
    if (action === 'get_short_epg' || action === 'get_simple_data_table') {
      assert.equal(u.searchParams.get('stream_id'), '55');
      return Response.json({epg_listings:[{id:'1', title:btoa('Test program '+provider), start_timestamp:'1800000000', stop_timestamp:'1800003600'}]});
    }
    throw Error('Unexpected action '+action);
  }
  if (/^\/(live|movie|series)\//.test(u.pathname)) {
    assert.ok(u.pathname.includes('/'+username+'/'+password+'/'));
    if (u.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-KEY:METHOD=AES-128,URI="/key.bin"\n#EXTINF:4,\n/segment.ts\n', {headers:{'content-type':'application/vnd.apple.mpegurl'}});
    if (u.pathname.startsWith('/live/')) {
      return new Response(new ReadableStream({start(c) {c.enqueue(new Uint8Array([0x47,1,2,3]))}, cancel() {cancellations.push(u.pathname)}}), {headers:{'content-type':'video/mp2t'}});
    }
    const range = new Headers(opts.headers).get('range');
    return new Response('data', {status:range ? 206 : 200, headers:{'content-type':'video/mp4','content-length':'4','accept-ranges':'bytes',...(range ? {'content-range':'bytes 0-3/1000'} : {})}});
  }
  if (u.pathname === '/segment.ts') return new Response(new Uint8Array([0x47,1,2,3]), {headers:{'content-type':'video/mp2t'}});
  if (u.pathname === '/key.bin') return new Response(new Uint8Array(16), {headers:{'content-type':'application/octet-stream'}});
  throw Error('Unexpected upstream path '+u.pathname);
};
const headers = device => ({'CF-Connecting-IP':'198.51.100.'+device, 'User-Agent':'Smarters-test/'+device});
const post = async (body, path = '') => {
  const response = await worker.fetch(new Request(origin+path, {method:'POST', body:JSON.stringify(body)}), env);
  return {status:response.status, data:await response.json()};
};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'admin-password-test'}, '/admin');
const adminLogin = await post({action:'login',username:'owner',password:'admin-password-test'}, '/admin');
assert.equal(adminLogin.status, 200);
const admin = (action, body = {}) => post({action,access_token:adminLogin.data.access_token,...body}, '/admin');
for (let i=0;i<2;i++) assert.equal((await admin('provider-save', {mode:'single',url:providerOrigins[i],username:'upstream-'+i,password:'provider-password-test-'+i})).status, 200);
const customer = {username:'native-client',password:'customer-password-test'};
assert.equal((await admin('save', {create:true,...customer,status:'active',expiresAt:Date.now()+86400000})).status, 200);
const api = (action = '', params = {}, device = 1, method = 'GET') => {
  const query = new URLSearchParams({...customer,action,...params});
  return worker.fetch(new Request(origin+'/player_api.php'+(method === 'GET' ? '?'+query : ''), {method, headers:{...headers(device),...(method === 'POST' ? {'content-type':'application/x-www-form-urlencoded'} : {})},...(method === 'POST' ? {body:query} : {})}), env);
};
const media = (kind, id, ext, device = 1, extra = {}) => worker.fetch(new Request(`${origin}/${kind}/${customer.username}/${customer.password}/${id}.${ext}`, {...extra,headers:{...headers(device),...extra.headers}}), env);
const leases = async () => Object.values(await objects.get('__smn_accounts_v1').state.storage.get('leases') || {}).filter(l => l.until > Date.now());
const noProviderSecrets = data => {
  const text = JSON.stringify(data);
  for (const secret of [...providerOrigins,'upstream-0','upstream-1','provider-password-test-0','provider-password-test-1']) assert.ok(!text.includes(secret), 'provider configuration is private');
};

assert.equal((await worker.fetch(new Request(origin+'/player_api.php'), env)).status, 401);
assert.equal((await worker.fetch(new Request(origin.replace('https:','http:')+'/player_api.php'), env)).status, 400);
const callsBefore = providerCalls.length;
for (const login of [{...customer,password:'wrong-test-password'}, {username:'owner',password:'admin-password-test'}, {username:'upstream-0',password:'provider-password-test-0'}]) {
  const response = await api('', login); assert.equal(response.status, 401); assert.equal((await response.json()).user_info.auth, 0);
}
assert.equal(providerCalls.length, callsBefore, 'unknown customers never fall back to provider authentication');
const profile = await (await api()).json();
assert.equal(profile.user_info.auth, 1); assert.equal(profile.user_info.username, customer.username);
assert.equal(profile.user_info.password, customer.password); assert.equal(profile.server_info.https_port, '443');
assert.equal(profile.server_info.server_protocol, 'https'); assert.equal(profile.user_info.max_connections, '3'); noProviderSecrets(profile);
assert.equal((await (await api('', {}, 1, 'POST')).json()).user_info.auth, 1);
assert.equal((await post({action:'xtream-save',enabled:false},'/admin')).status, 401);
assert.equal((await admin('xtream-settings')).data.enabled, true);
assert.equal((await admin('xtream-check')).data.compatible, true);

const movieCategories = await (await api('get_vod_categories')).json();
const movies = await (await api('get_vod_streams')).json();
assert.equal(movies.length, 2); assert.equal(new Set(movies.map(m => m.stream_id)).size, 2);
assert.notEqual(movieCategories[0].category_id, movieCategories[1].category_id);
for (let i=0;i<2;i++) {
  assert.equal(movies[i].category_id, movieCategories[i].category_id);
  assert.equal(new URL(movies[i].direct_source).origin, origin);
  const filtered = await (await api('get_vod_streams',{category_id:movieCategories[i].category_id})).json();
  assert.deepEqual(filtered.map(m => m.name), ['Movie '+i]);
  const details = await (await api('get_vod_info',{vod_id:movies[i].stream_id})).json();
  assert.equal(details.info.name, 'Movie '+i); assert.equal(details.movie_data.stream_id, movies[i].stream_id); noProviderSecrets(details);
}
noProviderSecrets(movies); noProviderSecrets(movieCategories);
assert.deepEqual(await (await api('get_vod_streams')).json(), movies, 'catalog refresh preserves public IDs');
const channels = await (await api('get_live_streams')).json();
const series = await (await api('get_series')).json();
const seriesCategories = await (await api('get_series_categories')).json();
const filteredSeries = await (await api('get_series', {category_id:seriesCategories[1].category_id})).json();
assert.deepEqual(filteredSeries.map(s => s.name), ['Series 1']);
const episodes = [];
for (let i=0;i<2;i++) {
  const details = await (await api('get_series_info',{series_id:series[i].series_id})).json();
  assert.equal(details.info.name, 'Series '+i); assert.equal(details.episodes['1'].length, 1);
  const episode = details.episodes['1'][0]; episodes.push(episode);
  assert.equal(new URL(episode.direct_source).origin, origin); noProviderSecrets(details);
}
assert.notEqual(episodes[0].id, episodes[1].id);
assert.equal((await api('get_vod_info',{vod_id:series[0].series_id})).status, 404);
assert.equal((await media('movie',channels[0].stream_id,'mp4')).status, 404);
assert.equal((await media('series',series[0].series_id,'mkv')).status, 404);
assert.equal((await api('delete_user')).status, 403);
const epg = await (await api('get_short_epg',{stream_id:channels[1].stream_id})).json();
assert.equal(atob(epg.epg_listings[0].title), 'Test program 1');

const movie = await media('movie', movies[1].stream_id, 'mp4', 1, {headers:{range:'bytes=0-3'}});
assert.equal(movie.status,206); assert.equal(movie.headers.get('content-range'),'bytes 0-3/1000'); assert.equal(await movie.text(),'data');
assert.equal((await leases()).length,0, 'completed media releases its reservation');
const head = await media('movie',movies[0].stream_id,'mp4',1,{method:'HEAD'});
assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),'1000');
const episodeResponse = await media('series',episodes[1].id,'mkv');
assert.equal(episodeResponse.status,200); assert.equal(await episodeResponse.text(),'data');
assert.ok(providerCalls.some(c => c.origin===providerOrigins[1] && /\/series\/.+\/88\.mkv$/.test(c.path)), 'episodes use their original provider and ID');

const hls = await media('live',channels[0].stream_id,'m3u8');
assert.equal(hls.status,200); const manifest = await hls.text(); noProviderSecrets(manifest);
const segmentUrl = manifest.split('\n').find(line => line.startsWith('https://'));
const keyUrl = manifest.match(/URI="([^"]+)"/)[1];
assert.equal(new URL(segmentUrl).origin, origin);
assert.equal((await worker.fetch(new Request(keyUrl),env)).status,200);
const repeated = await media('live',channels[0].stream_id,'m3u8'); await repeated.text();
assert.equal((await leases()).length,1, 'playlist polling reuses the original provider reservation');
for (let i=0;i<2;i++) {
  offset+=80000;
  const segment = await worker.fetch(new Request(segmentUrl),env);
  assert.equal(segment.status,200); assert.equal((await segment.arrayBuffer()).byteLength,4);
}
assert.equal((await leases()).length,1, 'HLS renews beyond 90 seconds without web-player heartbeats');
for (let device=2;device<=3;device++) {const response=await media('live',channels[0].stream_id,'m3u8',device);assert.equal(response.status,200);await response.text()}
assert.equal((await media('live',channels[0].stream_id,'m3u8',4)).status,409, 'a customer cannot exceed three concurrent device sessions');
assert.equal((await (await api()).json()).user_info.active_cons,'3');
assert.equal((await admin('xtream-save',{enabled:false})).status,200);
assert.equal((await leases()).length,0); assert.equal((await api()).status,403);
assert.equal((await worker.fetch(new Request(segmentUrl),env)).status,410);
assert.equal((await post({op:'auth',...customer})).status,200, 'disabling Xtream preserves the web service');
await admin('xtream-save',{enabled:true});
assert.equal((await worker.fetch(new Request(segmentUrl),env)).status,410, 'reenabling does not resurrect old stream tickets');

const raw = await media('live',channels[0].stream_id,'ts');
assert.equal(raw.status,200); await raw.body.cancel();
assert.equal(cancellations.length,1); assert.equal((await leases()).length,0, 'native player disconnect releases capacity');
const first = await media('live',channels[0].stream_id,'ts');
const replacement = await media('live',channels[0].stream_id,'ts');
await first.body.cancel(); assert.equal((await leases()).length,1, 'a late canceled request cannot release its replacement');
await replacement.body.cancel(); assert.equal((await leases()).length,0);

await admin('save',{create:false,...customer,status:'active',permissions:{movies:true,series:true,tv:false}});
assert.deepEqual(await (await api('get_live_categories')).json(),[]);
assert.deepEqual(await (await api('get_live_streams')).json(),[]);
assert.equal((await media('live',channels[0].stream_id,'m3u8')).status,403);
assert.equal((await api('get_vod_streams')).status,200);
await admin('save',{create:false,...customer,status:'active',permissions:{movies:false,series:false,tv:true}});
assert.deepEqual(await (await api('get_series')).json(),[]);
assert.equal((await api('get_vod_info',{vod_id:movies[0].stream_id})).status,403);
const beforeSuspend = await media('live',channels[0].stream_id,'m3u8'); const beforeSuspendText = await beforeSuspend.text();
const revokedSegment = beforeSuspendText.split('\n').find(line => line.startsWith('https://'));
await admin('save',{create:false,...customer,status:'suspended'});
assert.equal((await api()).status,401); assert.equal((await worker.fetch(new Request(revokedSegment),env)).status,410);
await admin('save',{create:false,...customer,status:'active',password:'changed-password-test'});
assert.equal((await api()).status,401); customer.password='changed-password-test'; assert.equal((await api()).status,200);
await admin('save',{create:false,...customer,status:'active',expiresAt:Date.now()+1000}); offset+=2000;
assert.equal((await api()).status,401, 'expired customer is rejected even with a cached password check');
await admin('save',{create:false,...customer,status:'active'});
await admin('delete',{username:customer.username}); assert.equal((await api()).status,401);

const privateRegistry=env.PLAYBACK_SESSIONS.get('__smn_xtream_catalog_v1');
const register=async entries => {
  const response=await privateRegistry.fetch('https://private/accounts/xtream-register',{method:'POST',body:JSON.stringify({entries})}); assert.equal(response.status,200); return response.json();
};
const batch=Array.from({length:130},(_,i)=>({kind:'movie',server:'test-server',upstreamId:String(10000+i),ext:'mp4'}));
const ids=await register(batch); assert.equal(new Set(ids).size,130); assert.deepEqual(await register(batch),ids);
const concurrent=await Promise.all([register(batch.slice(0,60)),register(batch.slice(30,90))]);
assert.deepEqual(concurrent[0],ids.slice(0,60)); assert.deepEqual(concurrent[1],ids.slice(30,90));
const safe=publicMetadata({poster:'https://images.example.test/clean.jpg',bad:'http://[broken',hidden:'//ccf.center:8444/movie/upstream-0/provider-password-test-0/123.mp4'}, {origin:providerOrigins[0],username:'upstream-0',password:'provider-password-test-0'});
assert.equal(safe.poster,'https://images.example.test/clean.jpg'); assert.equal(safe.bad,''); assert.equal(safe.hidden,'');

// Exercise revocation of an open native response without waiting 25 real seconds.
const interval=globalThis.setInterval,clear=globalThis.clearInterval;
let tick, released=0, canceled=0;
globalThis.setInterval=fn=>{tick=fn;return 1}; globalThis.clearInterval=()=>{};
try {
  const guarded=guardXtreamResponse(new Response(new ReadableStream({cancel(){canceled++}})),async()=>false,async()=>{released++});
  const read=guarded.body.getReader().read(); const rejected=assert.rejects(read,/access_revoked/); await tick(); await rejected;
  assert.equal(released,1);assert.equal(canceled,1);
} finally {globalThis.setInterval=interval;globalThis.clearInterval=clear;Date.now=now}
console.log('PASS: Xtream login; two-provider catalogs and stable IDs; movie Range and episodes; HLS heartbeat and private keys; capacity, cancellation, user permissions, suspension, password, expiry, deletion and admin revocation.');

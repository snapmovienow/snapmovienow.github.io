// Xtream player compatibility. Provider passwords and playback origins stay private.
const ACTIONS = {
  get_live_categories: ['tv', 'live_category'], get_live_streams: ['tv', 'live'],
  get_vod_categories: ['movies', 'movie_category'], get_vod_streams: ['movies', 'movie'],
  get_series_categories: ['series', 'series_category'], get_series: ['series', 'series_list'],
  get_vod_info: ['movies', 'movie'], get_series_info: ['series', 'series_list'],
  get_short_epg: ['tv', 'live'], get_simple_data_table: ['tv', 'live']
};
const EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm3u8']);
const numeric = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
const categoryKind = kind => kind === 'live' ? 'live_category' : kind === 'movie' ? 'movie_category' : 'series_category';
const idField = kind => kind.endsWith('_category') ? 'category_id' : kind === 'series_list' ? 'series_id' : 'stream_id';
const permission = kind => kind === 'live' ? 'tv' : kind === 'movie' ? 'movies' : 'series';
const entry = (kind, server, id, extra = {}) => ({kind, server, upstreamId: String(id), ...extra});

export function matchesXtream(path) {
  return path === '/player_api.php' || /^\/(live|movie|series)\//.test(path);
}

function playbackURL(base, login, kind, id, ext) {
  return `${base}/${kind}/${encodeURIComponent(login.username)}/${encodeURIComponent(login.password)}/${id}.${ext}`;
}

function loginInfo(req, auth) {
  const url = new URL(req.url), user = auth.user;
  return {
    user_info: {
      username: user.username, password: auth.password, message: 'SNAPMOVIENOW', auth: 1,
      status: 'Active', exp_date: user.expiresAt ? String(Math.floor(user.expiresAt / 1000)) : null,
      is_trial: '0', active_cons: String(auth.connections || 0), max_connections: '3',
      created_at: String(Math.floor((user.createdAt || Date.now()) / 1000)),
      allowed_output_formats: ['m3u8', 'ts']
    },
    server_info: {
      url: url.hostname, port: url.port || '443', https_port: url.port || '443',
      server_protocol: 'https', rtmp_port: '0', timezone: 'UTC',
      timestamp_now: Math.floor(Date.now() / 1000), time_now: new Date().toISOString().slice(0, 19).replace('T', ' ')
    }
  };
}

async function mapList(rows, kind, auth, deps, base) {
  const field = idField(kind), categories = categoryKind(kind);
  const entries = [], refs = [];
  for (const row of rows) {
    if (!numeric(row[field])) continue;
    const server = row._server;
    if (!server) continue;
    const index = entries.push(entry(kind, server, row[field], {ext: EXTENSIONS.has(row.container_extension) ? row.container_extension : 'mp4'})) - 1;
    const category = kind.endsWith('_category') || row.category_id == null ? null : entries.push(entry(categories, server, row.category_id)) - 1;
    refs.push({row, index, category});
  }
  const ids = await deps.register(entries);
  return refs.map(({row, index, category}, num) => {
    const item = {...row, [field]: ids[index]}; delete item._server;
    if (category !== null) item.category_id = String(ids[category]);
    if (kind.endsWith('_category')) {item.parent_id = 0; item.category_id = String(ids[index]);}
    else {
      item.num = num + 1;
      if (kind !== 'series_list') {
        const ext = kind === 'live' ? 'm3u8' : EXTENSIONS.has(row.container_extension) ? row.container_extension : 'mp4';
        item.direct_source = playbackURL(base, auth, kind, ids[index], ext);
        item.stream_type = kind === 'live' ? 'live' : 'movie';
        item.container_extension = ext;
      }
    }
    return item;
  });
}

async function details(params, kind, auth, deps, base) {
  const publicId = params.get(kind === 'movie' ? 'vod_id' : 'series_id');
  if (!numeric(publicId)) return deps.json({error: 'invalid_stream'}, 400);
  const record = await deps.resolve(publicId);
  if (!record || record.kind !== kind) return deps.json({error: 'not_found'}, 404);
  const action = kind === 'movie' ? 'get_vod_info' : 'get_series_info';
  const data = await deps.catalog(action, record.server, {[kind === 'movie' ? 'vod_id' : 'series_id']: record.upstreamId});
  if (kind === 'movie') {
    const row = {...data.movie_data, stream_id: Number(publicId), container_extension: record.ext || 'mp4'};
    row.direct_source = playbackURL(base, auth, 'movie', publicId, row.container_extension);
    if (row.category_id != null) row.category_id = String((await deps.register([entry('movie_category', record.server, row.category_id)]))[0]);
    return deps.json({...data, movie_data: row});
  }
  const episodes = {}, flat = [];
  for (const [season, rows] of Object.entries(data.episodes || {})) {
    episodes[season] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (numeric(row.id)) flat.push({season, row});
    }
  }
  const ids = await deps.register(flat.map(({row}) => entry('episode', record.server, row.id, {ext: EXTENSIONS.has(row.container_extension) ? row.container_extension : 'mp4'})));
  flat.forEach(({season, row}, i) => {
    const ext = EXTENSIONS.has(row.container_extension) ? row.container_extension : 'mp4';
    episodes[season].push({...row, id: String(ids[i]), container_extension: ext, direct_source: playbackURL(base, auth, 'series', ids[i], ext)});
  });
  const info = {...data.info};
  if (info.category_id != null) info.category_id = String((await deps.register([entry('series_category', record.server, info.category_id)]))[0]);
  return deps.json({...data, info, episodes});
}

export async function handleXtream(req, deps) {
  const url = new URL(req.url);
  if (url.protocol !== 'https:') return deps.json({error: 'https_required'}, 400);
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return deps.json({error: 'method_not_allowed'}, 405);
  const stream = url.pathname.match(/^\/(live|movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.([a-zA-Z0-9]+)$/);
  let params = new URLSearchParams(url.search);
  if (req.method === 'POST') {
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      for (const [key, value] of Object.entries(await req.json())) params.set(key, String(value));
    } else for (const [key, value] of new URLSearchParams(await req.text())) params.set(key, value);
  }
  const username = stream ? decodeURIComponent(stream[2]) : params.get('username');
  const password = stream ? decodeURIComponent(stream[3]) : params.get('password');
  if (!username || !password || username.length > 80 || password.length > 256) return deps.json({user_info: {auth: 0}, error: 'credentials_required'}, 401);
  const auth = await deps.authenticate(username, password, req);
  if (auth instanceof Response) return auth;
  auth.password = password;
  if (stream) {
    const [, kind, , , publicId, ext] = stream;
    if (!EXTENSIONS.has(ext.toLowerCase())) return deps.json({error: 'invalid_stream'}, 400);
    if (!auth.user.permissions[permission(kind)]) return deps.json({error: 'content_disabled'}, 403);
    const record = await deps.resolve(publicId), expected = kind === 'series' ? 'episode' : kind;
    if (!record || record.kind !== expected) return deps.json({error: 'not_found'}, 404);
    return deps.play(req, auth.session, {...record, type: kind, ext: ext.toLowerCase()});
  }
  if (url.pathname !== '/player_api.php') return deps.json({error: 'not_found'}, 404);
  const action = params.get('action') || '';
  if (!action) return deps.json(loginInfo(req, auth));
  const spec = ACTIONS[action];
  if (!spec) return deps.json({error: 'operation_not_allowed'}, 403);
  if (!auth.user.permissions[spec[0]]) return deps.json(action.endsWith('_info') ? {error: 'content_disabled'} : [] , action.endsWith('_info') ? 403 : 200);
  if (action.endsWith('_info')) return details(params, spec[1], auth, deps, url.origin);
  if (action === 'get_short_epg' || action === 'get_simple_data_table') {
    const record = await deps.resolve(params.get('stream_id'));
    if (!record || record.kind !== 'live') return deps.json({epg_listings: []});
    return deps.json(await deps.catalog(action, record.server, {stream_id: record.upstreamId, limit: String(Math.min(100, Math.max(1, Number(params.get('limit')) || 10)))}));
  }
  const categoryId = params.get('category_id');
  let rows = await deps.catalog(action);
  if (!Array.isArray(rows)) throw Error('invalid_catalog');
  if (categoryId && !spec[1].endsWith('_category')) {
    const category = await deps.resolve(categoryId);
    if (!category || category.kind !== categoryKind(spec[1])) return deps.json([]);
    rows = rows.filter(row => row._server === category.server && String(row.category_id) === category.upstreamId);
  }
  return deps.json(await mapList(rows, spec[1], auth, deps, url.origin));
}

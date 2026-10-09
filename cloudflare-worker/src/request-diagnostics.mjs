export const SERVICE_VERSION = '43';

const rayId = value => /^[a-f0-9]{8,32}-[a-z]{3}$/i.test(value || '') ? value : null;
function routeGroup(path) {
  if (['/', '/health', '/admin', '/player_api.php', '/stream', '/gnula-media'].includes(path)) return path;
  if (/^\/(live|movie|series)\//.test(path)) return '/' + path.split('/')[1] + '/*';
  return 'other';
}

// Log only bounded metadata. Xtream paths, query strings and request bodies
// contain credentials and must never be included in diagnostics.
export async function traceRequest(req, handler, {logger = console.error, now = Date.now, allowedOrigin} = {}) {
  const started = now(), requestId = crypto.randomUUID();
  let response;
  try { response = await handler(); }
  catch { response = Response.json({error: 'service_unavailable'}, {status: 502,
    headers: allowedOrigin ? {'Access-Control-Allow-Origin': allowedOrigin, 'Cache-Control': 'no-store'} : {}}); }
  const headers = new Headers(response.headers);
  headers.set('X-SMN-Request-ID', requestId);
  headers.set('X-SMN-Version', SERVICE_VERSION);
  const exposed = new Set((headers.get('Access-Control-Expose-Headers') || '').split(',').map(x => x.trim()).filter(Boolean));
  for (const name of ['X-SMN-Request-ID', 'X-SMN-Version', 'CF-Ray']) exposed.add(name);
  headers.set('Access-Control-Expose-Headers', [...exposed].join(', '));
  if (response.status === 403 || response.status >= 500) {
    try {
      logger({event: 'request_failed', time: new Date(started).toISOString(),
        request_id: requestId, ray_id: rayId(req.headers.get('CF-Ray')),
        route: routeGroup(new URL(req.url).pathname),
        method: ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method) ? req.method : 'other',
        status: response.status, elapsed_ms: Math.max(0, now() - started), version: SERVICE_VERSION});
    } catch { /* Diagnostics cannot interrupt a response. */ }
  }
  // Preserve the original stream and its cancellation propagation; do not read
  // or clone media bodies for logging.
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

const portalEntries = new Map([
  ['api.snaptvnow.com', new Set(['/owner-panel', '/owner-panel/', '/resellers', '/resellers/', '/panel/juanito', '/panel/juanito/'])],
  ['resellers.snaptvnow.com', new Set(['/', '/apps', '/boxpanel', '/boxpanel/login'])],
  ['juanito.resellers.snaptvnow.com', new Set(['/', '/apps', '/boxpanel', '/boxpanel/login'])],
]);

export function requireControlHTTPS(req) {
  const url = new URL(req.url);
  if (url.protocol === 'https:') return null;
  // app-config.js uses loopback for Wrangler development.
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;

  const headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};
  const entry = portalEntries.get(url.host)?.has(url.pathname);
  if (entry && ['GET', 'HEAD'].includes(req.method) && !url.search &&
      !req.headers.has('Authorization') && !req.headers.has('Cookie')) {
    return new Response(null, {status: 301, headers: {...headers, Location: 'https://' + url.host + url.pathname}});
  }
  // Only named, empty entry pages may redirect. Keep tickets, credentials
  // and variable path components out of the Location header.
  return Response.json({error: 'https_required'}, {status: 400, headers});
}

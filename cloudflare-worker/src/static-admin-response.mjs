// app.snaptvnow.com is a zone route in front of GitHub Pages, not a Worker
// custom domain. The ordinary same-zone fetch goes directly to its origin.
export function matchesStaticAdminURL(url) {
  return url.hostname === 'app.snaptvnow.com' && (url.pathname.startsWith('/admin') || url.pathname.startsWith('/owner-security'));
}

export async function staticAdminResponse(request, fetchOrigin = fetch) {
  const url = new URL(request.url);
  const document = /^\/(?:admin|owner-security)(?:\.html)?$/.test(url.pathname);
  const asset = /^\/(?:admin(?:-[a-z0-9-]+)?|owner-security)\.(?:js|css)$/.test(url.pathname);
  const privateHeaders = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};
  const read = request.method === 'GET' || request.method === 'HEAD';
  if (url.protocol !== 'https:') {
    if (document && read && !url.search && !request.headers.has('Cookie') && !request.headers.has('Authorization')) {
      return new Response(null, {status: 301, headers: {...privateHeaders, Location: 'https://app.snaptvnow.com' + url.pathname}});
    }
    return new Response(null, {status: 400, headers: privateHeaders});
  }
  if (!read) return new Response(null, {status: 405, headers: {...privateHeaders, Allow: 'GET, HEAD'}});
  if (!document && !asset) return new Response(null, {status: 404, headers: privateHeaders});
  if (url.search && (!asset || !/^\?v=[A-Za-z0-9._-]{1,64}$/.test(url.search))) {
    return new Response(null, {status: 400, headers: privateHeaders});
  }
  const publicHeaders = new Headers();
  for (const name of ['Accept', 'Accept-Encoding', 'If-Modified-Since', 'If-None-Match', 'If-Range', 'Range']) {
    if (request.headers.has(name)) publicHeaders.set(name, request.headers.get(name));
  }
  const upstream = await fetchOrigin(new Request(url, {
    method: request.method, headers: publicHeaders, signal: request.signal, redirect: 'manual'
  }), {redirect: 'manual'});
  const headers = new Headers(upstream.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.append('Content-Security-Policy', document ? "frame-ancestors 'none'; form-action 'none'" : "frame-ancestors 'none'");
  headers.set('Referrer-Policy', 'no-referrer');
  if (new URL(request.url).protocol === 'https:' && !headers.has('Strict-Transport-Security')) {
    headers.set('Strict-Transport-Security', 'max-age=86400');
  }
  return new Response(upstream.body, {status: upstream.status, statusText: upstream.statusText, headers});
}

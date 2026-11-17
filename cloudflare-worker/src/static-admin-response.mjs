// app.snaptvnow.com is a zone route in front of GitHub Pages, not a Worker
// custom domain. The ordinary same-zone fetch goes directly to its origin.
export function matchesStaticAdminURL(url) {
  return url.hostname === 'app.snaptvnow.com' && (url.pathname.startsWith('/admin') || url.pathname.startsWith('/owner-security'));
}

export async function staticAdminResponse(request, fetchOrigin = fetch) {
  const upstream = await fetchOrigin(request, {redirect: 'manual'});
  const headers = new Headers(upstream.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.append('Content-Security-Policy', "frame-ancestors 'none'");
  headers.set('Referrer-Policy', 'no-referrer');
  if (new URL(request.url).protocol === 'https:' && !headers.has('Strict-Transport-Security')) {
    headers.set('Strict-Transport-Security', 'max-age=86400');
  }
  return new Response(upstream.body, {status: upstream.status, statusText: upstream.statusText, headers});
}

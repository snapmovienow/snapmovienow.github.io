// Only fixed filenames reach the public relay. The encrypted ticket still selects
// the upstream resource. Never copy its basename, query or fragment into the path.
const extensions = new Set(['m3u8', 'ts', 'm4s', 'mp4', 'm4a', 'm4v', 'mp3', 'aac', 'ac3', 'ec3', 'cmfv', 'cmfa', 'vtt', 'webvtt', 'key']);
const paths = new Set([...extensions].map(ext => '/stream/resource.' + ext));

export function isSignedStreamPath(pathname) {
  return pathname === '/stream' || paths.has(pathname);
}

export function liveHlsResourceExtension(target, playlistReference, keyReference) {
  if (playlistReference) return 'm3u8';
  if (keyReference) return 'key';
  const suffix = target.pathname.match(/\.([a-z0-9]{2,6})$/i)?.[1].toLowerCase();
  return extensions.has(suffix) ? suffix : null;
}

export function signedStreamPath(claim) {
  if (!claim?.xtream || claim.type !== 'live' || claim.ext !== 'm3u8') return '/stream';
  const suffix = claim.resource ? claim.hlsExtension : 'm3u8';
  return extensions.has(suffix) ? '/stream/resource.' + suffix : '/stream';
}

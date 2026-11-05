import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const read = name => readFileSync(new URL(`../branding-test/${name}`, import.meta.url), 'utf8');
const master = read('master.m3u8');
const subtitlePlaylist = read('brand.m3u8');
const vtt = read('brand.vtt');
const source = JSON.parse(read('source.json'));
const applePrefix = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/';

// A real, default HLS subtitle rendition is linked to the video variant.
assert.match(master, /^#EXTM3U\n/);
const subtitleDeclaration = master.split('\n').find(line => line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES,'));
assert.ok(subtitleDeclaration);
for (const attribute of ['GROUP-ID="snap-brand"', 'DEFAULT=YES', 'AUTOSELECT=YES', 'FORCED=NO', 'URI="brand.m3u8"']) {
  assert.ok(subtitleDeclaration.includes(attribute), attribute);
}
assert.match(master, /#EXT-X-STREAM-INF:[^\n]*SUBTITLES="snap-brand"[^\n]*\nvideo\.m3u8/);
assert.match(master, /#EXT-X-MEDIA:TYPE=AUDIO,[^\n]*URI="audio\.m3u8"/);
assert.match(master, /CODECS="avc1\.64001f,mp4a\.40\.2"/);
assert.match(subtitlePlaylist, /#EXT-X-TARGETDURATION:600\n/);
assert.match(subtitlePlaylist, /#EXTINF:600\.000,\nbrand\.vtt\n#EXT-X-ENDLIST/);

// Mapping comes from Apple's synchronized original subtitle track, not a guessed PTS.
assert.match(vtt, /^WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00\.000\n/);
assert.match(vtt, /00:00:00\.008 --> 00:10:00\.000 line:85% position:95%,line-right align:end size:70%\nEXCLUSIVO · SNAPTVNOW\n$/);
assert.equal(source.timestampMap.mpegts, 900000);
assert.equal(source.timestampMap.local, '00:00:00.000');
assert.equal(source.subtitleTimingSource, `${applePrefix}s1/en/fileSequence0.webvtt`);
assert.equal(source.subtitleTimingSecondSegmentChecked, `${applePrefix}s1/en/fileSequence1.webvtt`);

for (const [file, variant, expectedDuration, firstRange] of [
  ['video.m3u8', 'v3', 599.99999, '510508@1118'],
  ['audio.m3u8', 'a1', 600.04267, '161593@616'],
]) {
  const playlist = read(file);
  assert.match(playlist, /^#EXTM3U\n/);
  assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD\n/);
  assert.match(playlist, /#EXT-X-ENDLIST\n?$/);
  assert.ok(!playlist.includes('#EXT-X-KEY'), 'demo must not require DRM or encryption');
  assert.ok(playlist.includes(`#EXT-X-BYTERANGE:${firstRange}\n`));
  assert.ok(playlist.includes(`#EXT-X-MAP:URI="${applePrefix}${variant}/main.mp4",BYTERANGE="`));
  const mediaUrls = playlist.split('\n').filter(line => line && !line.startsWith('#'));
  const attributeUrls = [...playlist.matchAll(/URI="([^"]+)"/g)].map(match => match[1]);
  assert.ok(mediaUrls.length > 1);
  for (const url of [...mediaUrls, ...attributeUrls]) assert.equal(url, `${applePrefix}${variant}/main.mp4`);
  const duration = [...playlist.matchAll(/#EXTINF:([\d.]+),/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  assert.ok(Math.abs(duration - expectedDuration) < 0.00001);
  assert.ok(playlist.length < 100_000);
}

const m3u = read('playlist.m3u');
assert.equal((m3u.match(/^#EXTINF:/gm) || []).length, 1);
assert.match(m3u, /tvg-id="branding-test-snaptvnow" group-title="PRUEBAS SNAPTVNOW",PRUEBA MARCA SNAPTVNOW/);
assert.equal(m3u.split('\n').find(line => line.startsWith('https:')), 'https://app.snaptvnow.com/branding-test/master.m3u8');
assert.equal(source.videoOrAudioModified, false);
assert.equal(source.videoOrAudioHostedHere, false);
assert.equal(source.drm, false);
assert.match(source.kind, /VOD.*not live TV/);
assert.equal(source.subtitleDurationSeconds, 600);
assert.equal(source.initialFragmentValidation.firstVideoPtsSeconds * 90_000, source.timestampMap.mpegts);
assert.equal(source.initialFragmentValidation.firstFrameDecoded, true);
assert.equal(source.initialFragmentValidation.bytesRead, 511626);

// Preview uses the media element's actual native cues; no substitute HTML branding overlay.
const html = read('index.html');
assert.match(html, /<video id="player"[^>]*><\/video>/);
assert.match(html, /hls\.js@1\.6\.15\/dist\/hls\.min\.js/);
assert.match(html, /integrity="sha384-iZBI1\/lW9u8FcBjxuQ8nPTsU7TXhZNtzkV8H3gQHSTgz\+VYQoKWqGlBHqhO84alJ"/);
assert.match(html, /renderTextTracksNatively: true/);
assert.match(html, /engine\.subtitleDisplay = enabled/);
assert.match(html, /track\.activeCues/);
assert.ok(!/<(?:canvas|svg|img)\b/i.test(html));
assert.ok(!/position:\s*absolute/i.test(html));
assert.equal((html.match(/EXCLUSIVO · SNAPTVNOW/g) || []).length, 1, 'phrase occurs only in cue inspection logic, never as visual HTML text');
const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript);
new Script(inlineScript, {filename: 'branding-test/index.html'});

console.log('branding-demo: manifests, official subtitle timing, absolute media ranges and genuine cue preview verified');

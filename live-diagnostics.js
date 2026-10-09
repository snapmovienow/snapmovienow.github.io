// A bounded, in-memory trace. Only selected numbers and known HLS identifiers
// are copied: never URLs, tickets, headers, payloads, credentials or titles.
function createLiveDiagnostics(video, options = {}) {
 const now = options.now || Date.now, schedule = options.schedule || setInterval, unschedule = options.unschedule || clearInterval;
 const engine = options.engine, events = options.events || {}, started = now();
 const types = new Set(Object.values(options.errorTypes || {})), details = new Set(Object.values(options.errorDetails || {}));
 const trace = [], samples = [], cleanup = [];
 let stopped = false, frozen = null, pending = null, tracks = {}, playlist = null, codecs = {}, lastPosition = Number(video.currentTime) || 0, lastMove = now(), lastSample = -Infinity;
 const num = value => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
 const elapsed = () => num((now() - started) / 1000);
 const push = (kind, data = {}) => { trace.push({t: elapsed(), kind, ...data}); if (trace.length > 32) trace.shift(); };
 function ranges(buffer) {
  const result = [];
  try { for (let i = Math.max(0, (buffer?.length || 0) - 4); i < (buffer?.length || 0); i++) result.push([num(buffer.start(i)), num(buffer.end(i))]); } catch {}
  return result;
 }
 function fragment(frag) {
  return {sn: num(frag?.sn), cc: num(frag?.cc), start: num(frag?.start), duration: num(frag?.duration)};
 }
 function loading(stats) {
  const timing = stats?.loading || {};
  return {bytes: num(stats?.loaded), total: num(stats?.total), retries: num(stats?.retry), chunks: num(stats?.chunkCount), firstByteMs: timing.first > 0 ? num(timing.first - timing.start) : null, loadMs: timing.end > 0 ? num(timing.end - timing.start) : null};
 }
 function snapshot() {
  let quality = {};
  try { const q = video.getVideoPlaybackQuality?.(); quality = {decoded: num(q?.totalVideoFrames), dropped: num(q?.droppedVideoFrames)}; } catch {}
  return {t: elapsed(), position: num(video.currentTime), ready: num(video.readyState), paused: !!video.paused, seeking: !!video.seeking, ended: !!video.ended, hidden: !!options.hidden?.(), width: num(video.videoWidth), height: num(video.videoHeight), mediaError: num(video.error?.code), buffered: ranges(video.buffered), audioBuffered: ranges(tracks.audio?.buffer?.buffered), videoBuffered: ranges((tracks.video || tracks.audiovideo)?.buffer?.buffered), frames: quality, pending: pending ? {...fragment(pending), ...loading(pending.stats)} : null};
 }
 function report(reason = 'manual') {
  return JSON.parse(JSON.stringify(frozen || {reason, transport: engine ? 'hls-mse' : 'native-hls', qualityLabel: options.quality === '1080' || options.quality === '720' ? options.quality : 'other', progressive: !!engine?.config?.progressive, codecs, playlist, state: snapshot(), samples, events: trace}));
 }
 function capture(reason) {
  if (!stopped && !frozen) frozen = report(reason);
  return report();
 }
 function on(name, handler) {
  if (!engine || !events[name]) return;
  const listener = (_, data) => { if (!stopped) { try { handler(data || {}); } catch {} } };
  engine.on(events[name], listener); cleanup.push(() => engine.off(events[name], listener));
 }
 on('ERROR', data => {
  push('hls_error', {type: types.has(data.type) ? data.type : 'unknown', detail: details.has(data.details) ? data.details : 'unknown', fatal: !!data.fatal, status: num(data.response?.code), frag: fragment(data.frag)});
  if (data.fatal) capture('fatal_error');
 });
 on('BUFFER_CREATED', data => { tracks = data.tracks || {}; });
 on('BUFFER_CODECS', data => {
  for (const key of ['video', 'audio', 'audiovideo']) {
   const track = data[key]; if (!track) continue;
   const codec = /^(?:avc1|avc3|hvc1|hev1|av01|vp09|mp4a)\.[a-fA-F0-9.]{1,32}$/.test(track.codec || '') ? track.codec : 'unknown';
   codecs[key] = {codec, width: num(track.metadata?.width), height: num(track.metadata?.height)};
  }
 });
 on('LEVEL_LOADED', data => {
  const d = data.details || {};
  playlist = {live: !!d.live, startSN: num(d.startSN), endSN: num(d.endSN), targetDuration: num(d.targetduration), totalDuration: num(d.totalduration)};
  push('playlist', {...playlist, ...loading(data.stats)});
 });
 on('LEVEL_PTS_UPDATED', data => { push('pts_update', {drift: num(data.drift)}); });
 on('FRAG_LOADING', data => { if (data.frag?.type === 'main') { pending = data.frag; push('segment_request', fragment(data.frag)); } });
 on('FRAG_LOADED', data => {
  if (data.frag?.type !== 'main') return;
  push('segment_loaded', {...fragment(data.frag), ...loading(data.frag.stats)});
  if (pending === data.frag) pending = null;
 });
 on('FRAG_BUFFERED', data => {
  if (data.frag?.type !== 'main') return;
  const f = data.frag, v = f.elementaryStreams?.video;
  push('segment_buffered', {...fragment(f), startPTS: num(v?.startPTS), endPTS: num(v?.endPTS), startDTS: num(v?.startDTS), endDTS: num(v?.endDTS)});
 });
 for (const name of ['waiting', 'stalled', 'playing', 'seeking', 'seeked', 'ended', 'error']) {
  const listener = () => { if (stopped) return; push(name, {position: num(video.currentTime), mediaError: num(video.error?.code)}); if (name === 'error') capture('media_error'); };
  video.addEventListener(name, listener); cleanup.push(() => video.removeEventListener(name, listener));
 }
 const timer = schedule(() => {
  if (stopped) return;
  if (options.active && !options.active()) { stop(); return; }
  const time = now(), position = Number(video.currentTime) || 0;
  if (Math.abs(position - lastPosition) > 0.04 || video.paused || video.seeking || options.hidden?.()) lastMove = time;
  lastPosition = position;
  if (time - lastSample >= 2000) { samples.push(snapshot()); if (samples.length > 16) samples.shift(); lastSample = time; }
  if (time - lastMove >= 8000 && !video.paused && !video.seeking && !options.hidden?.()) capture('timeline_stall');
 }, 1000);
 function stop() { if (stopped) return; stopped = true; unschedule(timer); for (const close of cleanup) { try { close(); } catch {} } tracks = {}; pending = null; }
 return {report, capture, stop};
}

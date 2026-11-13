// Shared by the private pilot and, later, the DNS playback adapter.
// No URLs, accounts or credit balances belong in this policy.
const key = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
const fail = message => { throw new Error(message); };
export const DEFAULT_POLICY = Object.freeze({revision:0, enabled:false, channels:[], categories:[], text:'SNAPTVNOW', logo:true, profiles:['480p','720p'], maxChannels:1, idleSeconds:60, window:null});
export const PROFILES = Object.freeze({
  '480p':{width:854,height:480,videoKbps:950,audioKbps:96},
  '720p':{width:1280,height:720,videoKbps:2200,audioKbps:96}
});
export function validatePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_policy');
  const allowed = new Set(Object.keys(DEFAULT_POLICY));
  if (Object.keys(input).some(k => !allowed.has(k))) fail('invalid_policy_field');
  const p = {...DEFAULT_POLICY,...input};
  if (!Number.isSafeInteger(p.revision) || p.revision < 0 || typeof p.enabled !== 'boolean' || typeof p.logo !== 'boolean') fail('invalid_policy');
  for (const field of ['channels','categories']) {
    if (!Array.isArray(p[field]) || p[field].length > 200 || p[field].some(v => !key(v)) || new Set(p[field]).size !== p[field].length) fail('invalid_selection');
    p[field] = [...p[field]];
  }
  if (typeof p.text !== 'string' || p.text.length > 80 || /[\u0000-\u001f\u007f]/.test(p.text)) fail('invalid_text');
  if (!Array.isArray(p.profiles) || !p.profiles.length || p.profiles.length > 2 || p.profiles.some(v => !Object.hasOwn(PROFILES,v)) || new Set(p.profiles).size !== p.profiles.length) fail('invalid_profiles');
  p.profiles = [...p.profiles];
  if (!Number.isInteger(p.maxChannels) || p.maxChannels < 1 || p.maxChannels > 20) fail('invalid_limit');
  if (!Number.isInteger(p.idleSeconds) || p.idleSeconds < 10 || p.idleSeconds > 600) fail('invalid_idle');
  if (p.window !== null) {
    if (!p.window || typeof p.window !== 'object' || Object.keys(p.window).sort().join(',') !== 'end,start') fail('invalid_window');
    const {start,end} = p.window;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end-start > 7*86400000) fail('invalid_window');
    p.window = {start,end};
  }
  return p;
}
export function selectedChannel(policy,channel,now=Date.now()) {
  return !!(policy.enabled && channel && (policy.channels.includes(channel.id) || policy.categories.includes(channel.categoryId)) &&
    (!policy.window || now >= policy.window.start && now < policy.window.end));
}
export function publicChannel(channel) {
  return {id:channel.id,name:channel.name,categoryId:channel.categoryId,categoryName:channel.categoryName};
}
export function validateCatalog(rows,{demo=false,allowedOrigins=[]}={}) {
  if (!Array.isArray(rows) || rows.length > 2000) fail('invalid_catalog');
  const ids=new Set();
  return rows.map(row => {
    if (!row || !key(row.id) || !key(row.categoryId) || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160 || typeof row.categoryName !== 'string' || row.categoryName.length > 100) fail('invalid_catalog');
    ids.add(row.id);
    if (row.demo === true) { if (!demo) fail('demo_disabled'); }
    else {
      let u;try {u=new URL(row.source);} catch {fail('invalid_source');}
      if (!['http:','https:'].includes(u.protocol) || !allowedOrigins.includes(u.origin) || u.hash || u.username || u.password) fail('source_not_allowed');
    }
    return {...publicChannel(row),...(row.demo === true ? {demo:true} : {source:row.source})};
  });
}

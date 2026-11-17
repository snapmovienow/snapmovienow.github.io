// v1 applies a server-side HMAC after the existing salted PBKDF2 verifier.
// Its cost is fixed by the format and never taken from client input.
const encoder = new TextEncoder();
const prefix = 'snap-pw-v1$';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export function usesPepper(salt) {
  return typeof salt === 'string' && salt.startsWith(prefix);
}

export function upgradeEnabled(env) {
  return env?.PASSWORD_UPGRADE_ENABLED === 'true';
}

async function passwordKey(env) {
  const secret=env?.TICKET_SECRET;
  if(typeof secret!=='string'||secret.length<32)throw Error('password_key_unavailable');
  const master=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bits=await crypto.subtle.sign('HMAC',master,encoder.encode('SNAP-worker-password-pepper-v1'));
  return {
    id:hex(await crypto.subtle.digest('SHA-256',bits)).slice(0,32),
    key:await crypto.subtle.importKey('raw',bits,{name:'HMAC',hash:'SHA-256'},false,['sign'])
  };
}
export async function pepperId(env) {
  return (await passwordKey(env)).id;
}
export async function checkPasswordKey(salt, env) {
  if (usesPepper(salt) && (!salt.startsWith(prefix + await pepperId(env) + '$') || salt.length <= prefix.length + 33)) {
    throw Error('password_key_unavailable');
  }
}

export async function upgradeVerifier(salt, digest, env) {
  const {id,key}=await passwordKey(env);
  const taggedSalt=prefix+id+'$'+salt;
  const hash = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(taggedSalt + '$' + digest)));
  return {salt:taggedSalt, hash};
}

export async function passwordHash(password, salt, env) {
  await checkPasswordKey(salt, env);
  const rawSalt = usesPepper(salt) ? salt.slice(prefix.length + 33) : salt;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const digest = hex(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256',
    salt:encoder.encode(rawSalt), iterations:100000}, key, 256));
  return usesPepper(salt) ? (await upgradeVerifier(rawSalt, digest, env)).hash : digest;
}

export async function newVerifier(password, env) {
  const salt = crypto.randomUUID();
  const hash = await passwordHash(password, salt, env);
  return upgradeEnabled(env) ? upgradeVerifier(salt, hash, env) : {salt, hash};
}

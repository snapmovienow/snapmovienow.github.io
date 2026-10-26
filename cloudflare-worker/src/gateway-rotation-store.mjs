// Private Durable Object operations. Never exposes ciphertext, credentials or their hashes.
const ACCOUNT='be5f1fc0-d772-4683-9c6f-2bcdee5a4e70',ID=/^[a-f0-9-]{36}$/,HASH=/^[a-f0-9]{64}$/;
const json=(body,status=200)=>Response.json(body,{status});
const meta=(current,op)=>({ok:true,accountId:ACCOUNT,configured:!!current,currentRevision:current?.revision??null,operation:op?{rotationId:op.rotationId,revision:op.revision,state:op.state,checks:op.checks??null,checksState:op.checksState,superseded:current?.revision!==(op.state==='applied'?op.revision:op.expectedRevision),reason:op.reason??null}:null});
const checksValid=checks=>Array.isArray(checks)&&checks.length===2&&checks.every((x,i)=>x?.path===['/api/portal','/api/owner-portal'][i]&&typeof x.ok==='boolean'&&Number.isInteger(x.status)&&x.status>=0&&x.status<=599&&Object.keys(x).sort().join(',')==='ok,path,status');
export async function gatewayRotationStore(store,path,b,now=Date.now()){
 if(b.accountId!==ACCOUNT||(!(path==='/reseller-portal-rotation-status'&&b.rotationId===null)&&!ID.test(b.rotationId||'')))return json({error:'bridge_rotation_scope'},403);
 const configKey='reseller-portal:'+ACCOUNT,opKey='gateway-rotation:'+ACCOUNT+':'+b.rotationId;
 if(path==='/reseller-portal-rotation-status')return store.transaction(async tx=>json(meta(await tx.get(configKey),b.rotationId===null?null:await tx.get(opKey))));
 if(path==='/reseller-portal-rotation-begin')return store.transaction(async tx=>{
  const current=await tx.get(configKey),op=await tx.get(opKey);
  if(op)return op.fingerprint===b.fingerprint?json({...meta(current,op),claimed:false}):json({error:'bridge_rotation_conflict'},409);
  if(!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now||b.expiresAt>now+86400000)return json({error:'bridge_rotation_expired'},409);
  if(!current||current.revision!==b.expectedRevision||current.payloadHash!==b.expectedPayloadHash)return json({error:'bridge_rotation_stale'},409);
  if(!Number.isSafeInteger(b.revision)||b.revision<=current.revision||!HASH.test(b.fingerprint||''))return json({error:'bridge_rotation_input'},400);
  const record={rotationId:b.rotationId,revision:b.revision,expectedRevision:b.expectedRevision,expectedPayloadHash:b.expectedPayloadHash,expiresAt:b.expiresAt,fingerprint:b.fingerprint,state:'checking',checksState:'claimed',checks:null};
  await tx.put(opKey,record);return json({...meta(current,record),claimed:true});
 });
 if(path==='/reseller-portal-rotation-finish')return store.transaction(async tx=>{
  const current=await tx.get(configKey),op=await tx.get(opKey);
  if(!op||op.revision!==b.revision||op.fingerprint!==b.fingerprint)return json({error:'bridge_rotation_state'},409);
  if(op.state!=='checking')return json(meta(current,op));
  if(!checksValid(b.checks)||typeof b.encrypted!=='string'||b.encrypted.length>12000||!HASH.test(b.payloadHash||''))return json({error:'bridge_rotation_input'},400);
  op.checks=b.checks;op.checksState='finished';
  op.reason=!b.checks.every(x=>x.ok)?'checks_failed':current?.revision!==op.expectedRevision||current?.payloadHash!==op.expectedPayloadHash?'stale':now>=op.expiresAt?'expired':null;
  if(op.reason){op.state='not_applied';await tx.put(opKey,op);return json(meta(current,op));}
  const next={encrypted:b.encrypted,revision:op.revision,payloadHash:b.payloadHash};op.state='applied';
  // Commit the new encrypted configuration and successful proof atomically, only after both checks.
  await tx.put(configKey,next);await tx.put(opKey,op);return json(meta(next,op));
 });
 return json({error:'bridge_rotation_route'},404);
}

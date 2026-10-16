// Private signed inspection of known reseller lines. Never return credentials.
export async function resellerIntegrity(store,b){
 const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(x);
 if(!id(b.accountId)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100||b.lines.some(x=>!id(x.lineId)||!/^[a-z0-9_.@-]{3,80}$/.test(x.username||''))||new Set(b.lines.map(x=>x.lineId)).size!==b.lines.length)return Response.json({error:'bridge_input'},{status:400});
 const lines=[];
 for(const x of b.lines){
  const u=await store.get('user:'+x.username),receipt=await store.get('reseller-line:'+b.accountId+':'+x.lineId),adoption=await store.get('native-adoption:'+b.accountId+':'+x.username);
  const owned=u?.resellerBridge?.accountId===b.accountId&&u.resellerBridge.lineId===x.lineId;
  lines.push({...x,state:u?(owned?'present':'conflict'):'missing',version:receipt?.username===x.username?receipt.version:null,recoverableNative:!u&&adoption?.lineId===x.lineId&&typeof adoption.sourceHash==='string',...(owned?{status:u.status,expiresAt:u.expiresAt,permissions:u.permissions,native:u.resellerBridge.native===true,...(u.resellerBridge.native&&adoption?.lineId===x.lineId?{originalIdentityMatches:u.id===adoption.original?.id}:{})}:{})});
 }
 const events=(await store.get('security-audit')||[]).filter(x=>['backup_restored','user_deleted','reseller_line_applied','reseller_native_recovered'].includes(x.action)).slice(-12).map(x=>({at:x.at,action:x.action}));
 return Response.json({ok:true,checkedAt:Date.now(),lines,events});
}

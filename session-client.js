// Session persistence and transport contracts, independent of catalog/player/DOM.
globalThis.SMNSessionClient=(()=>{
const resolveStorage=storage=>typeof storage==='function'?storage():storage;
const client={
 read(storage,{cookieMode=false}={}){
  try{const value=JSON.parse(resolveStorage(storage).getItem('smn_session')||'null');if(!value)return null;
   if(typeof value.username!=='string'||!/^[a-zA-Z0-9_.@-]{3,80}$/.test(value.username)||Object.hasOwn(value,'password')||typeof value.access_token!=='string'||!value.access_token||cookieMode&&value.access_token!=='cookie')throw Error('invalid_saved_session');
   return {username:value.username,access_token:value.access_token};
  }catch{client.clear(storage);return null}
 },
 write(storage,session,{cookieMode=false}={}){
  if(typeof session?.username!=='string'||!/^[a-zA-Z0-9_.@-]{3,80}$/.test(session.username)||typeof session.access_token!=='string'||!session.access_token)throw Error('session_missing');
  try{resolveStorage(storage).setItem('smn_session',JSON.stringify({username:session.username,access_token:cookieMode?'cookie':session.access_token}));return true}
  catch{return false}
 },
 clear(storage){try{resolveStorage(storage).removeItem('smn_session');return true}catch{return false}},
 async persist(storage,session,{cookieMode=false,revokePrevious}={}){
  const previous=client.read(storage,{cookieMode});
  if(client.write(storage,session,{cookieMode}))return true;
  // A quota failure must not leave another account's token available on reload.
  // When removal is also blocked, revoke only that old bearer, never the current
  // cookie or the same token being restored.
  const cleared=client.clear(storage);
  if(!cleared&&!cookieMode&&previous?.access_token&&previous.access_token!=='cookie'&&previous.access_token!==session.access_token){
   try{if(typeof revokePrevious!=='function'||await revokePrevious(previous)!==true)throw Error('cleanup_failed')}
   catch{throw Error('previous_session_unconfirmed')}
  }
  return false;
 },
 transport({url,cookieMode,getSession,getGeneration,request,now=performance.now.bind(performance),timeout=op=>AbortSignal.timeout(op==='gnula_token'?45000:20000)}){
  return async function(op,extra={}){
   const session=getSession(),generation=getGeneration();if(!session)throw Error('session_required');
   // Callers can supply operation data, never replace the captured login identity.
   const {username:ignoredUser,password:ignoredPassword,access_token:ignoredToken,browser_cookie:ignoredCookie,op:ignoredOp,...data}=extra;
   // Source preparation has a 35-second server budget; let that bounded request finish.
   const started=now(),result=await request(url,{method:'POST',credentials:cookieMode?'include':'omit',headers:{'content-type':'application/json'},body:JSON.stringify({...data,op,username:session.username,password:session.password,access_token:session.access_token==='cookie'?undefined:session.access_token,browser_cookie:cookieMode===true}),signal:timeout(op)});
   if(generation!==getGeneration()||session!==getSession())throw Error('session_changed');
   if(result&&Number.isFinite(result.server_time))result.network_age_ms=Math.max(0,(now()-started)/2);return result;
  };
 }
};
return client;
})();

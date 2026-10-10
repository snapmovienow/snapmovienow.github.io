// Session persistence and transport contracts, independent of catalog/player/DOM.
globalThis.SMNSessionClient={
 read(storage,{cookieMode=false}={}){
  try{const value=JSON.parse(storage.getItem('smn_session')||'null');if(!value)return null;
   if(typeof value.username!=='string'||!/^[a-zA-Z0-9_.@-]{3,80}$/.test(value.username)||Object.hasOwn(value,'password')||typeof value.access_token!=='string'||!value.access_token||cookieMode&&value.access_token!=='cookie')throw Error('invalid_saved_session');
   return {username:value.username,access_token:value.access_token};
  }catch{try{storage.removeItem('smn_session')}catch{}return null}
 },
 write(storage,session,{cookieMode=false}={}){
  if(!session?.username||!session.access_token)throw Error('session_missing');
  storage.setItem('smn_session',JSON.stringify({username:session.username,access_token:cookieMode?'cookie':session.access_token}));
 },
 transport({url,cookieMode,getSession,getGeneration,request,now=performance.now.bind(performance),timeout=()=>AbortSignal.timeout(20000)}){
  return async function(op,extra={}){
   const session=getSession(),generation=getGeneration();if(!session)throw Error('session_required');
   // Callers can supply operation data, never replace the captured login identity.
   const {username:ignoredUser,password:ignoredPassword,access_token:ignoredToken,browser_cookie:ignoredCookie,op:ignoredOp,...data}=extra;
   const started=now(),result=await request(url,{method:'POST',credentials:cookieMode?'include':'omit',headers:{'content-type':'application/json'},body:JSON.stringify({...data,op,username:session.username,password:session.password,access_token:session.access_token==='cookie'?undefined:session.access_token,browser_cookie:cookieMode===true}),signal:timeout()});
   if(generation!==getGeneration()||session!==getSession())throw Error('session_changed');
   if(result&&Number.isFinite(result.server_time))result.network_age_ms=Math.max(0,(now()-started)/2);return result;
  };
 }
};

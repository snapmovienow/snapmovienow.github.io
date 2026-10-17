// Invoked only behind the existing signed reseller diagnostics action.
const LIMIT=2*1024*1024;
const safeError=e=>/^[a-z_0-9]{1,60}$/.test(e?.message||'')?e.message:'media_probe_unavailable';
export async function probeResellerMedia(env,body,deps){
 const p=body.mediaProbe;
 if(!p||typeof p.accessToken!=='string'||p.accessToken.length>12000||!/^[A-Za-z0-9_.:-]{1,80}$/.test(p.lineId||'')||!/^[a-z0-9_.@-]{3,80}$/.test(p.username||'')||!/^\d{1,14}$/.test(String(p.channelId||''))||!['hls','ts'].includes(p.transport))return Response.json({error:'media_probe_input'},{status:400});
 const session=await deps.unticket(env,p.accessToken);
 if(!session?.managed||session.kind!=='session'||session.username!==p.username||!(await deps.sessionCall(env,session.sid,'/check')).ok)return Response.json({error:'media_probe_session'},{status:403});
 const integrity=await deps.directory(env,'/reseller-integrity',{accountId:body.accountId,lines:[{lineId:p.lineId,username:p.username}]});
 if(!integrity.ok||(await integrity.json()).lines?.[0]?.state!=='present')return Response.json({error:'media_probe_scope'},{status:403});
 let lease,request_id=crypto.randomUUID(),expired=false,operationTimer;const origins=new Set(),started=Date.now();
 const operationDeadline=new Promise((_,reject)=>{operationTimer=setTimeout(()=>{expired=true;reject(Error('media_probe_timeout'));},28000)});
 void operationDeadline.catch(()=>{});
 const get=async url=>{const pending=deps.fetchMedia(url,new Headers({'User-Agent':'SnapMovieNow/1.0','Accept-Encoding':'identity'}),'live',sourceOrigin,{onOrigin:origin=>origins.add(origin)});pending.then(x=>{if(expired)void x.response.body?.cancel().catch(()=>{});},()=>{});const x=await Promise.race([pending,operationDeadline]);if(!x.response.ok){const status=x.response.status;await x.response.body?.cancel();throw Error('media_http_'+status);}return x;};
 const playlistText=async response=>{const reader=response.body?.getReader();if(!reader)throw Error('playlist_empty');let text='',size=0;const decoder=new TextDecoder();try{for(;;){const n=await Promise.race([reader.read(),operationDeadline]);if(n.done)return text+decoder.decode();size+=n.value.byteLength;if(size>262144)throw Error('playlist_too_large');text+=decoder.decode(n.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}};
 let sourceOrigin;
 try{
  // The same catalogue/adult policy and allocation path used by customers.
  const channel=await deps.channel(env,session,String(p.channelId),p.server||'ccf');if(!channel)throw Error('media_probe_channel');
  const begun=await deps.directory(env,'/playback-begin',{sid:session.sid,request_id,revision:1});if(!begun.ok)throw Error('media_probe_session');
  const ext=p.transport==='hls'?'m3u8':'ts',allocation=await deps.allocate(env,{...session,request_id,mediaKey:'live|'+(p.server||'ccf')+'|'+p.channelId+'|'+ext},p.server||'ccf');
  if(!allocation.r.ok)throw Error('media_probe_allocation');lease=(await allocation.r.json()).lease_id;const credential=allocation.credentials;if(!credential)throw Error('media_probe_allocation');
  sourceOrigin=credential.origin||deps.origin;
  let fetched=await get(sourceOrigin+'/live/'+encodeURIComponent(credential.username)+'/'+encodeURIComponent(credential.password)+'/'+p.channelId+'.'+ext),segments=0;
  if(p.transport==='hls'){
   let text=await playlistText(fetched.response),url=fetched.url;
   for(let depth=0;text.includes('#EXT-X-STREAM-INF')&&depth<3;depth++){const child=text.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#'));if(!child)throw Error('playlist_empty');fetched=await get(new URL(child,url).href);url=fetched.url;text=await playlistText(fetched.response);}
   if(!text.startsWith('#EXTM3U'))throw Error('playlist_invalid');if(/#EXT-X-KEY:.*METHOD=(?!NONE)[A-Z0-9-]+/.test(text))throw Error('media_probe_encrypted');
   const rows=text.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#'));segments=rows.length;if(!segments)throw Error('playlist_empty');fetched=await get(new URL(rows.at(-2)||rows[0],url).href);
  }
  const reader=fetched.response.body?.getReader();if(!reader)throw Error('media_empty');const chunks=[];let bytes=0,timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('media_probe_timeout')),12000)});
  try{while(bytes<LIMIT){const n=await Promise.race([reader.read(),deadline,operationDeadline]);if(n.done)break;const chunk=n.value.slice(0,LIMIT-bytes);chunks.push(chunk);bytes+=chunk.length;}}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
  const sample=new Uint8Array(bytes);let at=0;for(const chunk of chunks){sample.set(chunk,at);at+=chunk.length;}let packetSync=false;for(let n=0;n<Math.min(188,sample.length-376);n++)if(sample[n]===71&&sample[n+188]===71&&sample[n+376]===71){packetSync=true;break;}
  if(bytes<1880||!packetSync)throw Error('media_invalid');let raw='';for(let n=0;n<sample.length;n+=8192)raw+=String.fromCharCode(...sample.slice(n,n+8192));
  return Response.json({ok:true,transport:p.transport,sampleBytes:bytes,transportStream:true,playlistSegments:segments,mediaOrigins:[...origins],startupMs:Date.now()-started,probeSample:btoa(raw),creditsSpent:0},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({ok:false,error:safeError(e),transport:p.transport,mediaOrigins:[...origins],startupMs:Date.now()-started,creditsSpent:0});}
 finally{clearTimeout(operationTimer);if(lease)await deps.directory(env,'/release',{sid:session.sid,lease_id:lease,request_id}).catch(()=>{});}
}

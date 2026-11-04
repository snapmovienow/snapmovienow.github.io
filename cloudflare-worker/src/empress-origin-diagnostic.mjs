import {resolveEmpressSource,empressMediaAllowed,empressMediaHeaders,isEmpressPage} from './empress-source.mjs';

// One owner-requested comparison, private DO calls only. No catalog changes,
// customer identity, saved CDN URLs, custom destinations or recurring retries.
export const EMPRESS_DIAGNOSTIC_KEY='owner-empress-origin-diagnostic-20261104-v1';
export const EMPRESS_DIAGNOSTIC_END=Date.parse('2026-11-04T19:00:00Z');
export const diagnosticEnabled=(env,now=Date.now())=>env.ENVIRONMENT==='production'&&env.PLAYBACK_CANARY_ENABLED==='true'&&now<EMPRESS_DIAGNOSTIC_END;
const pages=['https://pelisflix200.rest/episodio/la-emperatriz-divorciada-1x2/','https://tudorama.com/ver/the-remarried-empress-s1x2/'];
const provider=page=>page===pages[0]?'nupload':'voe';
const issue=code=>Object.assign(Error(code),{diagnostic:true});
async function readBody(response,max){
 const reader=response.body?.getReader();if(!reader)return '';let size=0,text='';const decoder=new TextDecoder();
 try{while(size<max){const {done,value}=await reader.read();if(done)break;const bytes=value.subarray(0,max-size);size+=bytes.length;text+=decoder.decode(bytes,{stream:true});}return text+decoder.decode();}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function denialReason(response){
 const body=(await readBody(response,4096)).replace(/<[^>]*>/g,' ');
 if(response.headers.get('cf-mitigated')==='challenge')return 'browser_challenge';
 if(/(?:token|signature|link|session).{0,60}expir|expir.{0,60}(?:token|signature|link|session)/i.test(body))return 'expired_capability';
 if(/(?:invalid|wrong|mismatch).{0,50}(?:ip address|client ip|remote ip)|(?:ip address|client ip|remote ip).{0,50}(?:invalid|wrong|mismatch|denied|not allowed)/i.test(body))return 'ip_restriction';
 if(/(?:invalid|wrong|mismatch).{0,50}(?:token|signature)|(?:token|signature).{0,50}(?:invalid|wrong|mismatch)/i.test(body))return 'invalid_signature';
 if(/(?:referrer|referer|origin).{0,50}(?:denied|invalid|not allowed|mismatch)/i.test(body))return 'origin_restriction';
 if(/geo.{0,20}(?:block|restrict)|country.{0,40}(?:denied|not allowed|block)/i.test(body))return 'geographic_restriction';
 return response.status===403?'forbidden_without_reason':'upstream_http';
}
export async function probeEmpressOrigin(value,{fetcher=fetch}={}){
 if(!pages.includes(value?.page)||!isEmpressPage(value.page)||!empressMediaAllowed(value.page,value.url,value.context))throw issue('diagnostic_scope');
 const reports=[];let target=new URL(value.url),next=null;
 for(let level=0;level<3;level++){
  if(!empressMediaAllowed(value.page,target,value.context))throw issue('diagnostic_scope');
  const response=await fetcher(target.href,{headers:{'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity',...empressMediaHeaders(value.page,value.context)},redirect:'manual',signal:AbortSignal.timeout(15000)});
  const playlist=target.pathname.endsWith('.m3u8'),server=response.headers.get('server')||'';
  const report={level,resource:playlist?'playlist':'media',status:response.status,server:/^nginx/i.test(server)?'nginx':/^cloudflare$/i.test(server)?'cloudflare':'other',networkBindingParameters:target.searchParams.has('i')&&target.searchParams.has('asn')};
  if(!response.ok){report.reason=await denialReason(response);reports.push(report);break;}
  if(!playlist){const bytes=await readBody(response,2048);report.bytesObserved=bytes.length;reports.push(report);break;}
  const text=await readBody(response,1000000);if(!text.trimStart().startsWith('#EXTM3U')){report.reason='invalid_playlist';reports.push(report);break;}
  const child=text.split(/\r?\n/).find(line=>line.trim()&&!line.startsWith('#'));
  reports.push(report);if(!child)break;target=new URL(child.trim(),target);
  if(!empressMediaAllowed(value.page,target,value.context))throw issue('diagnostic_scope');
  if(level===0)next={...value,url:target.href};
 }
 return {reports,next};
}
export async function diagnosticResource(env,body,{unticket,fetcher=fetch}={}){
 if(!diagnosticEnabled(env)||typeof body?.capability!=='string')return Response.json({error:'diagnostic_disabled'},{status:403});
 const value=await unticket(env,body.capability);
 if(value?.kind!=='empress-origin-diagnostic'||!(value.exp>Date.now())||value.exp>Date.now()+120000)return Response.json({error:'diagnostic_scope'},{status:403});
 try{return Response.json({reports:(await probeEmpressOrigin(value,{fetcher})).reports});}catch{return Response.json({error:'diagnostic_unavailable'},{status:502});}
}
export async function runEmpressOriginDiagnostic(store,env,{ticket,delegate,resolve=resolveEmpressSource,fetcher=fetch,log=console.log}={}){
 if(!diagnosticEnabled(env))return;
 const claimed=await store.transaction(async tx=>{if(await tx.get(EMPRESS_DIAGNOSTIC_KEY))return false;await tx.put(EMPRESS_DIAGNOSTIC_KEY,{state:'running',startedAt:Date.now()});return true;});
 if(!claimed)return;
 const results=[];
 for(const page of pages){
  const result={provider:provider(page),episode:2};
  try{
   const source=await resolve(page,{fetcher,signal:AbortSignal.timeout(35000)}),value={page,url:source.url,context:source.empressContext};
   const local=await probeEmpressOrigin(value,{fetcher});result.sameContext=local.reports;
   if(local.next){
    const capability=await ticket(env,{kind:'empress-origin-diagnostic',...local.next,exp:Date.now()+90000});
    const response=await delegate({capability});
    if(response.ok)result.separateContext=(await response.json()).reports;
    else{await response.body?.cancel();result.separateContext=[{reason:'diagnostic_unavailable',status:response.status}];}
   }
  }catch{result.reason='diagnostic_unavailable';}
  results.push(result);log({event:'empress_origin_diagnostic',...result});
 }
 await store.put(EMPRESS_DIAGNOSTIC_KEY,{state:'complete',finishedAt:Date.now(),results});
 return results;
}

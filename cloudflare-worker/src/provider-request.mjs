import {CCF_MEDIA_ORIGIN,isCcfMediaEntry,fetchApprovedMediaIP} from './ip-media.mjs';
const failure=code=>Object.assign(Error('provider_unavailable'),{failureCode:code});
// Account status uses the same explicit entry transport as video. The whole
// request, including a fragmented JSON body, owns one cancellable deadline.
export async function readProviderJSON(value,{timeoutMs=2500,signal,directCcfEntry=false,maxBytes=65536,fetchHost=fetch,fetchSocket=fetchApprovedMediaIP}={}){
 if(signal?.aborted)throw Error('playback_superseded');
 const budgetMs=Math.max(1,Math.ceil(timeoutMs)),url=new URL(value),controller=new AbortController(),deadline=Date.now()+budgetMs;let response,reader,timer,rejectAbort;
 const aborted=new Promise((_,reject)=>{rejectAbort=reject});
 const stop=reason=>{controller.abort(reason);rejectAbort(reason)};
 const onAbort=()=>stop(Error('playback_superseded'));signal?.addEventListener('abort',onAbort,{once:true});
 timer=setTimeout(()=>stop(Error('provider_validation_timeout')),budgetMs);
 const within=promise=>Promise.race([promise,aborted]);
 try{
  const headers=new Headers({'User-Agent':'SnapMovieNow/1.0','Accept-Encoding':'identity'});
  const requestSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(budgetMs),...(signal?[signal]:[])]);
  const request=directCcfEntry&&isCcfMediaEntry(url,CCF_MEDIA_ORIGIN)?fetchSocket(url.href,headers,undefined,undefined,CCF_MEDIA_ORIGIN,deadline):fetchHost(url.href,{headers,signal:requestSignal});
  Promise.resolve(request).then(r=>{if(controller.signal.aborted)void r?.body?.cancel().catch(()=>{})},()=>{});
  response=await within(request);if(!response.ok)throw failure('http_error');
  reader=response.body?.getReader();if(!reader)throw failure('invalid_reply');
  const maximum=Number.isSafeInteger(maxBytes)&&maxBytes>0?Math.min(16777216,maxBytes):65536,decoder=new TextDecoder();let size=0,text='';
  for(;;){const next=await within(reader.read());if(next.done)break;size+=next.value.byteLength;if(size>maximum)throw failure('invalid_reply');text+=decoder.decode(next.value,{stream:true})}
  text+=decoder.decode();try{return JSON.parse(text)}catch{throw failure('invalid_reply')}
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();
  if(reader)void reader.cancel().catch(()=>{});else if(response?.body)void response.body.cancel().catch(()=>{});
 }
}

import {chooseLqsaSeries} from './lqsa-import.mjs';
import {matchesLqsaTitle} from './series-supplement.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const terminal=state=>state==='completed'||state==='failed';
const safeCover=value=>{
 if(typeof value!=='string'||value.length>2048)return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!/[?&](?:username|password|token|signature)=/i.test(url.search)?url.href:'';}catch{return '';}
};
function candidatesFrom(rows){
 if(!Array.isArray(rows)||rows.length>50000||rows.some(row=>!object(row)||typeof row.name!=='string'||row.name.length>1000))throw Error('invalid_catalog');
 const selected=rows.filter(row=>matchesLqsaTitle(row.name));if(selected.length>8)throw Error('invalid_catalog');
 return selected.map(row=>({name:row.name.trim(),_server:typeof row._server==='string'&&row._server.length<=80?row._server:'',
  series_id:(typeof row.series_id==='string'||Number.isSafeInteger(row.series_id))&&String(row.series_id).length<=20?String(row.series_id):'',
  cover:safeCover(row.cover),...(Number.isInteger(Number(row.year))&&Number(row.year)>=1880&&Number(row.year)<=2200?{year:Number(row.year)}:{})}));
}
function detailFrom(value){
 if(!object(value)||!object(value.episodes)&&!Array.isArray(value.episodes)||Array.isArray(value.episodes)&&value.episodes.length>50000||object(value.episodes)&&Object.keys(value.episodes).length>512||value.info!==undefined&&!object(value.info))return null;
 const source=value.info||{},info={};
 if(source.name!==undefined){if(typeof source.name!=='string'||source.name.length>180)return null;info.name=source.name;}
 if(typeof source.cover==='string')info.cover=safeCover(source.cover);
 if(typeof source.plot==='string')info.plot=source.plot.slice(0,3000);
 if(Number.isInteger(Number(source.year))&&Number(source.year)>=1880&&Number(source.year)<=2200)info.year=Number(source.year);
 // This is a metadata handoff, never a copy or replacement of provider episodes.
 return {info,episodes:{}};
}
async function smallJSON(response){
 if(!response?.ok){await response?.body?.cancel();throw Error('private_job_unavailable');}
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>16000)){await response.body?.cancel();throw Error('private_job_unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('private_job_unavailable');let text='',bytes=0;const decoder=new TextDecoder();
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>16000){await reader.cancel();throw Error('private_job_unavailable');}text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}
 finally{reader.releaseLock();}
}
async function within(operation,ms){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('bootstrap_timeout')),ms)})]);}finally{clearTimeout(timer);}}

// The only inputs are trusted runtime dependencies. Public requests cannot
// choose the series, source, credentials or maintenance operation.
export function createLqsaBootstrap({directory,catalogFactory,now=Date.now,retryMs=300000,timeoutMs=12000}={}){
 let attempted=false,pending=false,done=false,attempts=0,lastAttempt=0;
 return (env,ctx,{force=false}={})=>{
  if(env?.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true'||typeof ctx?.waitUntil!=='function'||typeof directory!=='function'||typeof catalogFactory!=='function'||done||pending||attempts>=3||attempted&&(!force||now()-lastAttempt<retryMs))return;
  attempted=true;pending=true;attempts++;lastAttempt=now();let phase='status';
  const work=(async()=>{
   const status=await within(async()=>smallJSON(await directory(env,'/lqsa-import-status')),timeoutMs);
   if(!object(status)||!['pending','running','completed','failed'].includes(status.state))throw Error('private_job_unavailable');
   if(terminal(status.state)){done=true;return;}
   if(status.state==='running'&&Number.isSafeInteger(status.attempts)&&status.attempts>=3)return;
   phase='catalog';const catalog=catalogFactory(env,ctx);if(typeof catalog!=='function')throw Error('invalid_catalog');
   const candidates=candidatesFrom(await within(()=>catalog('get_series',undefined,{}, {fresh:true}),timeoutMs));
   let chosen=null,details=null;
   try{chosen=chooseLqsaSeries(candidates);}catch{/* Let the private job record missing or ambiguous identity. */}
   if(chosen){
    phase='details';
    try{details=detailFrom(await within(()=>catalog('get_series_info',chosen._server,{series_id:String(chosen.series_id)},{fresh:true}),timeoutMs));}catch{/* The private job records the bounded catalog retry. */}
   }
   phase='private_job';const body={candidates,details,...(chosen?{server:chosen._server,seriesId:String(chosen.series_id)}:{})};
   if(JSON.stringify(body).length>32000)throw Error('invalid_payload');
   const result=await within(async()=>smallJSON(await directory(env,'/lqsa-import-run',body)),timeoutMs);
   if(object(result)&&terminal(result.state))done=true;
  })().catch(()=>console.error({event:'lqsa_bootstrap',phase,reason:'private_job_unavailable'})).finally(()=>{pending=false;});
  ctx.waitUntil(work);
 };
}

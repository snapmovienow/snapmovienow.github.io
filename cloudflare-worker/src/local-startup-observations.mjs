import {LOCAL_TV_CHANNELS} from './official-live.mjs';
const KEY='local-tv-startup-observations-v1',WINDOW=3600000;
// Fixed channel/stage cardinality. Never persist viewer identifiers, source
// addresses, tickets or individual request traces in the public summary.
export async function recordLocalStartup(store,id,stage,durationMs,now=Date.now()){
 if(!LOCAL_TV_CHANNELS.some(c=>c.id===id)||!['playlist','firstVideoBytes'].includes(stage)||!Number.isFinite(durationMs)||durationMs<0||durationMs>120000)return false;
 const data=await store.get(KEY)||{},key=id+':'+stage,old=data[key],sample=old&&now-old.since<WINDOW?old:{since:now,count:0,totalMs:0,maxMs:0};
 data[key]={...sample,count:sample.count+1,totalMs:sample.totalMs+Math.round(durationMs),lastMs:Math.round(durationMs),maxMs:Math.max(sample.maxMs,Math.round(durationMs)),observedAt:now};
 for(const [k,v]of Object.entries(data))if(now-v.observedAt>=WINDOW)delete data[k];
 await store.put(KEY,data);return true;
}
export async function localStartupSummary(store,now=Date.now()){
 const data=await store.get(KEY)||{},channels=[];
 for(const channel of LOCAL_TV_CHANNELS){const stages={};for(const stage of ['playlist','firstVideoBytes']){const value=data[channel.id+':'+stage];if(value&&now-value.observedAt<WINDOW)stages[stage]={samples:value.count,lastMs:value.lastMs,meanMs:Math.round(value.totalMs/value.count),maxMs:value.maxMs,observedAt:new Date(value.observedAt).toISOString()};}if(Object.keys(stages).length)channels.push({id:channel.id,...stages});}
 return {windowSeconds:WINDOW/1000,measurement:'server_start_to_playlist_or_first_video_bytes_not_rendered_frame',channels};
}
// Preserve streaming and cancellation; the report never delays a video chunk.
export function observeFirstChunk(body,report){
 if(!body)return body;const reader=body.getReader();let observed=false;
 return new ReadableStream({async pull(controller){try{const {done,value}=await reader.read();if(done){controller.close();reader.releaseLock();return;}if(value?.byteLength&&!observed){observed=true;try{report()}catch{}}controller.enqueue(value);}catch(error){controller.error(error);reader.releaseLock();}},async cancel(reason){try{await reader.cancel(reason)}finally{reader.releaseLock()}}},{highWaterMark:0});
}

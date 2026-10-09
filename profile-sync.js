globalThis.SMNProfiles={create({api,local,onData,onPersist=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let stopped=false,remoteAvailable=true,timer,pending=new Map(),records=new Map(),favoriteKeys=new Set(),running=null;
 const unavailable=e=>['operation_not_allowed','managed_profile_required'].includes(e?.code||e?.message);
 const localRows=local();
 const key=p=>p.kind+':'+p.key;
 const merge=rows=>{for(const p of rows||[]){const old=records.get(key(p));if(!old||p.updatedAt>=old.updatedAt)records.set(key(p),p)}onData([...records.values()])};
 const queue=p=>{if(stopped)return;pending.set(key(p),p);records.set(key(p),p);onPersist([...records.values()]);cancel(timer);if(remoteAvailable)timer=schedule(()=>flush(),1200)};
 async function flush(){
  if(stopped||!remoteAvailable)return;if(running)return running;
  const batch=[...pending.values()].slice(0,160);if(!batch.length)return;
  running=(async()=>{try{const response=await api('profile_patch',{patches:batch});if(stopped)return;for(const p of batch)if(pending.get(key(p))===p)pending.delete(key(p));merge(response.records)}catch(e){if(unavailable(e))remoteAvailable=false;/* Local playback/progress remains usable offline. */}finally{running=null;if(!stopped&&remoteAvailable&&pending.size){cancel(timer);timer=schedule(()=>flush(),15000)}}})();return running;
 }
 const initial=Promise.resolve().then(async()=>{
  if(stopped)return;
  for(const p of localRows)records.set(key(p),p);merge([]);
  try{const response=await api('profile_get');if(stopped)return;
   const remote=new Map((response.records||[]).map(p=>[key(p),p]));
   merge(response.records);for(const p of localRows){const old=remote.get(key(p));if(!old||p.updatedAt>old.updatedAt)queue(p)}await flush();
  }catch(e){if(unavailable(e))remoteAvailable=false;if(!stopped)for(const p of localRows)queue(p)}
 });
 return {
  initial,flush,async refresh(){if(stopped||!remoteAvailable)return;try{const response=await api('profile_get');if(!stopped)merge(response.records)}catch(e){if(unavailable(e))remoteAvailable=false}},
  favorites(rows){const next=new Set(rows.map(p=>p.key));for(const old of favoriteKeys)if(!next.has(old))queue({kind:'favorite',key:old,deleted:true,updatedAt:Date.now()});for(const p of rows)if(!favoriteKeys.has(p.key))queue({...p,kind:'favorite',updatedAt:Date.now()});favoriteKeys=next},
  rememberFavorites(rows){favoriteKeys=new Set(rows.map(p=>p.key))},
  progress(p){queue({...p,kind:'progress',updatedAt:Date.now()})},
  removeProgress(id){queue({kind:'progress',key:id,deleted:true,updatedAt:Date.now()})},
  preference(name,value){queue({kind:'preference',key:name,value,updatedAt:Date.now()})},
  preferenceValue(name){const p=records.get('preference:'+name);return p&&!p.deleted?p.value:null},
  stop(){stopped=true;cancel(timer);pending.clear();records.clear()}
 };
}};

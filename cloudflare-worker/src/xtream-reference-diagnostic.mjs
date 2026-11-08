// Exact-key registry reads only. Registry evidence does not prove catalog freshness or media health.
const kinds=new Set(['live','movie','series_list','episode']);
const id=value=>(typeof value==='string'||Number.isSafeInteger(value))&&/^\d{1,16}$/.test(String(value));
const server=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
function normalize(query){
 if(!query||typeof query!=='object'||Array.isArray(query))return null;
 const keys=Object.keys(query).sort().join(',');
 if(keys==='publicId'&&id(query.publicId))return {publicId:String(query.publicId)};
 if(keys==='kind,server,upstreamId'&&kinds.has(query.kind)&&server(query.server)&&id(query.upstreamId))return {kind:query.kind,server:query.server,upstreamId:String(query.upstreamId)};
 return null;
}
function projection(record){
 if(!record||!kinds.has(record.kind)||!id(record.id)||!id(record.upstreamId)||!server(record.server))return null;
 return {publicId:String(record.id),kind:record.kind,server:record.server,upstreamId:String(record.upstreamId)};
}
export async function readXtreamReferences(store,queries,now=Date.now()){
 const normalized=Array.isArray(queries)&&queries.length>0&&queries.length<=10?queries.map(normalize):[];
 if(!normalized.length||normalized.some(q=>!q))return {error:'invalid_reference_queries'};
 const references=[];
 for(const query of normalized){
  const publicId=query.publicId??await store.get('xtream-map:'+query.kind+':'+query.server+':'+query.upstreamId);
  if(publicId===undefined||publicId===null){references.push({query,state:'not_registered'});continue;}
  if(!id(publicId)){references.push({query,state:'registry_inconsistent'});continue;}
  const record=await store.get('xtream-id:'+publicId),value=projection(record);
  if(!value){references.push({query,state:record===undefined||record===null?(query.publicId?'not_registered':'registry_inconsistent'):'registry_inconsistent'});continue;}
  if(value.publicId!==String(publicId)||!query.publicId&&(value.kind!==query.kind||value.server!==query.server||value.upstreamId!==query.upstreamId)){
   references.push({query,state:'registry_inconsistent'});continue;
  }
  if(query.publicId&&String(await store.get('xtream-map:'+value.kind+':'+value.server+':'+value.upstreamId))!==value.publicId){references.push({query,state:'registry_inconsistent'});continue;}
  references.push({query,state:'registered',reference:value});
 }
 return {generatedAt:now,evidence:'stored_registry',catalogCurrentVerified:false,mediaHealthVerified:false,references};
}

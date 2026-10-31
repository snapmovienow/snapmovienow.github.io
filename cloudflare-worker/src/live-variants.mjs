import {markAdultRows} from './content-permissions.mjs';

// Remove only the source/quality suffixes used by the provider. Channel numbers,
// countries, regional names, MAX and '+' remain part of the channel identity.
export function liveChannelIdentity(name){
 if(typeof name!=='string'||name.length>200||/[\u0000-\u001f]|https?:\/\//i.test(name))return null;
 const base=name.normalize('NFKC').replace(/(?:\s*\((?:L|M|TV|W|SD|HD|FHD|UHD|4K|720|1080|2160)\))+\s*$/i,'').trim().replace(/\s+/g,' ').toLowerCase();
 return base.length>=3?base:null;
}
export function liveVariantCandidates(rows,categories,item,permissions={}){
 if(!Array.isArray(rows)||!Array.isArray(categories)||permissions.tv===false)return [];
 const server=String(item.server||'ccf'),id=String(item.upstreamId),sameServer=row=>String(row._server||'ccf')===server;
 const original=rows.filter(row=>sameServer(row)&&String(row.stream_id)===id);
 if(original.length!==1)return [];
 const selected=original[0],key=liveChannelIdentity(selected.name),category=String(selected.category_id??'');
 if(!key||!/^\d{1,16}$/.test(category)||!categories.some(row=>sameServer(row)&&String(row.category_id)===category))return [];
 const group=rows.filter(row=>sameServer(row)&&String(row.category_id)===category&&liveChannelIdentity(row.name)===key);
 const allowed=permissions.adults===false?markAdultRows(group,categories).filter(row=>!row._adult):group;
 if(!allowed.some(row=>String(row.stream_id)===id))return [];
 const seen=new Set([id]),result=[];
 for(const row of allowed){const next=String(row.stream_id);if(!/^\d{1,16}$/.test(next)||seen.has(next))continue;seen.add(next);result.push({...item,upstreamId:next});if(result.length===8)break;}
 return result;
}
// Load only already verified catalog snapshots, and only after an actual 404.
// Ordinary success, account errors and diagnostics never start variant lookups.
export function createLiveVariantFallback(catalog,item,permissions){
 let candidates;
 return async status=>{
  if(status!==404||item.type!=='live'||!catalog)return null;
  candidates??=Promise.all(['get_live_streams','get_live_categories'].map(action=>catalog(action,item.server||'ccf',{}, {cachedOnly:true})))
   .then(([rows,categories])=>liveVariantCandidates(rows,categories,item,permissions)).catch(()=>[]);
  return (await candidates).shift()||null;
 };
}

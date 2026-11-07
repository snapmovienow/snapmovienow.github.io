import {markAdultRows} from './content-permissions.mjs';
import {cleanPlaybackActivity} from './playback-activity.mjs';

export const LIVE_FAILURE_ATTEMPTS=5;
export const LIVE_NEXT_LIMIT=8;
export const nextChannelFailure=status=>status===404||status===408||status===429||status>=500&&status<=599;

// Catalog order is scoped to the same provider and category. No cross-provider
// category IDs, adult access changes, URLs or synthetic claims of a live signal.
export function liveNextChannelCandidates(rows,categories,item,permissions={},visited=new Set()){
 if(item.type!=='live'||permissions.tv===false||!Array.isArray(rows)||!Array.isArray(categories))return [];
 const server=String(item.server||'ccf'),same=row=>String(row._server||'ccf')===server,id=String(item.upstreamId);
 const matches=rows.filter(row=>same(row)&&String(row.stream_id)===id);if(matches.length!==1)return [];
 const selected=matches[0],category=String(selected.category_id??'');
 if(!/^\d{1,16}$/.test(category)||!categories.some(row=>same(row)&&String(row.category_id)===category))return [];
 const allowed=permissions.adults===false?markAdultRows(rows,categories).filter(row=>!row._adult):rows;
 if(!allowed.includes(selected)&&!allowed.some(row=>same(row)&&String(row.stream_id)===id))return [];
 const group=allowed.filter(row=>same(row)&&String(row.category_id)===category),at=group.findIndex(row=>String(row.stream_id)===id);
 if(at<0)return [];
 const seen=new Set([id,...visited]),result=[];
 for(let offset=1;offset<group.length;offset++){
  const row=group[(at+offset)%group.length],next=String(row.stream_id);
  if(!/^\d{1,16}$/.test(next)||seen.has(next))continue;seen.add(next);
  const activity=cleanPlaybackActivity({title:row.name||row.title},'live');
  const candidate={...item,upstreamId:next};delete candidate.activity;if(activity)candidate.activity=activity;
  result.push(candidate);if(result.length===LIVE_NEXT_LIMIT)break;
 }
 return result;
}

// A failed signal is required before reading existing snapshots. This never
// downloads a new catalog and never probes customer media speculatively.
export async function cachedNextChannels(catalog,item,permissions,visited){
 try{
  const [rows,categories]=await Promise.all(['get_live_streams','get_live_categories'].map(action=>catalog(action,item.server||'ccf',{}, {cachedOnly:true})));
  return liveNextChannelCandidates(rows,categories,item,permissions,visited);
 }catch{return [];}
}

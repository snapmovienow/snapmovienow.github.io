// Bounded metadata for the owner's existing alert destination. This is context
// from the same media type/window, never proof that every failure is this item.
export function mediaFailureContext(items,type,server,now){
 const lines=[],seen=new Set();
 for(const row of Array.isArray(items)?items:[]){
  if(row?.type!==type||server&&row.server!==server||!Number.isFinite(row.lastObservedAt)||row.lastObservedAt>now||row.lastObservedAt<=now-15*60000)continue;
  if(!/^\d{1,16}$/.test(row.id||'')||!/^[a-zA-Z0-9_-]{1,80}$/.test(row.server||''))continue;
  const statuses=[...new Set((Array.isArray(row.httpStatuses)?row.httpStatuses:[]).filter(s=>Number.isInteger(s)&&s>=400&&s<=599))].slice(0,3);if(!statuses.length)continue;
  const key=row.server+':'+row.id;if(seen.has(key))continue;seen.add(key);
  let title=typeof row.title==='string'?row.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,60):'';
  if(/(?:https?:\/\/|password=|username=|access_token=)/i.test(title))title='';
  const line='ID '+row.id+' · '+(title||'Nombre no disponible')+' · HTTP '+statuses.join(', ')+' · '+new Date(row.lastObservedAt).toISOString();
  if(new TextEncoder().encode([...lines,line].join('\n')).length>600)break;
  lines.push(line);if(lines.length>=3)break;
 }
 return lines.join('\n');
}

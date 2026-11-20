import {exclusivePublic} from './exclusive-catalog.mjs';
import {comedySeriesEntries,comedyDefinitionForTitle,COMEDY_SERIES_CATEGORY} from './comedy-series-xtream.mjs';

export const COMEDY_NATIVE_CATEGORY='smn-comedy-series';
export const comedyNativeList=(op,server)=>['series','series_categories'].includes(op)&&(!server||server==='exclusive');

// These are normal Series rows for native/web clients. Their existing exclusive
// detail and playback protocol remains responsible for permission and lease
// checks; neither source pages nor resolved media URLs enter catalogue replies.
export function comedyNativeCatalog({op,rows,items,permissions,origin='',server}={}){
 if(!comedyNativeList(op,server)||!Array.isArray(rows))return rows;
 const entries=comedySeriesEntries(items,permissions);
 if(!entries.length)return rows;
 if(op==='series_categories'){
  const category={category_id:COMEDY_NATIVE_CATEGORY,category_name:COMEDY_SERIES_CATEGORY,parent_id:0,_server:'exclusive'};
  return rows.some(row=>row?._server==='exclusive'&&String(row.category_id)===COMEDY_NATIVE_CATEGORY)?rows:rows.concat(category);
 }
 const ids=new Set(entries.map(entry=>entry.definition.id));
 // Existing IDs are only omitted from this reply while the complete replacement
 // is visible. We never delete provider records or rewrite their saved IDs.
 const output=rows.filter(row=>!ids.has(comedyDefinitionForTitle(row?.name)?.id));
 return output.concat(entries.map(({row,definition})=>({...exclusivePublic(row,origin),name:definition.name,_server:'exclusive',category_id:COMEDY_NATIVE_CATEGORY,genre:'Comedia'})));
}

// Existing accounts retain their access until an administrator changes it.
export function contentPermissions(value) {
  return {movies:value?.movies !== false, series:value?.series !== false,
    tv:value?.tv !== false, adults:value?.adults !== false};
}

const positive = value => value === true || value === 1 || value === '1' || value === 'true';
const adultLabel = value => /(?:\b(?:adult[oa]s?|adults?|xxx|porn(?:o|ografia|ography)?|erotic[ao]?s?|playboy|hustler|brazzers|sextreme)\b|\+\s*18\b|\b18\s*\+)/i.test(
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/_/g, ' '));

export function isAdult(item) {
  return !!item && (['_adult','is_adult','adult','adult_content','isAdult'].some(key => positive(item[key])) ||
    ['name','title','category_name','group_title','genre'].some(key => adultLabel(item[key])));
}

const specs = {
  live:['get_live_streams','get_live_categories','stream_id'],
  movie:['get_vod_streams','get_vod_categories','stream_id'],
  series_list:['get_series','get_series_categories','series_id']
};
const rowKey = (server, id) => String(server || 'ccf') + ':' + String(id);
const idsFor = row => [...new Set([row.category_id, ...(Array.isArray(row.category_ids) ? row.category_ids : [])].filter(id => id != null).map(String))];
const categoryIndexes=new WeakMap(),rowIndexes=new WeakMap();
function adultCategories(categories){
  if(categoryIndexes.has(categories))return categoryIndexes.get(categories);
  const adult=new Set(categories.filter(isAdult).map(row=>rowKey(row._server,row.category_id)));
  let changed=true;while(changed){changed=false;for(const row of categories){const key=rowKey(row._server,row.category_id);if(!adult.has(key)&&Number(row.parent_id)>0&&adult.has(rowKey(row._server,row.parent_id))){adult.add(key);changed=true}}}
  categoryIndexes.set(categories,adult);return adult;
}
function findRow(rows,idField,server,id){
  let indexes=rowIndexes.get(rows);if(!indexes)rowIndexes.set(rows,indexes=new Map());
  if(!indexes.has(idField)){const index=new Map();for(const row of rows){const key=rowKey(row._server,row[idField]);if(!index.has(key))index.set(key,row)}indexes.set(idField,index)}
  return indexes.get(idField).get(rowKey(server,id));
}

// Category IDs are scoped to a provider. An innocuous title inside an adult
// category inherits the restriction, including nested categories.
export function markAdultRows(rows, categories = []) {
  const adult = adultCategories(categories);
  return rows.map(row => ({...row, _adult:isAdult(row) || idsFor(row).some(id => adult.has(rowKey(row._server, id)))}));
}

export function createAdultPolicy(catalog,inspectSnapshot=catalog.inspect) {
  const lists = new Map();
  const source = async (kind,server) => {
    const key=kind+'|'+String(server||'ccf');
    if (!lists.has(key)) lists.set(key, (async () => {
      const [action, categoryAction] = specs[kind];
      const [rows, categories] = await Promise.all([catalog(action,server), catalog(categoryAction,server)]);
      if (!Array.isArray(rows) || !Array.isArray(categories)) throw Error('invalid_catalog');
      return {rows,adult:adultCategories(categories)};
    })());
    return lists.get(key);
  };
  const inspect = async (kind, server, id) => {
    if(inspectSnapshot){const selected=await inspectSnapshot(kind,server,id);if(selected!==undefined)return selected;}

    const {rows,adult}=await source(kind,server),row=findRow(rows,specs[kind][2],server,id);
    return row?{_adult:isAdult(row)||idsFor(row).some(id=>adult.has(rowKey(row._server,id)))}:null;
  };
  const allowed = async record => {
    if (record.kind === 'episode') {
      // Old cached app IDs must refresh series details to establish parentage.
      if (!record.parentId) return false;
      const parent = await inspect('series_list', record.server, record.parentId);
      if (!parent || parent._adult) return false;
      const details = await catalog('get_series_info', record.server, {series_id:record.parentId});
      if (isAdult(details.info)) return false;
      return Object.values(details.episodes || {}).flatMap(rows=>Array.isArray(rows)?rows:rows&&typeof rows==='object'?[rows]:[]).some(ep =>
        ep&&String(ep.id) === String(record.upstreamId) && !isAdult(ep) && !isAdult(ep.info));
    }
    const row = await inspect(record.kind, record.server, record.upstreamId);
    return !!row && !row._adult;
  };
  const filter = async (action, rows) => {
    const kind = Object.keys(specs).find(key => specs[key].includes(action));
    if (!kind) return rows;
    const categories = await catalog(specs[kind][1]);
    if (!Array.isArray(categories)) throw Error('invalid_catalog');
    return markAdultRows(rows, categories).filter(row => !row._adult);
  };
  return {allowed, filter};
}

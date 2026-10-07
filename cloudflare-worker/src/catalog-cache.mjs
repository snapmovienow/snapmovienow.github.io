// Durable, credential-free snapshots. Each stored chunk stays below the
// Durable Object value limit; readers survive Worker isolate replacement.
const TTL = 12 * 3600000;
const MAX_BYTES = 2 * 1024 * 1024;
const CHUNK = 48000;
const keyValid = key => /^[a-f0-9]{64}$/.test(key);
const chunkKey = (key, generation, i) => `catalog-cache:${key}:${generation}:${i}`;
const join = parts => {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) {bytes.set(part, offset); offset += part.length}
  return bytes;
};
export async function encodeCatalog(data) {
  return new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
export async function decodeCatalog(response) {
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}
export async function catalogCacheRoute(store, path, body) {
  if (!keyValid(body.key)) return Response.json({error:'invalid_cache_key'},{status:400});
  const indexKey = 'catalog-cache-index';
  if (path === '/xtream-cache-get') {
    const index = await store.get(indexKey) || {}, saved = index[body.key];
    if (!saved || saved.until <= Date.now()) return new Response(null,{status:404});
    const keys = Array.from({length:saved.chunks},(_,i)=>chunkKey(body.key,saved.generation,i));
    const found = await store.get(keys), parts = keys.map(key=>found.get(key));
    if (parts.some(part=>!part)) return new Response(null,{status:404});
    return new Response(join(parts),{headers:{'content-type':'application/octet-stream','x-catalog-saved-at':String(saved.savedAt)}});
  }
  if (path !== '/xtream-cache-put') return new Response(null,{status:404});
  let bytes; try {bytes=Uint8Array.from(atob(body.content),c=>c.charCodeAt(0))} catch {return new Response(null,{status:400})}
  if (!bytes.length || bytes.length > MAX_BYTES) return new Response(null,{status:413});
  // Publish the index only after every chunk has been written. Concurrent
  // updates cannot expose a partially written or mixed snapshot.
  return store.transaction(async tx=>{
    const index = await tx.get(indexKey) || {}, generation = crypto.randomUUID();
    const remove = async (key, saved) => {for(let i=0;i<saved.chunks;i++)await tx.delete(chunkKey(key,saved.generation,i));delete index[key]};
    if(index[body.key])await remove(body.key,index[body.key]);
    for(const [key,saved] of Object.entries(index))if(saved.until<=Date.now())await remove(key,saved);
    while(Object.keys(index).length>=64 || Object.values(index).reduce((n,s)=>n+s.bytes,0)+bytes.length>16*1024*1024){
      const [key,saved]=Object.entries(index).sort((a,b)=>a[1].savedAt-b[1].savedAt)[0];await remove(key,saved);
    }
    const chunks=Math.ceil(bytes.length/CHUNK);
    for(let i=0;i<chunks;i++)await tx.put(chunkKey(body.key,generation,i),bytes.slice(i*CHUNK,(i+1)*CHUNK));
    index[body.key]={generation,chunks,bytes:bytes.length,savedAt:Date.now(),until:Date.now()+TTL};
    await tx.put(indexKey,index);return Response.json({ok:true});
  });
}

// Run a local, temporary, on-disk fixture through the Worker playlist and media paths.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve, sep} from 'node:path';
import {appleFragmentPlaylist, createAppleFragments} from '../src/apple-live-fragments.mjs';
import {convertWithModule} from '../src/codec-runtime.mjs';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw Error('usage: fixture source/index.m3u8 output_directory');
const origin = dirname(resolve(source));
await mkdir(output, {recursive:true});
const module = await WebAssembly.compile(await readFile(new URL('../src/apple-segment-codec.wasm',import.meta.url)));
const frags = createAppleFragments((bytes, opts) => convertWithModule(module,bytes,opts));
const items = [];
const playlist = await appleFragmentPlaylist(await readFile(source,'utf8'), async (uri,seq,part,meta) => {
  if (uri !== basename(uri) || resolve(origin,uri).startsWith(origin+sep) === false) throw Error('local_relative_segment_required');
  const target = part+'-'+seq+(part==='init'?'.mp4':'.m4s');
  items.push({uri,seq,part,target,epochMs:meta.epochMs});
  return target;
});
if (!playlist) throw Error('ineligible_test_playlist');
for (const entry of items.sort((a,b)=>a.seq-b.seq)) {
  const {uri,seq,part,target,epochMs} = entry;
  const req = new Request('https://example.test/'+target);
  const out = await frags(req,{sid:'fixture',lease_id:'fixture',request_id:'fixture',exp:Date.now()+3600000,resource:uri,appleSequence:seq,appleEpoch:epochMs,applePart:part},async()=>new Response(await readFile(resolve(origin,uri))));
  if(out.status!==200)throw Error('fragment_failed');
  await writeFile(resolve(output,target),new Uint8Array(await out.arrayBuffer()));
}
await writeFile(resolve(output,'index.m3u8'),playlist);

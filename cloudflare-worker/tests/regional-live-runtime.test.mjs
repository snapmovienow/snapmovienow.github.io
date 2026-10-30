import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {REGIONAL_CHANNELS} from '../src/official-live.mjs';
import {regionalFixture} from './regional-live-fixture.mjs';
const source=`import {REGIONAL_CHANNELS} from '../src/official-live.mjs';import {inspectCatalogSource} from '../src/catalog-source-check.mjs';export default {async fetch(){return Response.json(await Promise.all(REGIONAL_CHANNELS.map(async c=>({id:c.id,...await inspectCatalogSource({mode:'gnula',page:c.page})}))))}};`;
const compiled=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});let reads=0;
const mf=new Miniflare(convertV4MiniflareOptions({name:'regional-live-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-03',outboundService:async req=>{reads++;assert.equal(req.headers.get('Authorization'),null);assert.equal(req.headers.get('Cookie'),null);const r=regionalFixture(req);assert.ok(r);return r;}}));
try{await mf.ready;const result=await(await mf.dispatchFetch('https://local.test/probe')).json();assert.equal(result.length,REGIONAL_CHANNELS.length);assert.ok(result.every(r=>r.ok),JSON.stringify(result));assert.ok(reads>30);console.log('PASS: real workerd public regional player parsing, supported redirects, ad-stitched manifests, init/map and segment byte verification.');}finally{await mf.dispose()}

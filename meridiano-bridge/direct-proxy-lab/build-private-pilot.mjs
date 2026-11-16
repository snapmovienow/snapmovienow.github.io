import {build} from 'esbuild';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url)),output=process.argv[2];
if(!output||!isAbsolute(output))throw Error('Pass an absolute output file path');
const entry=process.argv[3]==='--verified'?'pilot-verified-entry.mjs':'pilot-media-entry.mjs';
await build({entryPoints:[join(base,entry)],bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022',
  external:['cloudflare:sockets'],loader:{'.pem':'text'},alias:{crypto:join(base,'cloudflare-webcrypto.mjs')},outfile:output,logLevel:'warning'});

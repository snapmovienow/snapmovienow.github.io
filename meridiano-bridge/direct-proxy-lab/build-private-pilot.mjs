import {build} from 'esbuild';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url)),output=process.argv[2];
if(!output||!isAbsolute(output))throw Error('Pass an absolute output file path');
const mode=process.argv[3]??'--private-only';
const entries={'--private-only':'pilot-private-only-entry.mjs','--verified':'pilot-verified-entry.mjs'};
if(!Object.hasOwn(entries,mode))throw Error('Use --private-only or --verified');
const entry=entries[mode];
await build({entryPoints:[join(base,entry)],bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022',
  external:['cloudflare:sockets'],loader:{'.pem':'text'},alias:{crypto:join(base,'cloudflare-webcrypto.mjs')},outfile:output,logLevel:'warning'});

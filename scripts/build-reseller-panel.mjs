// Operator build: produce static public assets from the reviewed reseller UI.
// No runtime environment or customer database is read by this build.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]||'../snaptvnow-resellers');
const require=createRequire(root+'/package.json'),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const result=await build({entryPoints:[root+'/app/portal-shell.tsx'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true,define:{'process.env.NODE_ENV':'"production"'},nodePaths:[root+'/node_modules'],jsx:'automatic'});
const js=result.outputFiles[0].text,css=readFileSync(root+'/app/globals.css','utf8'),icon=readFileSync(root+'/public/favicon.svg','utf8');
if(js.includes('OAI-Sites-Authorization')||js.includes('SNAPTVNOW_PORTAL_GATEWAY_SECRET')||js.includes('LINE_CREDENTIAL_KEY'))throw Error('Server-only material in public bundle');
const hash=createHash('sha256').update(js).update(css).update(icon).digest('hex');
writeFileSync('cloudflare-worker/src/reseller-panel-assets.mjs','// Generated public UI; content SHA-256 '+hash+'\nexport const PORTAL_SCRIPT='+JSON.stringify(js)+';\nexport const PORTAL_CSS='+JSON.stringify(css)+';\nexport const PORTAL_ICON='+JSON.stringify(icon)+';\n');
console.log('Generated credential-free reseller assets:',Buffer.byteLength(js),'JS bytes; fingerprint',hash);

import {cpSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
await import('./build-pages.mjs');
const out=path.join(root,'artifacts/staging-web');
rmSync(out,{recursive:true,force:true});
cpSync(path.join(root,'artifacts/pages'),out,{recursive:true});
rmSync(path.join(out,'CNAME'));
// This artifact is deployed only with the staging Worker, never GitHub Pages.
writeFileSync(path.join(out,'app-config.js'),`globalThis.SMNConfig=Object.freeze({version:'staging-1',environment:'staging',api:location.origin+'/api',cookieMode:location.protocol==='https:'});\n`);
for(const name of readdirSync(out).filter(name=>name.endsWith('.html'))){
 const file=path.join(out,name),html=readFileSync(file,'utf8');
 const banner='<aside role="status" style="padding:16px;background:#573500;color:#fff;text-align:center;font-weight:bold">ENTORNO DE PRUEBAS · Usa únicamente cuentas y datos ficticios.</aside>';
 if(!/<body\b[^>]*>/i.test(html)){
  if(['index.html','admin.html'].includes(name))throw Error('Missing staging page body: '+name);
  continue;
 }
 writeFileSync(file,html.replace(/<body\b[^>]*>/i,match=>match+banner));
}
writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
console.log('PASS: staging web uses its own API and visibly identifies test data.');

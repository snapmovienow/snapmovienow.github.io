import {readdirSync,readFileSync,copyFileSync,cpSync,mkdirSync,rmSync,lstatSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'artifacts/pages');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
// Publish only browser assets. Server code, dependencies, reports and tests stay out.
const files=readdirSync(root).filter(name=>/\.(html|js|css)$/.test(name)).concat('CNAME');
for(const file of files){if(!lstatSync(path.join(root,file)).isFile())throw Error('Invalid frontend file: '+file);copyFileSync(path.join(root,file),path.join(out,file));}
cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});writeFileSync(path.join(out,'.nojekyll'),'');
for(const file of files.filter(f=>f.endsWith('.html'))){
 const html=readFileSync(path.join(root,file),'utf8');
 for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
  const target=match[1].split(/[?#]/)[0];if(!target||/^(?:[a-z]+:|\/\/)/i.test(target)||target.startsWith('/'))continue;
  let resolved=path.resolve(out,target);if(resolved===out||resolved.startsWith(out+path.sep)){if(lstatSync(resolved).isDirectory())resolved=path.join(resolved,'index.html');}if(!resolved.startsWith(out+path.sep)||!lstatSync(resolved).isFile())throw Error(file+' references an unpublished asset: '+target);
 }
}
console.log('PASS: curated Pages artifact and local HTML asset references.');

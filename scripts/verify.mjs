import {readdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode,...extra]=process.argv.slice(2);
if((mode!==undefined&&mode!=='--worker-only')||extra.length){
 throw new Error('Usage: node scripts/verify.mjs [--worker-only]');
}
// Workers Builds installs only the Worker package. Quality's root npm test
// continues to run both suites before the deploy guard can approve the SHA.
const workerOnly=mode==='--worker-only';
const suites=workerOnly?['cloudflare-worker/tests']:['cloudflare-worker/tests','tests'];
let count=0;
for(const dir of suites){
 for(const file of readdirSync(path.join(root,dir)).filter(x=>x.endsWith('.test.mjs')).sort()){
  const result=spawnSync(process.execPath,[path.join(root,dir,file)],{cwd:root,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);count++;
 }
}
for(const file of readdirSync(root).filter(x=>x.endsWith('.html'))){
 const html=readFileSync(path.join(root,file),'utf8');
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/\bsrc=|type=["'](?:module|application\/ld\+json)/i.test(m[1]))new vm.Script(m[2],{filename:file});
 }
}
for(const file of readdirSync(root).filter(x=>x.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
console.log(`PASS: ${count} ${workerOnly?'Worker ':''}regression files and frontend JavaScript syntax.`);

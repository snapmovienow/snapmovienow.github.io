import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Bounded preventive check, not an exhaustive secret scanner or a Git-history
// audit. Values and source excerpts must never enter its diagnostics.
const patterns=[
 ['private_key',/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
 ['github_token',/\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
 ['github_fine_grained_token',/\bgithub_pat_[A-Za-z0-9_]{70,255}\b/g],
 ['npm_token',/\bnpm_[A-Za-z0-9]{36}\b/g],
 ['stripe_live_secret',/\b(?:sk|rk)_live_[A-Za-z0-9]{20,255}\b/g],
 ['google_api_key',/\bAIza[0-9A-Za-z_-]{35}\b/g],
 ['openai_secret',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,255}\b/g],
 ['slack_token',/\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{20,80}\b/g],
];
const brandingFiles=new Set(['index.html','master.m3u8','video.m3u8','audio.m3u8','brand.m3u8','brand.vtt','playlist.m3u','source.json']);
const template=name=>/\.(?:example|template)$/i.test(name);
export function sensitivePath(file){
 const parts=file.split('/'),name=parts.at(-1);
 if(parts.some(part=>['.git','.ssh','.signing','backups'].includes(part.toLowerCase())))return true;
 if(/^(?:\.env|\.dev\.vars)(?:\.|$)/i.test(name)&&!template(name))return true;
 return /\.(?:key|pem|p12|pfx|jks|keystore|db|sqlite|sqlite3)(?:[-.](?:wal|shm|journal)|\.(?:bak|gz|zip))?$/i.test(name)||/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i.test(name)||/^(?:backup|dump)(?:[-_.].*)?\.sql(?:\.(?:gz|zip))?$/i.test(name);
}
function safePath(file){
 let value=file;
 for(const [,pattern]of patterns){pattern.lastIndex=0;value=value.replace(pattern,'[redacted]');}
 return value.replace(/[\x00-\x1f\x7f]/g,'?').slice(0,240);
}
export function scanText(value,file){
 const issues=[];
 for(const [kind,pattern]of patterns){
  pattern.lastIndex=0;const match=pattern.exec(value);
  if(match)issues.push({file:safePath(file),line:value.slice(0,match.index).split('\n').length,kind});
 }
 return issues;
}
function artifactAllowed(file){
 const parts=file.split('/');
 if(parts.length===1)return /\.(?:html|js|css)$/.test(file)||['CNAME','.nojekyll'].includes(file);
 if(parts[0]==='assets')return parts.every(part=>!part.startsWith('.'))&&/\.(?:svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf)$/i.test(file);
 return parts.length===2&&parts[0]==='branding-test'&&brandingFiles.has(parts[1]);
}
export function inspectRepository({root,pagesDirectory=path.join(root,'artifacts/pages')}){
 const issues=[],tracked=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean);
 const inspect=(file,absolute,artifact=false)=>{
  const name=safePath((artifact?'artifacts/pages/':'')+file);
  if(sensitivePath(file))issues.push({file:name,line:1,kind:'private_filename'});
  const stat=lstatSync(absolute);
  if(!stat.isFile()){issues.push({file:name,line:1,kind:'non_regular_file'});return;}
  if(artifact&&!artifactAllowed(file))issues.push({file:name,line:1,kind:'pages_private_boundary'});
  issues.push(...scanText(readFileSync(absolute,'utf8'),(artifact?'artifacts/pages/':'')+file));
 };
 for(const file of tracked)inspect(file,path.join(root,file));
 const walk=(directory,prefix='')=>{
  for(const name of readdirSync(directory)){
   const absolute=path.join(directory,name),file=prefix+name,stat=lstatSync(absolute);
   if(stat.isDirectory())walk(absolute,file+'/');else inspect(file,absolute,true);
  }
 };
 walk(pagesDirectory);
 return {trackedFiles:tracked.length,issues};
}
export function diagnostic(result){
 return result.issues.length
  ?'SECURITY CHECK BLOCKED\n'+result.issues.map(issue=>`${issue.file}:${issue.line} ${issue.kind}`).join('\n')
  :`PASS: ${result.trackedFiles} tracked files and curated Pages boundary checked for selected secret patterns. Git history and unknown secret formats are outside this check.`;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=inspectRepository({root:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')});console.log(diagnostic(result));if(result.issues.length)process.exitCode=1;}
 catch{console.error('SECURITY CHECK BLOCKED: source or Pages artifact could not be inspected. No publication approved.');process.exitCode=1;}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectRepository,diagnostic,sensitivePath,scanText} from '../scripts/security-check.mjs';

function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'snap-security-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 execFileSync('git',['init','--quiet',root],{stdio:'ignore'});
 const write=(name,value,tracked=true)=>{const dest=path.join(root,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,value);if(tracked)execFileSync('git',['-C',root,'add','--force','--',name],{stdio:'ignore'});};
 write('app.js','export const publicConfig={api:"https://api.example.test"};');
 write('artifacts/pages/index.html','<!doctype html><title>Public page</title>',false);
 return {root,write,inspect:()=>inspectRepository({root})};
}
// Construct synthetic credentials only in memory; test source contains no
// contiguous token matching the production guard.
const token=()=>['ghp','_'+'a7B9cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0wX'].join('');

test('ordinary source, environment templates and parameterized SQL pass',t=>{
 const f=fixture(t);
 f.write('.env.example','API_KEY=replace-with-your-private-value');
 f.write('config/.env.production.template','DATABASE_URL=not-configured');
 f.write('drizzle/0013_many_golden_guardian.sql','CREATE TABLE records(id TEXT PRIMARY KEY);');
 f.write('db/query.js','db.prepare("SELECT * FROM records WHERE id=?").bind(id);');
 assert.deepEqual(f.inspect().issues,[]);
});

test('tracked credential is blocked and diagnostics never reproduce its value',t=>{
 const f=fixture(t),secret=token();f.write('settings.js','// public configuration\nexport const key="'+secret+'";');
 const result=f.inspect();assert.ok(result.issues.some(i=>i.file==='settings.js'&&i.line===2&&i.kind==='github_token'));
 const output=diagnostic(result);assert.match(output,/SECURITY CHECK BLOCKED/);assert.equal(output.includes(secret),false);assert.equal(output.includes('export const'),false);
});

test('private key marker is blocked even in a non-key filename',()=>{
 const marker=['-----BEGIN ','PRIVATE KEY-----'].join('');
 assert.deepEqual(scanText('prefix\n'+marker+'\nsynthetic','settings.txt'),[{file:'settings.txt',line:2,kind:'private_key'}]);
});

test('sensitive tracked filenames cannot rely on gitignore for protection',t=>{
 const f=fixture(t);
 for(const name of ['.env','.env.local','.dev.vars','signing/release.jks','signing/private.pem','customer.sqlite3','backups/export.json','dump.sql'])f.write(name,'synthetic-only');
 const issues=f.inspect().issues;
 assert.equal(issues.filter(i=>i.kind==='private_filename').length,8);
 for(const name of ['.env.template','.env.example','.dev.vars.example','drizzle/0022_slow_guardian.sql','docs/private-diagnostic-report.md'])assert.equal(sensitivePath(name),false,name);
});

test('Pages artifact blocks server code, secrets and private backups',t=>{
 const f=fixture(t),secret=token();
 f.write('artifacts/pages/cloudflare-worker/src/index.js','export default {};',false);
 f.write('artifacts/pages/assets/settings.js','export const key="'+secret+'";',false);
 f.write('artifacts/pages/assets/customer.db','synthetic-only',false);
 const result=f.inspect();
 assert.ok(result.issues.some(i=>i.kind==='pages_private_boundary'&&i.file.includes('cloudflare-worker')));
 assert.ok(result.issues.some(i=>i.kind==='github_token'));
 assert.ok(result.issues.some(i=>i.kind==='private_filename'&&i.file.endsWith('customer.db')));
 assert.equal(diagnostic(result).includes(secret),false);
});

test('secret-shaped filenames are redacted in diagnostics too',t=>{
 const f=fixture(t),secret=token();f.write('artifacts/pages/'+secret+'.json','{}',false);
 assert.equal(diagnostic(f.inspect()).includes(secret),false);
});

test('curated public images and finite compatibility demo are allowed',t=>{
 const f=fixture(t);f.write('artifacts/pages/assets/logo.svg','<svg xmlns="http://www.w3.org/2000/svg"/>',false);
 f.write('artifacts/pages/branding-test/source.json','{"kind":"public-demo"}',false);
 f.write('artifacts/pages/branding-test/master.m3u8','#EXTM3U',false);
 assert.deepEqual(f.inspect().issues,[]);
});

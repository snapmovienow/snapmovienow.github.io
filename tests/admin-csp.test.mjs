import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function policy(html){
 const value=html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
 assert.ok(value,'published HTML declares its browser policy');
 return new Map(value.split(';').map(part=>part.trim().split(/\s+/)).filter(([name])=>name).map(([name,...sources])=>[name,sources]));
}
const admin=read('admin.html'),adminPolicy=policy(admin);

test('administrator scripts cannot execute from a third-party host, inline code, or eval',()=>{
 // Only self is executable: an injected script on jsDelivr or any other host
 // cannot become executable merely because the public player uses that CDN.
 assert.deepEqual(adminPolicy.get('script-src'),["'self'"]);
 assert.deepEqual(adminPolicy.get('object-src'),["'none'"]);
 assert.deepEqual(adminPolicy.get('base-uri'),["'self'"]);
 const scripts=[...admin.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 assert.ok(scripts.length>=3);
 for(const [,attributes,inline] of scripts){
  const src=attributes.match(/\bsrc="([^"]+)"/)?.[1];
  assert.ok(src,'administrator code stays in an external module, not inline');
  assert.equal(new URL(src,'https://app.snaptvnow.com/admin.html').origin,'https://app.snaptvnow.com');
  assert.equal(inline.trim(),'');
 }
 assert.ok(scripts.some(([,attributes])=>attributes.includes('admin.js?')),'main administrator remains loaded');
});

test('administrator connections retain the fixed API and existing local test transports only',()=>{
 assert.deepEqual(adminPolicy.get('connect-src'),["'self'",'https://api.snaptvnow.com','http://127.0.0.1:8787','http://localhost:8787']);
 // Broad https:, wildcard, data: and an injected destination are intentionally
 // absent; local development continues using the existing fixed port.
 const config=read('app-config.js');
 assert.ok(config.includes("?'http://127.0.0.1:8787':'https://api.snaptvnow.com'"));
 const main=read('admin.js');
 for(const module of ['admin-security.js','admin-support.js','admin-users.js'])assert.ok(main.includes('./'+module));
 assert.ok(main.includes("credentials:globalThis.SMNConfig?.cookieMode?'include':'omit'"),'cookie transport is preserved');
 assert.ok(main.includes("api('reseller-admin-launch')"),'protected owner panel handoff is preserved');
});

test('administrator hardening leaves required player and image-preview capabilities intact',()=>{
 assert.deepEqual(adminPolicy.get('img-src'),["'self'",'https:','data:']);
 assert.deepEqual(adminPolicy.get('style-src'),["'self'","'unsafe-inline'"]);
 const player=policy(read('index.html'));
 assert.ok(player.get('script-src').includes('https://cdn.jsdelivr.net'));
 assert.ok(player.get('script-src').includes("'wasm-unsafe-eval'"));
 assert.ok(player.get('media-src').includes('blob:'));
 assert.ok(player.get('connect-src').includes('https:'));
});

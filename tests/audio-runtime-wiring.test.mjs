// Worker deployments install only cloudflare-worker/package.json. The real HLS
// integration belongs to Quality's required root-dependency runtime gate, not
// the worker-install-compatible .test.mjs group run by the deploy command.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const worker=JSON.parse(read('cloudflare-worker/package.json'));
const startup='tests/live-audio-startup-runtime.mjs';
assert.equal(existsSync(new URL('../tests/live-audio-startup.test.mjs',import.meta.url)),false,
 'HLS integration must not enter the worker-only test group');
assert.ok(read(startup).includes("import Hls from 'hls.js'"),'the real-engine regression must remain present');
assert.equal(pkg.scripts['test:browser'],`node ${startup} && node tests/live-audio-runtime.mjs`,
 'Quality must run both audio integrations, failing immediately if either fails');
assert.match(read('.github/workflows/quality.yml'),/- name: Chromium audio regression\s+run: npm run test:browser/,
 'the audio runtime command remains a required Quality step');
assert.equal(pkg.devDependencies['hls.js'],'1.6.15');
assert.equal(lock.packages[''].devDependencies['hls.js'],'1.6.15');
assert.equal(lock.packages['node_modules/hls.js'].version,'1.6.15');
assert.equal(lock.packages['node_modules/hls.js'].dev,true);
assert.equal(lock.packages['node_modules/hls.js'].resolved,'https://registry.npmjs.org/hls.js/-/hls.js-1.6.15.tgz');
assert.equal(worker.dependencies?.['hls.js'],undefined,'HLS is not a Worker production dependency');
assert.equal(worker.devDependencies?.['hls.js'],undefined,'do not duplicate the browser engine in the Worker installation');
console.log('PASS: worker-only test discovery, mandatory real-HLS Quality gate and pinned root-only HLS dependency.');

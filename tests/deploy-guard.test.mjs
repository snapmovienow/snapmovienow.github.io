import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {qualityRun, waitForQuality} from '../scripts/deploy-guard.mjs';

const sha = 'a'.repeat(40);
const branch = 'main';
const approved = {id: 20, run_attempt: 1, name: 'Quality',
  path: '.github/workflows/quality.yml', event: 'push', head_sha: sha,
  head_branch: branch, status: 'completed', conclusion: 'success',
  html_url: 'https://github.com/snapmovienow/snapmovienow.github.io/actions/runs/20'};
const response = (runs, headers = {}) => ({ok: true, status: 200,
  headers: new Headers(headers), json: async () => ({workflow_runs: runs})});
const rejected = (status, headers = {}) => ({ok: false, status, headers: new Headers(headers)});

function fixture(sequence, deadlineMs = 12 * 60_000, token) {
  let clock = 0;
  let calls = 0;
  const requests = [];
  const logs = [];
  return {
    options: {sha, branch, deadlineMs, token, log: message => logs.push(message), now: () => clock,
      wait: async ms => {clock += ms;},
      fetchImpl: async (url, options) => {
        assert.equal(url.hostname, 'api.github.com');
        assert.equal(url.searchParams.get('head_sha'), sha);
        assert.equal(url.searchParams.get('branch'), branch);
        assert.equal(options.headers.Authorization, token ? `Bearer ${token}` : undefined);
        assert.equal(options.redirect, 'error');
        requests.push({at: clock, headers: options.headers});
        const item = sequence[Math.min(calls++, sequence.length - 1)];
        if (item instanceof Error) throw item;
        return item;
      }},
    calls: () => calls, requests, logs
  };
}

// A delayed run is permitted only when that exact revision eventually succeeds.
let test = fixture([response([]), response([{...approved, status: 'in_progress', conclusion: null}]), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, approved.id);
assert.equal(test.calls(), 3);

// Stale success must not hide a failed rerun or a newer failed run.
for (const failed of [{...approved, id: 21, conclusion: 'failure'}, {...approved, run_attempt: 2, conclusion: 'failure'}]) {
  test = fixture([response([approved, failed])]);
  await assert.rejects(waitForQuality(test.options), /Quality failure; deployment blocked/);
}
for (const conclusion of ['cancelled', 'timed_out', 'skipped', 'neutral', null]) {
  test = fixture([response([{...approved, conclusion}])]);
  await assert.rejects(waitForQuality(test.options), /deployment blocked/);
}

// Neither a preview/PR run nor another branch, workflow, or commit authorizes production.
for (const mismatch of [{head_sha: 'b'.repeat(40)}, {head_branch: 'preview'},
  {event: 'pull_request'}, {path: '.github/workflows/other.yml'}, {name: 'Impersonated'}]) {
  test = fixture([response([{...approved, ...mismatch}])], 40_000);
  await assert.rejects(waitForQuality(test.options), /did not approve/);
}

// Transient outages can recover; persistent transport, rate-limit and malformed responses fail closed.
test = fixture([new Error('temporary network failure'), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, 20);
for (const failure of [new Error('offline'), rejected(403),
  {ok: true, json: async () => ({message: 'invalid response'})}]) {
  test = fixture([failure]);
  await assert.rejects(waitForQuality(test.options), /Cannot verify Quality; deployment blocked/);
  assert.equal(test.calls(), 4);
  assert.deepEqual(test.requests.map(request => request.at), [0, 60_000, 180_000, 420_000]);
}

// A primary quota reset and Retry-After must be obeyed, rather than hammered every 20s.
test = fixture([rejected(403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '180'}), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, 20);
assert.equal(test.requests[1].at, 181_000);
assert.match(test.logs[0], /API quota exhausted/);
for (const retry of ['120', new Date(120_000).toUTCString()]) {
  test = fixture([rejected(429, {'retry-after': retry}), response([approved])]);
  assert.equal((await waitForQuality(test.options)).id, 20);
  assert.equal(test.requests[1].at, 120_000);
}
// A successful pending response can also consume the last quota request.
test = fixture([response([{...approved, status: 'in_progress', conclusion: null}],
  {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '180'}), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, 20);
assert.equal(test.requests[1].at, 181_000);
test = fixture([rejected(403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600'})]);
await assert.rejects(waitForQuality(test.options), /API quota exhausted; next check would exceed/);
assert.equal(test.calls(), 1);
test = fixture([response([], {'x-poll-interval': '120'}), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, 20);
assert.equal(test.requests[1].at, 120_000);

// Conditional reads never turn a cached pending run or an unreadable response into approval.
test = fixture([response([{...approved, status: 'in_progress', conclusion: null}], {etag: '"pending"'}),
  rejected(304), response([approved])]);
assert.equal((await waitForQuality(test.options)).id, 20);
assert.equal(test.calls(), 3);
assert.equal(test.requests[1].headers['If-None-Match'], '"pending"');
assert.equal(test.requests[2].headers['If-None-Match'], '"pending"');
test = fixture([rejected(304)]);
await assert.rejects(waitForQuality(test.options), /Cannot verify Quality/);
test = fixture([response([{...approved, status: 'in_progress', conclusion: null}], {etag: '"pending"'}),
  rejected(403)]);
await assert.rejects(waitForQuality(test.options), /Cannot verify Quality/);
test = fixture([response([{...approved, status: 'in_progress', conclusion: null}], {etag: '"pending"'}),
  rejected(304), response([approved, {...approved, id: 21, conclusion: 'failure'}])]);
await assert.rejects(waitForQuality(test.options), /Quality failure/);

// A dedicated read-only token is sent only to the fixed GitHub endpoint, never logged.
const secret = 'github_pat_test_only_0123456789';
test = fixture([new Error(`network includes ${secret}`), response([approved])], undefined, secret);
assert.equal((await waitForQuality(test.options)).id, 20);
assert.ok(!test.logs.join('\n').includes(secret));
test = fixture([rejected(401)], undefined, secret);
await assert.rejects(waitForQuality(test.options), /GitHub HTTP 401/);
assert.equal(test.calls(), 1); // No unauthenticated fallback for an expired/misconfigured token.
for (const invalid of ['short', `${secret}\n`, `${secret}\rInjected: value`]) {
  test = fixture([response([approved])], undefined, invalid);
  await assert.rejects(waitForQuality(test.options), /QUALITY_GITHUB_TOKEN is invalid/);
  assert.equal(test.calls(), 0);
}
test = fixture([response([{...approved, status: 'queued', conclusion: null}])], 1);
await assert.rejects(waitForQuality(test.options), /did not approve/);
await assert.rejects(waitForQuality({...test.options, sha: 'short'}), /complete commit/);
await assert.rejects(waitForQuality({...test.options, branch: ''}), /complete commit/);
assert.throws(() => qualityRun(undefined, sha, branch), /invalid workflow response/);

// Exercise the actual CLI boundary: regular npm installations must not depend on
// GitHub, while Workers Builds must reject an inconsistent checkout before networking.
const regular = spawnSync(process.execPath, ['scripts/deploy-guard.mjs'], {
  encoding: 'utf8', env: {...process.env, WORKERS_CI: '0'}, timeout: 5_000
});
assert.equal(regular.status, 0, regular.stderr);
const wrongCommit = spawnSync(process.execPath, ['scripts/deploy-guard.mjs'], {
  encoding: 'utf8', env: {...process.env, WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main',
    WORKERS_CI_COMMIT_SHA: '0'.repeat(40)}, timeout: 5_000
});
assert.equal(wrongCommit.status, 1);
assert.match(wrongCommit.stderr, /checked-out commit differ/);

// Run the complete CLI in a real, isolated Git checkout. A manual build without
// push metadata must approve this checkout's SHA, not an arbitrary passing run.
const temporary = mkdtempSync(path.join(os.tmpdir(), 'smn-deploy-guard-'));
try {
  const checkout = path.join(temporary, 'checkout');
  mkdirSync(path.join(checkout, 'scripts'), {recursive: true});
  copyFileSync('scripts/deploy-guard.mjs', path.join(checkout, 'scripts/deploy-guard.mjs'));
  writeFileSync(path.join(checkout, 'tracked.txt'), 'original\n');
  const fixtureGit = (...args) => {
    const result = spawnSync('git', args, {cwd: checkout, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  fixtureGit('init', '-b', 'main');
  fixtureGit('add', '.');
  fixtureGit('-c', 'user.name=Deploy Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'Synthetic deployment checkout');
  const checkoutSha = fixtureGit('rev-parse', 'HEAD');
  const preload = path.join(temporary, 'github-fixture.mjs');
  writeFileSync(preload, `import assert from 'node:assert/strict';
globalThis.fetch = async (url, options) => {
  assert.equal(url.hostname, 'api.github.com');
  assert.equal(url.pathname, '/repos/snapmovienow/snapmovienow.github.io/actions/workflows/quality.yml/runs');
  assert.equal(url.searchParams.get('head_sha'), ${JSON.stringify(checkoutSha)});
  assert.equal(url.searchParams.get('branch'), 'main');
  assert.equal(options.redirect, 'error');
  console.log('GITHUB_FIXTURE_REQUEST');
  return {ok: true, status: 200, headers: new Headers(), json: async () => ({workflow_runs: [{
    ...${JSON.stringify(approved)}, head_sha: ${JSON.stringify(checkoutSha)},
    conclusion: process.env.SMN_GUARD_TEST_CONCLUSION || 'success'
  }]})};
};
`);
  const manual = (metadata = {}, extra = {}) => {
    const env = {...process.env, WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', ...extra};
    delete env.WORKERS_CI_COMMIT_SHA;
    Object.assign(env, metadata);
    return spawnSync(process.execPath, ['--import', preload, 'scripts/deploy-guard.mjs'], {
      cwd: checkout, encoding: 'utf8', env, timeout: 5_000
    });
  };
  for (const metadata of [{}, {WORKERS_CI_COMMIT_SHA: ''}, {WORKERS_CI_COMMIT_SHA: checkoutSha},
    {WORKERS_CI_BRANCH: '', WORKERS_CI_COMMIT_SHA: ''}]) {
    const result = manual(metadata);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Quality approved ${checkoutSha}`));
    assert.match(result.stdout, /GITHUB_FIXTURE_REQUEST/);
  }
  for (const reported of ['0'.repeat(40), 'short', 'unknown', checkoutSha + '\n']) {
    const result = manual({WORKERS_CI_COMMIT_SHA: reported});
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /deployment blocked/);
    assert.ok(!result.stdout.includes('GITHUB_FIXTURE_REQUEST'), 'invalid commit metadata blocks before GitHub');
  }
  const failed = manual({}, {SMN_GUARD_TEST_CONCLUSION: 'failure'});
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /Quality failure; deployment blocked/);
  fixtureGit('checkout', '--detach');
  const branchless = manual({WORKERS_CI_BRANCH: ''});
  assert.equal(branchless.status, 1, branchless.stderr);
  assert.match(branchless.stderr, /complete commit SHA and branch/);
  assert.ok(!branchless.stdout.includes('GITHUB_FIXTURE_REQUEST'));
  writeFileSync(path.join(checkout, 'tracked.txt'), 'changed\n');
  const dirty = manual();
  assert.equal(dirty.status, 1, dirty.stderr);
  assert.match(dirty.stderr, /tracked modifications/);
  assert.ok(!dirty.stdout.includes('GITHUB_FIXTURE_REQUEST'));
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
console.log('PASS: exact-commit deployment approval, manual-build checkout verification, rate-limit backoff, conditional reads, secret isolation and install isolation.');

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {qualityRun, waitForQuality} from '../scripts/deploy-guard.mjs';

const sha = 'a'.repeat(40);
const branch = 'main';
const approved = {id: 20, run_attempt: 1, name: 'Quality',
  path: '.github/workflows/quality.yml', event: 'push', head_sha: sha,
  head_branch: branch, status: 'completed', conclusion: 'success',
  html_url: 'https://github.com/snapmovienow/snapmovienow.github.io/actions/runs/20'};
const response = runs => ({ok: true, json: async () => ({workflow_runs: runs})});

function fixture(sequence, deadlineMs = 100_000) {
  let clock = 0;
  let calls = 0;
  return {
    options: {sha, branch, deadlineMs, log() {}, now: () => clock,
      wait: async ms => {clock += ms;},
      fetchImpl: async (url, options) => {
        assert.equal(url.hostname, 'api.github.com');
        assert.equal(url.searchParams.get('head_sha'), sha);
        assert.equal(url.searchParams.get('branch'), branch);
        assert.equal(options.headers.Authorization, undefined);
        const item = sequence[Math.min(calls++, sequence.length - 1)];
        if (item instanceof Error) throw item;
        return item;
      }},
    calls: () => calls
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
for (const failure of [new Error('offline'), {ok: false, status: 403},
  {ok: true, json: async () => ({message: 'invalid response'})}]) {
  test = fixture([failure]);
  await assert.rejects(waitForQuality(test.options), /Cannot verify Quality; deployment blocked/);
  assert.equal(test.calls(), 5);
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
console.log('PASS: exact-commit deployment approval, reruns, outages and install isolation.');

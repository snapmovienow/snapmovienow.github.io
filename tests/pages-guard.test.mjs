import assert from 'node:assert/strict';
import {approvePages} from '../scripts/pages-guard.mjs';

const repository = 'snapmovienow/snapmovienow.github.io';
const sha = 'a'.repeat(40);
const token = 'github_test_actions_token_0123456789';
const run = {id: 20, run_attempt: 1, name: 'Quality', path: '.github/workflows/quality.yml',
  event: 'push', head_sha: sha, head_branch: 'main', head_repository: {full_name: repository},
  status: 'completed', conclusion: 'success'};
const repoEvent = {full_name: repository, default_branch: 'main'};
const event = {action: 'completed', repository: repoEvent, workflow_run: run};
const pages = {build_type: 'workflow', cname: 'app.snaptvnow.com', https_enforced: true};
const head = {ref: 'refs/heads/main', object: {type: 'commit', sha}};
const options = {eventName: 'workflow_run', event, ref: 'refs/heads/main', checkoutSha: sha, token};

function fixture({site = pages, main = head, runs = [run], fresh = run, failure} = {}) {
  const requests = [];
  return {requests, fetchImpl: async (url, request) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://api.github.com');
    assert.equal(request.method, 'GET');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.ok(endpoint.pathname.startsWith(`/repos/${repository}/`));
    requests.push(endpoint);
    if (failure instanceof Error) throw failure;
    if (failure) return {ok: false, status: failure};
    const leaf = endpoint.pathname.slice(`/repos/${repository}/`.length);
    const data = leaf === 'pages' ? site : leaf === 'git/ref/heads/main' ? main :
      leaf === 'actions/runs/20' ? fresh : leaf === 'actions/workflows/quality.yml/runs' ? {workflow_runs: runs} : null;
    if (leaf.endsWith('/quality.yml/runs')) {
      assert.equal(endpoint.searchParams.get('head_sha'), main.object.sha);
      assert.equal(endpoint.searchParams.get('event'), 'push');
      assert.equal(endpoint.searchParams.get('branch'), 'main');
    }
    assert.notEqual(data, null, `Unexpected endpoint ${leaf}`);
    return {ok: true, status: 200, json: async () => data};
  }};
}
const approve = (settings = {}, context = {}) => {
  const test = fixture(settings);
  return approvePages({...options, ...context, fetchImpl: test.fetchImpl});
};

assert.deepEqual(await approve(), {ready: true, sha, runId: 20, attempt: 1,
  reason: 'Exact main revision approved by the latest successful push Quality run.'});
const manual = {eventName: 'workflow_dispatch', event: {repository: repoEvent}};
assert.equal((await approve({}, manual)).ready, true);

// Source changes and HTTPS/domain are verified from live settings, never a flag.
for (const site of [{...pages, build_type: 'legacy'}, {...pages, cname: 'wrong.example'},
  {...pages, https_enforced: false}]) assert.equal((await approve({site})).ready, false);
await assert.rejects(approve({site: {...pages, build_type: 'unknown'}}), /Unknown Pages source/);
await assert.rejects(approve({main: {ref: head.ref, object: {type: 'tag', sha}}}), /Invalid main/);

// A manual activation cannot publish without the current successful push tests.
for (const runs of [[], [{...run, status: 'in_progress', conclusion: null}],
  [{...run, conclusion: 'failure'}], [{...run, conclusion: 'cancelled'}],
  [run, {...run, id: 21, conclusion: 'failure'}],
  [run, {...run, run_attempt: 2, conclusion: 'failure'}],
  [{...run, event: 'workflow_dispatch'}], [{...run, event: 'pull_request'}],
  [{...run, path: '.github/workflows/impersonated.yml'}], [{...run, name: 'Other'}],
  [{...run, head_sha: 'b'.repeat(40)}], [{...run, head_branch: 'preview'}]]) {
  assert.equal((await approve({runs}, manual)).ready, false);
}
await assert.rejects(approve({runs: [{...run, head_repository: {full_name: 'attacker/fork'}}]}, manual), /provenance/);
await assert.rejects(approve({runs: [{...run, run_attempt: null}]}, manual), /provenance/);

// Reject a stale trigger, a rerun that begins after the list read, or a changed main.
assert.equal((await approve({main: {...head, object: {type: 'commit', sha: 'b'.repeat(40)}}})).ready, false);
assert.equal((await approve({}, {event: {...event, workflow_run: {...run, id: 19}}})).ready, false);
assert.equal((await approve({}, {event: {...event, workflow_run: {...run, run_attempt: 2}}})).ready, false);
for (const fresh of [{...run, run_attempt: 2}, {...run, status: 'queued', conclusion: null},
  {...run, conclusion: 'failure'}, {...run, head_sha: 'b'.repeat(40)},
  {...run, head_repository: {full_name: 'attacker/fork'}}, {...run, event: 'pull_request'}]) {
  assert.equal((await approve({fresh})).ready, false);
}

// The final check binds both the artifact revision and the exact approval attempt.
const expected = {expectedSha: sha, expectedRunId: 20, expectedAttempt: 1};
assert.equal((await approve({}, expected)).ready, true);
for (const mismatch of [{expectedSha: 'b'.repeat(40)}, {expectedRunId: 19}, {expectedAttempt: 2}]) {
  assert.equal((await approve({}, {...expected, ...mismatch})).ready, false);
}
await assert.rejects(approve({}, {expectedSha: sha}), /Invalid Pages approval/);

// Fork/PR/non-main events stop before reading settings or receiving deploy rights.
for (const change of [{eventName: 'pull_request'}, {ref: 'refs/heads/preview'},
  {event: {...event, repository: {full_name: 'attacker/fork', default_branch: 'main'}}},
  {event: {...event, repository: {...repoEvent, default_branch: 'preview'}}}, {checkoutSha: 'short'}]) {
  const test = fixture();
  await assert.rejects(approvePages({...options, ...change, fetchImpl: test.fetchImpl}));
  assert.equal(test.requests.length, 0);
}
for (const change of [{event: {...event, action: 'requested'}},
  {event: {...event, workflow_run: {...run, conclusion: 'failure'}}},
  {event: {...event, workflow_run: {...run, path: '.github/workflows/other.yml'}}},
  {event: {...event, workflow_run: {...run, event: 'pull_request'}}},
  {event: {...event, workflow_run: {...run, head_repository: {full_name: 'attacker/fork'}}}}]) {
  const test = fixture();
  assert.equal((await approvePages({...options, ...change, fetchImpl: test.fetchImpl})).ready, false);
  assert.equal(test.requests.length, 0);
}

// Fail closed on an outage, auth/quota error or malformed response; never leak token.
for (const failure of [new Error(`secret ${token}`), 401, 403, 429, 500]) {
  await assert.rejects(approve({failure}), error => {
    assert.ok(!error.message.includes(token));
    return /Pages remains blocked/.test(error.message);
  });
}
await assert.rejects(approvePages({...options, fetchImpl: async () => ({ok: true,
  json: async () => {throw new Error(token);}})}), /Invalid GitHub response/);
await assert.rejects(approve({}, {token: `${token}\n`}), /Actions token/);
console.log('PASS: Pages source, domain/HTTPS, exact Quality attempt, manual activation, stale/fork rejection and secret isolation.');

import {appendFileSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualityRun} from './deploy-guard.mjs';

const repository = 'snapmovienow/snapmovienow.github.io';
const workflow = '.github/workflows/quality.yml';
const domain = 'app.snaptvnow.com';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shaPattern = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const blocked = reason => ({ready: false, reason});
class PagesError extends Error {}

// Reading live settings replaces the old flag: selecting GitHub Actions in Pages
// is sufficient. A manual activation still requires a successful push Quality run.
export async function approvePages({eventName, event, ref, checkoutSha, token,
  expectedSha, expectedRunId, expectedAttempt, fetchImpl = fetch}) {
  if (event?.repository?.full_name !== repository || event.repository.default_branch !== 'main' ||
      ref !== 'refs/heads/main' || !shaPattern.test(checkoutSha || '')) {
    throw new PagesError('Pages requires the main checkout of the original repository.');
  }
  let trigger;
  if (eventName === 'workflow_run') {
    trigger = event.workflow_run;
    if (event.action !== 'completed' || trigger?.name !== 'Quality' || trigger.path !== workflow ||
        trigger.event !== 'push' || trigger.head_branch !== 'main' ||
        trigger.head_repository?.full_name !== repository || !shaPattern.test(trigger.head_sha || '') ||
        !positive(trigger.id) || !positive(trigger.run_attempt) ||
        trigger.status !== 'completed' || trigger.conclusion !== 'success') {
      return blocked('Only a successful main push Quality run can publish Pages.');
    }
  } else if (eventName !== 'workflow_dispatch') {
    throw new PagesError('Unsupported Pages publication event.');
  }
  if (expectedSha !== undefined && (!shaPattern.test(expectedSha) ||
      !positive(expectedRunId) || !positive(expectedAttempt))) {
    throw new PagesError('Invalid Pages approval reference.');
  }
  // Installation tokens are opaque and can exceed 512 characters. Validate
  // header safety, not a guessed token format; never print the credential.
  if (typeof token !== 'string' || !/^[\x21-\x7e]{20,8192}$/.test(token)) {
    throw new PagesError('An Actions token is required to verify Pages.');
  }
  const get = async endpoint => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}/${endpoint}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SNAPTVNOW-pages-guard'}
      });
    } catch {
      throw new PagesError('GitHub could not be reached; Pages remains blocked.');
    }
    if (!response.ok) {
      throw new PagesError(`GitHub HTTP ${Number.isInteger(response.status) ? response.status : 'invalid'}; Pages remains blocked.`);
    }
    try { return await response.json(); } catch {
      throw new PagesError('Invalid GitHub response; Pages remains blocked.');
    }
  };
  const pages = await get('pages');
  const activationPending = pages?.build_type === 'legacy';
  if (!activationPending && pages?.build_type !== 'workflow') throw new PagesError('Unknown Pages source; publication blocked.');
  if (pages.cname !== domain || pages.https_enforced !== true) {
    return blocked('Pages must keep app.snaptvnow.com and Enforce HTTPS enabled.');
  }
  const head = await get('git/ref/heads/main');
  const sha = head?.object?.sha;
  if (head?.ref !== 'refs/heads/main' || head?.object?.type !== 'commit' || !shaPattern.test(sha || '')) {
    throw new PagesError('Invalid main reference; Pages remains blocked.');
  }
  if (sha !== checkoutSha || (trigger && trigger.head_sha !== sha) ||
      (expectedSha !== undefined && expectedSha !== sha)) {
    return blocked('A newer main revision exists; this publication is superseded.');
  }
  const query = new URLSearchParams({head_sha: sha, branch: 'main', event: 'push', per_page: '30'});
  const data = await get(`actions/workflows/quality.yml/runs?${query}`);
  let run;
  try { run = qualityRun(data?.workflow_runs, sha, 'main'); } catch {
    throw new PagesError('Invalid Quality response; Pages remains blocked.');
  }
  if (!run) return blocked('Quality has not approved this main revision.');
  if (!positive(run.id) || !positive(run.run_attempt) || run.head_repository?.full_name !== repository) {
    throw new PagesError('Invalid Quality provenance; Pages remains blocked.');
  }
  // Do not revive an earlier success after a newer attempt/run starts or fails.
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return blocked('The latest Quality run or attempt has not succeeded.');
  }
  if ((trigger && (run.id !== trigger.id || run.run_attempt !== trigger.run_attempt)) ||
      (expectedSha !== undefined && (run.id !== expectedRunId || run.run_attempt !== expectedAttempt))) {
    return blocked('Quality approval changed; start a fresh Pages publication.');
  }
  // Refresh the selected run: a rerun can begin while the list is being read.
  const fresh = await get(`actions/runs/${run.id}`);
  if (fresh?.id !== run.id || fresh.run_attempt !== run.run_attempt || fresh.path !== workflow ||
      fresh.name !== 'Quality' || fresh.event !== 'push' || fresh.head_sha !== sha ||
      fresh.head_branch !== 'main' || fresh.head_repository?.full_name !== repository ||
      fresh.status !== 'completed' || fresh.conclusion !== 'success') {
    return blocked('Quality changed during verification; Pages remains blocked.');
  }
  if (activationPending) {
    return blocked('Activation pending: Settings > Pages > Source > GitHub Actions, then run Pages after Quality on main.');
  }
  return {ready: true, reason: 'Exact main revision approved by the latest successful push Quality run.',
    sha, runId: run.id, attempt: run.run_attempt};
}

export async function guardPages(env = process.env, args = process.argv.slice(2)) {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'});
  if (git.status !== 0 || dirty.status !== 0 || dirty.stdout.trim()) {
    throw new PagesError('Pages checkout must be readable and unchanged.');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  if (env.GITHUB_REPOSITORY !== repository) throw new PagesError('Unexpected Pages repository.');
  const result = await approvePages({eventName: env.GITHUB_EVENT_NAME, event, ref: env.GITHUB_REF,
    checkoutSha: git.stdout.trim(), token: env.PAGES_GITHUB_TOKEN,
    expectedSha: env.SNAP_PAGES_SHA,
    expectedRunId: env.SNAP_PAGES_SHA === undefined ? undefined : Number(env.SNAP_QUALITY_RUN_ID),
    expectedAttempt: env.SNAP_PAGES_SHA === undefined ? undefined : Number(env.SNAP_QUALITY_ATTEMPT)});
  console.log(result.reason);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.ready ? 'Pages verification passed' : 'Pages publication pending'}: ${result.reason}\n`);
  }
  if (args.includes('--require-approved') && !result.ready) throw new PagesError(result.reason);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `ready=${result.ready}\nsha=${result.sha || ''}\nrun_id=${result.runId || ''}\nattempt=${result.attempt || ''}\n`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  guardPages().catch(error => {
    // Only messages generated here are safe; file/transport errors can contain secrets.
    console.error(`PAGES BLOCKED: ${error instanceof PagesError ? error.message : 'verification failed. No publication was authorized.'}`);
    process.exitCode = 1;
  });
}

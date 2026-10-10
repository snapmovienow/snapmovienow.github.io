import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'snapmovienow/snapmovienow.github.io';
const workflow = '.github/workflows/quality.yml';
const pollMs = 20_000;
const timeoutMs = 12 * 60_000;

// A passing run for another revision, branch or workflow must never approve this build.
export function qualityRun(runs, sha, branch) {
  if (!Array.isArray(runs)) throw new Error('GitHub returned an invalid workflow response.');
  return runs.filter(run => run.head_sha === sha && run.head_branch === branch &&
    run.event === 'push' && run.path === workflow && run.name === 'Quality')
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
}

export async function waitForQuality({sha, branch, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, log = console.log, deadlineMs = timeoutMs}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !branch || branch.length > 255) {
    throw new Error('A complete commit SHA and branch are required for deployment.');
  }
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/quality.yml/runs`);
  url.search = new URLSearchParams({head_sha: sha, branch, event: 'push', per_page: '30'});
  const deadline = now() + deadlineMs;
  let failures = 0;
  let lastState;
  while (now() < deadline) {
    let run;
    try {
      const response = await fetchImpl(url, {
        headers: {'Accept': 'application/vnd.github+json', 'User-Agent': 'SNAPTVNOW-deploy-guard',
          'X-GitHub-Api-Version': '2022-11-28'},
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now())))
      });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const data = await response.json();
      run = qualityRun(data.workflow_runs, sha, branch);
      failures = 0;
    } catch (error) {
      failures++;
      if (failures >= 5) throw new Error(`Cannot verify Quality; deployment blocked (${error.message}).`);
      log(`Quality could not be read (${failures}/5); retrying without approving deployment.`);
      await wait(Math.min(pollMs, Math.max(0, deadline - now())));
      continue;
    }
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Quality ${run.conclusion || 'has no successful conclusion'}; deployment blocked. ${run.html_url || ''}`);
      }
      log(`Quality approved ${sha}: ${run.html_url}`);
      return run;
    }
    const state = run ? `${run.id}:${run.status}` : 'waiting-for-run';
    if (state !== lastState) {
      log(`Waiting for Quality on ${branch}@${sha.slice(0, 12)} (${run?.status || 'not started'}).`);
      lastState = state;
    }
    await wait(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error('Quality did not approve this commit within 12 minutes; deployment blocked.');
}

function git(...args) {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`Cannot inspect the deployment checkout: git ${args.join(' ')}.`);
  return result.stdout.trim();
}

export async function guardDeployment(env = process.env, args = process.argv.slice(2)) {
  // GitHub's Quality job also installs this package. Skipping outside Workers Builds
  // avoids waiting for the very job running this installation.
  if (env.WORKERS_CI !== '1' && !args.includes('--require-quality')) {
    console.log('Quality deployment guard: regular dependency installation.');
    return;
  }
  const sha = git('rev-parse', 'HEAD');
  const branch = env.WORKERS_CI === '1' ? env.WORKERS_CI_BRANCH : git('branch', '--show-current');
  if (env.WORKERS_CI === '1' && sha !== env.WORKERS_CI_COMMIT_SHA) {
    throw new Error('Cloudflare commit and checked-out commit differ; deployment blocked.');
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    throw new Error('Deployment checkout contains tracked modifications; deployment blocked.');
  }
  return waitForQuality({sha, branch});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  guardDeployment().catch(error => {
    console.error(`DEPLOYMENT BLOCKED: ${error.message}`);
    process.exitCode = 1;
  });
}

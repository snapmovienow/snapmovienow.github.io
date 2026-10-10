import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'snapmovienow/snapmovienow.github.io';
const workflow = '.github/workflows/quality.yml';
const pollMs = 60_000;
const timeoutMs = 12 * 60_000;

function seconds(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return 0;
  const ms = Number(value) * 1000;
  return Number.isSafeInteger(Math.ceil(ms)) ? Math.ceil(ms) : 0;
}

function timing(response, now) {
  const header = name => response.headers?.get(name);
  const retry = header('retry-after');
  const date = retry && !/^\d+(?:\.\d+)?$/.test(retry) ? Date.parse(retry) : NaN;
  const retryMs = Math.max(seconds(retry), Number.isFinite(date) ? date - now : 0);
  const reset = seconds(header('x-ratelimit-reset'));
  const exhausted = header('x-ratelimit-remaining') === '0';
  return {
    delay: Math.max(pollMs, seconds(header('x-poll-interval')), retryMs,
      exhausted && reset > now ? reset - now + 1000 : 0),
    exhausted,
    rateLimited: exhausted || retryMs > 0 || response.status === 429
  };
}

function githubHeaders(token) {
  const headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'SNAPTVNOW-deploy-guard',
    'X-GitHub-Api-Version': '2022-11-28'};
  if (token !== undefined && token !== '') {
    // Do not silently fall back to anonymous requests when a configured secret is invalid.
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/.test(token)) {
      throw new Error('QUALITY_GITHUB_TOKEN is invalid; deployment blocked.');
    }
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// A passing run for another revision, branch or workflow must never approve this build.
export function qualityRun(runs, sha, branch) {
  if (!Array.isArray(runs)) throw new Error('GitHub returned an invalid workflow response.');
  return runs.filter(run => run.head_sha === sha && run.head_branch === branch &&
    run.event === 'push' && run.path === workflow && run.name === 'Quality')
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
}

export async function waitForQuality({sha, branch, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, log = console.log, deadlineMs = timeoutMs, token}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !branch || branch.length > 255) {
    throw new Error('A complete commit SHA and branch are required for deployment.');
  }
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/quality.yml/runs`);
  url.search = new URLSearchParams({head_sha: sha, branch, event: 'push', per_page: '30'});
  const baseHeaders = githubHeaders(token);
  const deadline = now() + deadlineMs;
  let failures = 0;
  let lastState;
  let cachedRuns;
  let etag;
  const pause = async (ms, reason) => {
    if (ms >= deadline - now()) {
      throw new Error(`Cannot verify Quality; deployment blocked (${reason}; next check would exceed the build deadline).`);
    }
    await wait(ms);
  };
  while (now() < deadline) {
    let run;
    let delay = pollMs;
    let reason = 'GitHub transport or invalid workflow response';
    let fatal = false;
    try {
      const response = await fetchImpl(url, {
        headers: {...baseHeaders, ...(etag ? {'If-None-Match': etag} : {})},
        // A build secret must never be forwarded to a redirected host.
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now())))
      });
      const limits = timing(response, now());
      delay = limits.delay;
      if (response.status === 304) {
        if (!etag || !cachedRuns) throw new Error('No validated cached response.');
        run = qualityRun(cachedRuns, sha, branch);
      } else {
        if (!response.ok) {
          reason = `GitHub HTTP ${Number.isInteger(response.status) ? response.status : 'invalid'}` +
            (limits.exhausted ? '; API quota exhausted' : limits.rateLimited ? '; retry delay required' : '');
          fatal = response.status >= 400 && response.status < 500 &&
            response.status !== 403 && response.status !== 429;
          throw new Error('GitHub request rejected.');
        }
        const data = await response.json();
        run = qualityRun(data.workflow_runs, sha, branch);
        cachedRuns = data.workflow_runs;
        etag = response.headers?.get('etag');
      }
      failures = 0;
    } catch {
      failures++;
      if (fatal || failures >= 5) throw new Error(`Cannot verify Quality; deployment blocked (${reason}).`);
      delay = Math.max(delay, pollMs * 2 ** (failures - 1));
      // Never log exception messages or API bodies: they can contain credentials.
      log(`Quality could not be read (${failures}/5; ${reason}). Next check in ${Math.ceil(delay / 1000)}s; deployment remains blocked.`);
      await pause(delay, reason);
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
    if (delay >= deadline - now()) break;
    await wait(delay);
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
  return waitForQuality({sha, branch, token: env.QUALITY_GITHUB_TOKEN});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  guardDeployment().catch(error => {
    console.error(`DEPLOYMENT BLOCKED: ${error.message}`);
    process.exitCode = 1;
  });
}

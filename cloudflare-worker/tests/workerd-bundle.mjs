import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// esbuild leaves a relative import for each Wasm file, as Wrangler does.
// Keeping JS and Wasm separate lets workerd compile the real module before use.
export const workerBundleOptions = {
  bundle: true,
  platform: 'browser',
  format: 'esm',
  external: ['cloudflare:*'],
  loader: { '.wasm': 'copy' },
  outdir: 'worker-test-build',
  write: false,
};

export function bundledWorkerModules(result, preamble = '') {
  const entry = result.outputFiles.find(file => file.path.endsWith('.js'));
  if (!entry) throw new Error('Worker bundle is missing its JavaScript entry point');
  return [
    { type: 'ESModule', path: basename(entry.path), contents: preamble + entry.text },
    ...result.outputFiles.filter(file => file.path.endsWith('.wasm')).map(file => ({
      type: 'CompiledWasm', path: basename(file.path), contents: file.contents,
    })),
  ];
}

export function releaseWorkerModules(entryPath) {
  const directory = dirname(entryPath);
  return [
    { type: 'ESModule', path: basename(entryPath), contents: readFileSync(entryPath, 'utf8') },
    ...readdirSync(directory).filter(name => name.endsWith('.wasm')).map(name => ({
      type: 'CompiledWasm', path: name, contents: readFileSync(join(directory, name)),
    })),
  ];
}

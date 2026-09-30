import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILD_ENTRIES } from './publish-entries.mjs';

const packageRoot = resolve(import.meta.dirname, '..');

rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });

const entries = BUILD_ENTRIES;

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: packageRoot,
        encoding: 'utf8',
    });
    // Route build diagnostics to stderr so `npm pack --json` output stays clean.
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

run('bun', [
    'build',
    ...entries,
    '--outdir',
    'dist',
    // Flat `dist/<entry>.js` layout, which is what the published `exports`
    // subpaths point at (declarations land beside them from `tsc`).
    '--root',
    'src',
    '--target',
    'node',
    '--format',
    'esm',
    '--packages',
    'external',
]);
run('bun', ['x', 'tsc', '-p', 'tsconfig.build.json']);

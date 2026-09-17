import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');

rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });

const entries = [
    'src/index.ts',
    'src/manifest.ts',
    'src/host.ts',
    'src/testing.ts',
    'src/ui.ts',
    'src/portable.ts',
    'src/profile.ts',
    'src/package-tree.ts',
    'src/state-compatibility.ts',
    'src/cli/index.ts',
    'src/cli/archive.ts',
];

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
    '--target',
    'node',
    '--format',
    'esm',
    '--packages',
    'external',
]);
run('bun', ['x', 'tsc', '-p', 'tsconfig.build.json']);

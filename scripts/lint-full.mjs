import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// ESLint retains each type-aware project for the lifetime of its process.
// Lint these high-memory scopes separately, then lint the rest of the tree.
// Paths outside the listed scopes (including future directories) remain in
// the final pass. Each pass keeps the normal configuration and zero warnings.
const scopes = [
    'app', 'server', 'shared', 'audit-evidence', 'modules',
    'packages/or3-cloud', 'packages/hosted-billing', 'packages/cloud-waitlist',
    'packages/plugin-sdk/src/[a-f]*.ts', 'packages/plugin-sdk/src/[g-m]*.ts',
    'packages/plugin-sdk/src/[n-s]*.ts', 'packages/plugin-sdk/src/[t-z]*.ts',
    'packages/plugin-sdk/src/cli',
    'config.or3.ts', 'config.or3cloud.ts',
];
const require = createRequire(import.meta.url);
const eslint = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');
let exitCode = 0;

for (const scope of scopes) {
    console.log(`Linting ${scope}`);
    const result = spawnSync(process.execPath, [eslint, scope, '--no-error-on-unmatched-pattern', '--max-warnings=0'], { stdio: 'inherit' });
    if (result.error || result.signal || result.status !== 0) {
        if (result.error) console.error(result.error.message);
        if (result.signal) console.error(`ESLint terminated by ${result.signal} while linting ${scope}`);
        exitCode = 1;
    }
}

console.log('Linting remaining files');
const ignoreArgs = scopes.flatMap(scope => [
    '--ignore-pattern', `./${scope}${scope.endsWith('.ts') ? '' : '/**'}`,
]);
const result = spawnSync(process.execPath, [eslint, '.', ...ignoreArgs, '--max-warnings=0'], { stdio: 'inherit' });
if (result.error || result.signal || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    if (result.signal) console.error(`ESLint terminated by ${result.signal} while linting remaining files`);
    exitCode = 1;
}
process.exitCode = exitCode;

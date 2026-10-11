// Run from the repository root with Bun. Only synthetic, mocked/local fixtures.
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const directory = await mkdtemp('/tmp/or3-isolation-base-');
const base = 'f9ea3ce69b598bfca7e3a1978024a0b9f9d49655';
const tests = [
    'server/api/storage/__tests__/presign-membership-continuation.test.ts',
];
async function run(args: string[], cwd = root) {
    const process = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([
        new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    return { code, output: output + errors };
}
let added = false;
try {
    const checkout = await run(['git', 'worktree', 'add', '--detach', directory, base]);
    if (checkout.code !== 0) throw new Error(checkout.output);
    added = true;
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'));
    // These canonical Vitest suites use explicit aliases; they do not need a
    // generated Nuxt build. Supply transform settings without generated refs.
    await Bun.write(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler',
    } }));
    for (const file of tests) await Bun.write(join(directory, file), await Bun.file(join(root, file)).text());
    const result = await run(['bun', 'x', 'vitest', 'run', ...tests,
        '--bail=0', '--maxWorkers=2', '--reporter=dot', '--silent=passed-only',
        '--testNamePattern=lookup returns a stale snapshot|bounds retries|unrelated identity'], directory);
    await Bun.write(join(root, 'audit-evidence/workspace-isolation-20261011/membership-snapshot-counterfactual.txt'),
        `Intermediate source before the revision fence: ${base}\nCommand: Bun Vitest canonical regression suites in a disposable worktree\n${result.output}\nExit status: ${result.code}\n`);
    console.log(result.output);
    if (result.code !== 1 || /Failed Suites|no tests|Fixture did not reach/.test(result.output)) {
        throw new Error(`Expected failing regression assertions, got exit ${result.code} or suite setup failure`);
    }
} finally {
    if (added) {
        const removed = await run(['git', 'worktree', 'remove', '--force', directory]);
        if (removed.code !== 0) throw new Error(removed.output);
    } else await rm(directory, { recursive: true, force: true });
}

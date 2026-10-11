// Run from the repository root with Bun. Only synthetic, mocked/local fixtures.
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const directory = await mkdtemp('/tmp/or3-isolation-base-');
const base = 'df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5';
const tests = [
    'app/composables/core/__tests__/usePreviewCache.test.ts',
    'app/pages/images/__tests__/image-viewer.cache.test.ts',
    'app/pages/images/__tests__/useImageGallery.integration.test.ts',
    'app/pages/images/__tests__/copy-image-to-clipboard.test.ts',
    'server/utils/background-jobs/__tests__/stream-handler.tools.test.ts',
    'app/composables/chat/__tests__/backgroundJobs.reattach-notify.test.ts',
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
        '--testNamePattern=shared preview workspace|held preview|displayed preview|cached-load continuation|gallery upload batch|gallery picker ownership|fences gallery|fences delayed palette|rechecks ownership after awaited PNG|held canonical ownership|membership becomes|awaited canonical ownership|former account completion'], directory);
    await Bun.write(join(root, 'audit-evidence/workspace-isolation-20261011/baseline-regressions.txt'),
        `Base: ${base}\nCommand: Bun Vitest canonical regression suites in a disposable worktree\n${result.output}\nExit status: ${result.code}\n`);
    console.log(result.output);
    if (result.code !== 1 || /Failed Suites|no tests/.test(result.output)) {
        throw new Error(`Expected failing regression assertions, got exit ${result.code} or suite setup failure`);
    }
} finally {
    if (added) {
        const removed = await run(['git', 'worktree', 'remove', '--force', directory]);
        if (removed.code !== 0) throw new Error(removed.output);
    } else await rm(directory, { recursive: true, force: true });
}

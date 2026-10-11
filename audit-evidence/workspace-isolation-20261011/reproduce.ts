// Run from the repository root with Bun. Only synthetic, mocked/local fixtures.
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const directory = await mkdtemp('/tmp/or3-isolation-base-');
const base = 'df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5';
const tests = [
    'app/composables/notifications/__tests__/useNotifications.test.ts',
    'app/composables/plugins/__tests__/trusted-workspace-files.integration.test.ts',
    'app/composables/search/__tests__/useCommandPalette.test.ts',
    'server/api/storage/__tests__/presign-membership-continuation.test.ts',
    'app/composables/core/__tests__/useThumbnailUrlCache.test.ts',
    'app/composables/chat/__tests__/useMessageMediaPrefetch.test.ts',
    'app/components/chat/__tests__/workspace-thumbnails.test.ts',
    'server/utils/workflows/__tests__/plugin-server-bridge.test.ts',
    'app/composables/core/__tests__/usePreviewCache.test.ts',
    'app/pages/images/__tests__/image-viewer.cache.test.ts',
    'app/pages/images/__tests__/useImageGallery.integration.test.ts',
    'app/pages/images/__tests__/copy-image-to-clipboard.test.ts',
    'server/utils/background-jobs/__tests__/stream-handler.tools.test.ts',
    'app/composables/chat/__tests__/backgroundJobs.reattach-notify.test.ts',
];
const preferencesOnly = process.argv.includes('--preferences-only');
const selectedTests = preferencesOnly
    ? tests.filter(file => file.endsWith('/useNotifications.test.ts'))
    : tests;
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
    for (const file of selectedTests) await Bun.write(join(directory, file), await Bun.file(join(root, file)).text());
    const result = await run(['bun', 'x', 'vitest', 'run', ...selectedTests,
        '--bail=0', '--maxWorkers=2', '--reporter=dot', '--silent=passed-only',
        '--testNamePattern=keeps suspended (muteThread|unmuteThread) persistence|uses originating workspace mute preferences|retains (the )?admitted tracker account|redacts failed plugin file reads|fences plugin file read|native blob conversion|reports read completion|late palette action|shared preview workspace|held preview|displayed preview|cached-load continuation|gallery upload batch|gallery picker ownership|fences gallery|fences delayed palette|rechecks ownership after awaited PNG|held canonical ownership|membership becomes|awaited canonical ownership|former account completion|held quota|held canonical metadata|held signer|held workflow|shared thumbnail|held thumbnail|next workspace thumbnail|mounted thumbnail workspace consumers|held prefetch metadata'], directory);
    await Bun.write(join(root, `audit-evidence/workspace-isolation-20261011/${preferencesOnly ? 'mute-persistence-concurrent-base' : 'baseline-regressions'}.txt`),
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

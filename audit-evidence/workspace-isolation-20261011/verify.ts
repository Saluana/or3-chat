// Run from the repository root with Bun; all fixtures are synthetic/local/mocked.
const tests = [
    'app/composables/core/__tests__/useWorkspaceTabMetadata.test.ts',
    'app/composables/core/__tests__/useWorkspaceTabMetadata.workspace.integration.test.ts',
    'app/composables/core/__tests__/useWorkspaceTabs.test.ts',
    'app/composables/core/__tests__/useWorkspaceTabPersistence.test.ts',
    'app/composables/core/__tests__/useWorkspaceTabHost.test.ts',
    'app/components/notifications/__tests__/NotificationItem.test.ts',
    'app/composables/plugins/__tests__/trusted-workspace-files.integration.test.ts',
    'app/composables/plugins/__tests__/trusted-host-context.test.ts',
    'app/composables/search/__tests__/useCommandPalette.test.ts',
    'server/api/storage/__tests__/presign-membership-continuation.test.ts',
    'app/composables/core/__tests__/useThumbnailUrlCache.test.ts',
    'app/composables/chat/__tests__/useMessageMediaPrefetch.test.ts',
    'app/components/chat/__tests__/workspace-thumbnails.test.ts',
    'app/components/search/__tests__/CommandPalette.test.ts',
    'app/components/search/__tests__/CommandPaletteActionTray.test.ts',
    'server/api/jobs/__tests__/authorization.test.ts',
    'server/api/sync/__tests__/workspace-isolation.integration.test.ts',
    'app/core/search/command-palette/__tests__/workspace-isolation.integration.test.ts',
    'tests/integration/workspace-switch-runtime.integration.test.ts',
    'server/api/storage/__tests__/download-isolation.test.ts',
    'server/api/storage/__tests__/presign-download.post.test.ts',
    'server/api/storage/__tests__/presign-upload.post.test.ts',
    'server/api/storage/__tests__/presign-expiry.test.ts',
    'tests/unit/auth-can-workspace-scoping.test.ts',
    'app/utils/chat/useAi-internal/__tests__/backgroundJobPersistence.test.ts',
    'app/composables/chat/__tests__/backgroundJobs.reattach-notify.test.ts',
    'app/composables/sidebar/__tests__/useSidebarSearch.test.ts',
    'server/utils/background-jobs/__tests__/stream-handler.tools.test.ts',
    'server/utils/chat/__tests__/tool-registry.test.ts',
    'server/utils/chat/__tests__/server-tool-ownership-adapter.test.ts',
    'server/utils/workflows/__tests__/plugin-server-bridge.test.ts',
    'app/pages/images/__tests__/useImageGallery.integration.test.ts',
    'app/pages/images/__tests__/copy-image-to-clipboard.test.ts',
    'app/core/search/__tests__/useImageSearch.test.ts',
    'app/composables/core/__tests__/usePreviewCache.test.ts',
    'app/pages/images/__tests__/image-viewer.cache.test.ts',
    'app/pages/images/__tests__/gallery-grid.lifecycle.test.ts',
    'app/pages/images/__tests__/gallery-grid.error.test.ts',
    'app/pages/images/__tests__/image-viewer.error.test.ts',
    'server/auth/__tests__/session.test.ts',
    'app/composables/chat/__tests__/useAi.backgroundDetach.test.ts',
    'app/utils/chat/__tests__/generation-lease.test.ts',
    'app/utils/chat/__tests__/transcript-repository.test.ts',
    'app/db/__tests__/message-files-ref-count.integration.test.ts',
    'server/utils/background-jobs/__tests__/memory-lifecycle.test.ts',
    'server/utils/background-jobs/__tests__/recovery.test.ts',
    'app/core/notifications/__tests__/notification-service.test.ts',
    'app/composables/notifications/__tests__/useNotifications.test.ts',
];
const command = ['bun', 'x', 'vitest', 'run', ...tests, '--reporter=dot', '--silent=passed-only', '--maxWorkers=2'];
const headProcess = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe' });
const head = (await new Response(headProcess.stdout).text()).trim();
if (await headProcess.exited !== 0) throw new Error('Cannot identify test commit');
const result = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
const [stdout, stderr, code] = await Promise.all([
    new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited,
]);
await Bun.write('audit-evidence/workspace-isolation-20261011/final-verification.txt',
    `Commit: ${head}\nCommand: ${command.join(' ')}\n${stdout}${stderr}\nExit status: ${code}\n`);
console.log(stdout + stderr);
process.exitCode = code;

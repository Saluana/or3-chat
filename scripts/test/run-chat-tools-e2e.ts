function git(...args: string[]) {
    const result = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(`Cannot identify test source: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
}

const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/chat-tools.spec.ts', '--workers=1',
    '--reporter=line,./scripts/test/chat-tools-reporter.ts', '--output=test-results/chat-tools/browser',
    ...process.argv.slice(2)], {
    stdout: 'inherit', stderr: 'inherit', env: { ...process.env,
        OPENROUTER_API_KEY: '', OR3_OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '',
        OR3_CHAT_TOOLS_TEST_HARNESS: 'true', SSR_AUTH_ENABLED: 'false',
        OR3_SYNC_ENABLED: 'false', OR3_CLOUD_SYNC_ENABLED: 'false',
        OR3_STORAGE_ENABLED: 'false', OR3_CLOUD_STORAGE_ENABLED: 'false', OR3_BACKGROUND_STREAMING_ENABLED: 'false',
        PW_PORT: '3117', PW_SKIP_WEB_SERVER: 'false',
        OR3_CHAT_TOOLS_SOURCE_COMMIT: git('rev-parse', 'HEAD'),
        OR3_CHAT_TOOLS_SOURCE_DIRTY: String(!!git('status', '--porcelain')),
    },
});
process.exitCode = await child.exited;

// This opt-in test makes paid requests. The environment file is read only by
// the test process; no credential is copied into the checkout or command line.
if (!process.env.OR3_LIVE_ENV_PATH) throw new Error('Set OR3_LIVE_ENV_PATH to the OpenRouter environment file.');
const profile = process.env.OR3_DELEGATION_LIVE_PROFILE ?? 'foreground';
if (!['foreground', 'durable'].includes(profile)) throw new Error('OR3_DELEGATION_LIVE_PROFILE must be foreground or durable.');
if (profile === 'durable') {
    const child = Bun.spawn(['bun', 'scripts/test/run-chat-tools-cloud-e2e.ts', ...process.argv.slice(2)], {
        stdout: 'inherit', stderr: 'inherit', env: { ...process.env,
            OR3_DELEGATION_LIVE_DURABLE: 'true', OR3_CHAT_TOOLS_JOB_PROVIDER: 'sqlite',
            OR3_DELEGATION_DRAFT_E2E: process.env.OR3_DELEGATION_LIVE_SIMULATION === 'true' ? 'true' : 'false',
            OR3_DELEGATION_LIVE_E2E: 'false' },
    });
    process.exitCode = await child.exited;
} else {
const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/chat-delegation-live.spec.ts',
    '--workers=1', '--reporter=line', '--output=test-results/chat-delegation-live', ...process.argv.slice(2)], {
    stdout: 'inherit', stderr: 'inherit', env: { ...process.env,
        OR3_DELEGATION_LIVE_E2E: 'true', OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'false', SSR_AUTH_ENABLED: 'false',
        OPENROUTER_API_KEY: '', OR3_OPENROUTER_API_KEY: '', NUXT_OPENROUTER_API_KEY: '',
        OR3_SYNC_ENABLED: 'false', OR3_CLOUD_SYNC_ENABLED: 'false',
        OR3_STORAGE_ENABLED: 'false', OR3_CLOUD_STORAGE_ENABLED: 'false',
        OR3_BACKGROUND_STREAMING_ENABLED: 'false', PW_PORT: process.env.PW_PORT ?? '3145',
    },
});
process.exitCode = await child.exited;
}

// This opt-in test makes paid requests. The environment file is read only by
// the test process; no credential is copied into the checkout or command line.
if (!process.env.OR3_LIVE_ENV_PATH) throw new Error('Set OR3_LIVE_ENV_PATH to the OpenRouter environment file.');
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

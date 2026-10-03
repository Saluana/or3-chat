import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

const requestedPort = Number(process.env.PW_PORT);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)
    throw new Error('Assign PW_PORT for the sequential context lane before running this harness.');
if (process.env.PW_SKIP_WEB_SERVER !== 'true') {
    await new Promise<void>((done, reject) => { const server = createServer(); server.on('error', reject);
        server.listen(requestedPort, '127.0.0.1', () => server.close((error) => error ? reject(error) : done())); });
}
const output = resolve(process.env.OR3_CONTEXT_ARTIFACT_DIR ?? '.qualification/context'); await mkdir(output, { recursive: true });
const scenario = process.env.OR3_CONTEXT_SCENARIO ?? 'all';
if (!['all', 'recovery', 'compaction', 'history'].includes(scenario)) throw new Error('Unknown context scenario.');
const selection = scenario === 'all' ? 'compaction|context recovery' : scenario === 'recovery' ? 'native context recovery'
    : scenario === 'history' ? 'compaction history and families' : 'PageShell compaction';
const source = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'pipe' });
if (source.exitCode) throw new Error('Cannot identify the context source revision.');
const sha = source.stdout.toString().trim();
const dirty = Bun.spawnSync(['git', 'status', '--porcelain'], { stdout: 'pipe', stderr: 'pipe' }).stdout.toString();
await writeFile(resolve(output, 'source.json'), JSON.stringify({ sha, dirty, fixture: 'production-chat-journey-v3',
    scope: 'native context recovery, manual compaction, history tools and families', providerTraffic: 'scripted only' }, null, 2));
const child = Bun.spawn(['bunx', 'playwright', 'test', 'tests/e2e/production-chat-journey.spec.ts',
    '--grep', selection, '--workers=1', '--retries=0', '--reporter=line,json', '--output', resolve(output, 'browser')], {
    stdout: 'inherit', stderr: 'inherit', env: { ...process.env, OR3_PRODUCTION_JOURNEY_TEST_HARNESS: 'true',
        SSR_AUTH_ENABLED: 'false', OR3_SYNC_ENABLED: 'false', OR3_CLOUD_SYNC_ENABLED: 'false', OR3_STORAGE_ENABLED: 'false',
        OR3_CLOUD_STORAGE_ENABLED: 'false', OR3_BACKGROUND_STREAMING_ENABLED: 'false',
        OR3_CONTEXT_SOURCE_SHA: sha, PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(output, 'playwright-report.json') },
});
process.exit(await child.exited);

#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// This disposable profile opts in an unpublished build. It is not a release
// qualification and never changes the installed provider in the source tree.
const source = process.cwd();
const artifact = process.env.OR3_SQLITE_DELEGATION_ARTIFACT;
if (!artifact) throw new Error('OR3_SQLITE_DELEGATION_ARTIFACT must point to an extracted draft package.');
const selectedCase = process.env.OR3_DELEGATION_DRAFT_CASE ?? 'closure';
if (!['closure', 'restart', 'parent-restart', 'safe', 'settled-restart', 'composer', 'offline', 'single', 'search', 'live-fixture', 'live'].includes(selectedCase)) throw new Error('Unknown draft delegation case.');
const candidate = process.env.OR3_DELEGATION_ADVERTISED_CANDIDATE === 'true';
const liveFixture = selectedCase === 'live-fixture';
const live = selectedCase === 'live';
if (live && (!candidate || !process.env.OR3_LIVE_ENV_PATH)) throw new Error('The live candidate profile requires an advertised candidate and OR3_LIVE_ENV_PATH.');
const liveProfile = live || liveFixture;
const settledCase = selectedCase === 'settled-restart';
const restartCase = selectedCase === 'restart' || selectedCase === 'parent-restart' || selectedCase === 'safe' || settledCase;
const safeCase = selectedCase === 'safe';
const coordinatorGate = safeCase || settledCase;
const manifest = JSON.parse(await readFile(join(artifact, 'package.json'), 'utf8')) as { name: string; version: string };
if (manifest.name !== 'or3-provider-sqlite') throw new Error('Expected an extracted SQLite provider package.');
const root = await mkdtemp('/private/tmp/or3-delegation-draft-e2e-');
const output = join(source, 'test-results', candidate ? 'delegation-candidate-cloud' : 'delegation-draft-cloud', live ? 'live' : liveFixture ? 'live-fixture' : settledCase ? 'settled-restart' : safeCase ? 'safe-restart' : selectedCase === 'parent-restart' ? 'parent-restart' : restartCase ? 'restart' : selectedCase === 'composer' || selectedCase === 'offline' ? selectedCase : selectedCase === 'single' ? 'single' : selectedCase === 'search' ? 'search' : 'browser-closure');
let exitCode = 1;
let originalHash = '';
let testHash = '';
try {
    for (const name of await readdir(source)) {
        if (name.startsWith('.') || ['node_modules', 'output', 'test-results', 'playwright-report'].includes(name)) continue;
        if (['package.json', 'nuxt.config.ts', 'config.or3.ts', 'config.or3cloud.ts', 'playwright.config.ts', 'tsconfig.json'].includes(name)) {
            let contents = await readFile(join(source, name), 'utf8');
            if (name === 'nuxt.config.ts') {
                const allow = "allow: [resolve(__dirname, '..')]";
                if (!contents.includes(allow)) throw new Error('The disposable profile must preserve the source Vite allow tree.');
                contents = contents.replace(allow, `allow: [resolve(__dirname, '..'), ${JSON.stringify(resolve(source, '..'))}]`);
            }
            await writeFile(join(root, name), contents);
        } else if (['scripts', 'app', 'server', 'shared', 'utils', 'plugins', 'extensions', 'official-plugins', 'modules', 'types'].includes(name)) {
            await cp(join(source, name), join(root, name), { recursive: true });
        } else if (name !== 'or3.providers.generated.ts') await symlink(join(source, name), join(root, name));
    }
    await mkdir(join(root, 'node_modules'));
    for (const name of await readdir(join(source, 'node_modules'))) {
        if (name === '.cache' || name === '.vite') continue;
        if (name === 'or3-provider-sqlite') await cp(artifact, join(root, 'node_modules', name), { recursive: true });
        else await symlink(join(source, 'node_modules', name), join(root, 'node_modules', name));
    }
    const runtime = join(root, 'node_modules/or3-provider-sqlite/dist/runtime/server/background-jobs/sqlite-provider.js');
    const original = await readFile(runtime, 'utf8');
    if (!original.includes('export const sqliteBackgroundJobProvider = new SqliteBackgroundJobProvider()') ||
        original.includes('delegationCoordinatorVersion') !== candidate) throw new Error('Unexpected SQLite draft capability state.');
    const enabled = `${original}${candidate ? '' : `\nObject.defineProperty(sqliteBackgroundJobProvider, 'delegationCoordinatorVersion', { value: 1 });\n`}${coordinatorGate ? `\nimport { existsSync as testGateExists } from 'node:fs';\nconst testClaimWait = sqliteBackgroundJobProvider.claimNextDelegationWait.bind(sqliteBackgroundJobProvider);\nsqliteBackgroundJobProvider.claimNextDelegationWait = (...args) => testGateExists(process.env.OR3_DELEGATION_COORDINATOR_GATE || '') ? Promise.resolve(null) : testClaimWait(...args);\n` : ''}`;
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    originalHash = sha(original); testHash = sha(enabled);
    if (enabled !== original) await writeFile(runtime, enabled);
    if (restartCase) {
        // Only the disposable server records its own PID; the harness verifies
        // its private process-group identity before simulating a crash.
        await writeFile(join(root, 'server/plugins/99.delegation-test-process.ts'), `import { writeFileSync } from 'node:fs';\nimport { defineNitroPlugin } from 'nitropack/runtime';\nexport default defineNitroPlugin(() => { if (!process.env.OR3_DELEGATION_PROCESS_FILE) throw new Error('Missing test PID file'); writeFileSync(process.env.OR3_DELEGATION_PROCESS_FILE, String(process.pid), { mode: 0o600 }); });\n`);
    }
    console.log(`Disposable SQLite ${manifest.version}: ${candidate ? (coordinatorGate ? 'advertised candidate with test-only coordinator gate' : 'advertised candidate, runtime unchanged') : 'test-only capability enabled'} (runtime ${originalHash} -> ${testHash}).`);
    const liveEnv = join(root, 'live-fixture.env');
    if (liveFixture) await writeFile(liveEnv, 'OPENROUTER_API_KEY=disposable-fixture-key\n', { mode: 0o600 });
    const args = liveProfile ? ['bun', 'run', 'test:e2e:chat-delegation:live'] : ['bun', 'run', 'test:e2e:chat-tools:cloud', '--grep', settledCase
        ? 'durable delegation completed children restart' : safeCase
        ? 'durable delegation safe checkpoint' : selectedCase === 'parent-restart' ? 'durable delegation interrupted parent dispatch' : restartCase ? 'durable delegation interrupted dispatch'
            : selectedCase === 'composer' ? 'durable delegation composer browser closure' : selectedCase === 'offline' ? 'durable delegation composer offline reconnect' : selectedCase === 'single' ? 'durable delegation single mobile'
                : selectedCase === 'search' ? 'durable delegation searches the catalog' : 'durable delegation browser closure'];
    const child = Bun.spawn(args, {
        cwd: root, stdout: 'inherit', stderr: 'inherit', env: { ...process.env,
            OR3_CHAT_TOOLS_JOB_PROVIDER: 'sqlite', OR3_DELEGATION_DRAFT_E2E: 'true', OR3_E2E_SOURCE_ROOT: source,
            OR3_DELEGATION_MANAGED_SERVER: restartCase ? 'true' : 'false', OR3_DELEGATION_SAFE_GATE: coordinatorGate ? 'true' : 'false',
            OR3_DELEGATION_SETTLED_RESTART: settledCase ? 'true' : 'false',
            OR3_DELEGATION_LIVE_SIMULATION: liveFixture ? 'true' : 'false',
            OR3_DELEGATION_LIVE_PROFILE: liveProfile ? 'durable' : 'foreground',
            OR3_DELEGATION_LIVE_MODEL: liveFixture ? 'fixture/model' : live ? (process.env.OR3_DELEGATION_LIVE_MODEL ?? 'openai/gpt-6-luna') : '',
            OR3_LIVE_ENV_PATH: liveFixture ? liveEnv : live ? process.env.OR3_LIVE_ENV_PATH : '',
            OR3_DELEGATION_HOLD_PARENT: selectedCase === 'parent-restart' ? 'true' : 'false' },
    });
    exitCode = await child.exited;
    await mkdir(output, { recursive: true });
    await rm(join(output, 'test-results'), { recursive: true, force: true });
    await cp(join(root, `test-results/${liveProfile ? 'chat-delegation-durable-live' : 'chat-tools-cloud'}`), join(output, 'test-results'), { recursive: true }).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
    await writeFile(join(output, 'profile.json'), JSON.stringify({ provider: manifest.name, version: manifest.version,
        sourceRuntimeSha256: originalHash, testRuntimeSha256: testHash, testOnlyCapabilityOverride: !candidate,
        testOnlyCoordinatorGate: coordinatorGate, installedOrReleasedQualification: false, case: selectedCase, exitCode }, null, 2));
    process.exitCode = exitCode;
} finally {
    async function writableDirectories(path: string): Promise<void> {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return;
        await chmod(path, stat.mode | 0o700);
        for (const name of await readdir(path)) await writableDirectories(join(path, name));
    }
    await writableDirectories(root);
    await rm(root, { recursive: true, force: true });
}

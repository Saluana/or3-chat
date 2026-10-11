#!/usr/bin/env bun
// Explicit, local Docker qualification. Requires a prebuilt source image;
// never pulls an image, enables physical cleanup, or opens a remote provider.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { backupCommand } from '../../packages/or3-cloud/src/commands/backup';
import { restoreCommand } from '../../packages/or3-cloud/src/commands/restore';
import { recoverCommand } from '../../packages/or3-cloud/src/commands/recover';
import { restoreVolumeArchive } from '../../packages/or3-cloud/src/backup/archive';
import { readManifest, writeBackupAuthentication } from '../../packages/or3-cloud/src/backup/manifests';
import { copyAssets } from '../../packages/or3-cloud/src/deployment/assets';
import { buildEnv, serializeEnv, withoutProvisioningCredentials } from '../../packages/or3-cloud/src/deployment/env';
import { readState, stateFromEnv, writeState } from '../../packages/or3-cloud/src/deployment/state-store';
import { lifecycleFaults } from '../../packages/or3-cloud/src/lifecycle-faults';
import { run } from '../../packages/or3-cloud/src/runtime/command-runner';
import { composeArgs } from '../../packages/or3-cloud/src/runtime/compose';
import { imageDigest } from '../../packages/or3-cloud/src/runtime/images';
import { startProject, stopProject } from '../../packages/or3-cloud/src/runtime/project';
import { PACKAGE_VERSION } from '../../packages/or3-cloud/src/package-info';
import { sha256File } from '../../packages/or3-cloud/src/util/fs';

const image = process.env.OR3_BACKUP_DRILL_IMAGE;
const nodePath = process.env.OR3_BACKUP_DRILL_NODE_PATH ?? '/usr/local/bin/node';
assert(['/usr/local/bin/node', '/nodejs/bin/node'].includes(nodePath), 'Choose the fixture bookworm or distroless Node path.');
assert(image && !image.includes('@') && image.startsWith('or3-backup-drill:'), 'Set OR3_BACKUP_DRILL_IMAGE to a prebuilt local or3-backup-drill:<tag> image.');
const evidencePath = resolve(process.env.OR3_BACKUP_DRILL_EVIDENCE ?? 'output/backup-restore-drill.json');
const deep = process.argv.includes('--deep');
const concurrencyOnly = process.argv.includes('--concurrency-only');
const archiveRaceOnly = process.argv.includes('--archive-race-only');
const blobContentOnly = process.argv.includes('--blob-content-only');
const alternateStorageOnly = process.argv.includes('--alternate-storage-only');
const emptyStorageOnly = process.argv.includes('--empty-storage-only');
const filesystemCompatOnly = process.argv.includes('--filesystem-compat-only') || alternateStorageOnly || emptyStorageOnly;
assert(!(alternateStorageOnly && emptyStorageOnly), 'Choose either alternate or empty filesystem qualification.');
const workspaceOmissionOnly = process.argv.includes('--workspace-omission-only');
const multiWorkspaceOnly = process.argv.includes('--multi-workspace-only') || workspaceOmissionOnly;
const builtCliOnly = process.argv.includes('--built-cli-only');
const recoveryOnly = process.argv.includes('--recovery-only');
const prestartCrashOnly = process.argv.includes('--prestart-crash-only');
const crashOnly = process.argv.includes('--crash-only') || prestartCrashOnly;
const browserOnly = process.argv.includes('--browser-only');
const journalOnly = process.argv.includes('--journal-only');
const attachmentOnly = process.argv.includes('--attachment-only');
const sqliteWalOnly = process.argv.includes('--sqlite-wal-only');
const walFrameOnly = process.argv.includes('--wal-frame-only');
const walTailOnly = process.argv.includes('--wal-tail-only');
const walCorruptionOnly = process.argv.includes('--wal-corruption-only') || walFrameOnly || walTailOnly;
const sqliteOnly = process.argv.includes('--sqlite-only') || sqliteWalOnly || walCorruptionOnly;
const sparseOnly = process.argv.includes('--sparse-capacity-only');
const capacityOnly = process.argv.includes('--capacity-only') || sparseOnly;
assert(Number(deep) + Number(filesystemCompatOnly) + Number(blobContentOnly) + Number(archiveRaceOnly) + Number(concurrencyOnly) + Number(multiWorkspaceOnly) + Number(builtCliOnly) + Number(recoveryOnly) + Number(crashOnly) + Number(browserOnly) + Number(journalOnly) + Number(attachmentOnly) + Number(sqliteOnly) + Number(capacityOnly) <= 1, 'Choose one qualification mode.');
assert(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'Remote Docker is forbidden.');
const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
if (browserOnly && proxyKeys.some(key => process.env[key])) {
  // Bun snapshots proxy defaults before this module runs. Start the browser
  // qualifier once with no proxy configuration, before creating any fixture.
  const childEnv = { ...process.env };
  for (const key of proxyKeys) delete childEnv[key];
  for (const key of Object.keys(childEnv)) {
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(key)) delete childEnv[key];
    if (key.startsWith('OR3_') && !key.startsWith('OR3_BACKUP_DRILL_')) delete childEnv[key];
  }
  const child = spawn(process.execPath, process.argv.slice(1), { env: childEnv, stdio: 'inherit' });
  const code = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
  process.exit(code);
}
// Provider/config values come exclusively from synthetic fixture files below.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('OR3_') || /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(key)) delete process.env[key];
}
// The drill connects only to its local Docker daemon and disposable apps.
// Bun's HTTP compatibility layer can otherwise proxy Docker bridge traffic.
for (const key of proxyKeys) delete process.env[key];
process.env.OR3_CLOUD_SKIP_PULL = 'true';
process.env.OPENROUTER_API_KEY = '';
process.env.NUXT_OPENROUTER_API_KEY = '';
const root = await mkdtemp(join(tmpdir(), 'or3-backup-drill-'));
const outcomes: Array<{ name: string; kind: 'passed' | 'limitation' | 'cleanup-failure'; detail?: unknown }> = [];
let completed = false;
let cleanupFailed = false;
async function command(args: string[], directory?: string) {
  const result = await run('docker', args, directory);
  assert(result.ok, result.stderr);
  return result.stdout.trim();
}
const context = await command(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
assert(context.startsWith('unix://'), 'Selected Docker daemon must be local.');
const digest = await imageDigest(image);
const sourceRevision = await command(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', image]);
assert(/^[a-f0-9]{40}$/.test(sourceRevision));
const cliVersion = await run('git', ['rev-parse', 'HEAD'], fileURLToPath(new URL('../../', import.meta.url)));
assert(cliVersion.ok && /^[a-f0-9]{40}$/.test(cliVersion.stdout.trim()), 'Record the CLI source commit separately from the app image commit.');
const cliRevision = cliVersion.stdout.trim();
assert.equal(await command(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.version"}}', image]), PACKAGE_VERSION);
const password = `Synthetic-${randomUUID()}!Aa1`;
const email = 'backup-drill@example.test';
type Instance = { directory: string; env: Record<string, string>; origin: string; state: ReturnType<typeof stateFromEnv>; volumeHolder?: string };
const instances: Instance[] = [];
async function instance(name: string): Promise<Instance> {
  const probe = createServer();
  await new Promise<void>(resolveListen => probe.listen(0, '127.0.0.1', resolveListen));
  const address = probe.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()));
  const directory = join(root, `${name}-${randomUUID().slice(0, 8)}`);
  await mkdir(join(directory, '.or3-cloud', 'backups'), { recursive: true, mode: 0o700 });
  await copyAssets(directory, 'local');
  // Docker's internal network blocks provider egress for both the app and
  // Compose archive helpers. Direct extraction helpers use --network none.
  await appendFile(join(directory, 'compose.yaml'), '\nnetworks:\n  default:\n    internal: true\n');
  const env = buildEnv({ mode: 'local', version: PACKAGE_VERSION, directory, image, email, password, port });
  if (alternateStorageOnly) {
    // The supported managed asset fixes its root at /data/storage. This
    // compatibility fixture deliberately owns a custom Compose asset too.
    env.OR3_STORAGE_FS_ROOT = '/data/retained uploads';
    const composePath = join(directory, 'compose.yaml');
    const compose = await readFile(composePath, 'utf8');
    assert(compose.includes('OR3_STORAGE_FS_ROOT: /data/storage'));
    await writeFile(composePath, compose.replace('OR3_STORAGE_FS_ROOT: /data/storage', "OR3_STORAGE_FS_ROOT: '/data/retained uploads'"));
  }
  const state = stateFromEnv(directory, env, 'local', 'init', digest);
  await writeFile(join(directory, '.env'), serializeEnv(env), { mode: 0o600 });
  await writeFile(join(directory, '.or3-cloud/backup-auth.key'), `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  await writeState(directory, state);
  const fixture: Instance = { directory, env, state, origin: `http://127.0.0.1:${port}` };
  instances.push(fixture);
  if (capacityOnly && name === 'target') {
    await command(['volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
      '--opt', 'o=size=96m,uid=65532,gid=65532',
      '--label', `com.docker.compose.project=${state.composeProject}`, '--label', 'com.docker.compose.volume=or3-data',
      '--label', `io.or3.cloud.deployment-id=${env.OR3_DEPLOYMENT_ID}`, state.volumeName]);
    const holder = `or3-backup-capacity-holder-${randomUUID().slice(0, 8)}`;
    await command(['run', '-d', '--name', holder, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--memory', '16m', '--pids-limit', '16',
      '-v', `${state.volumeName}:/probe`, '--entrypoint', 'sh', env.OR3_IMAGE, '-c', 'exec tail -f /dev/null']);
    // Keep this volatile test filesystem mounted across app/helper restarts.
    fixture.volumeHolder = holder;
  }
  await startProject(directory, 'local', env);
  // Managed initialization proves login/workspace provisioning before removing
  // the bootstrap handoff. Removing it earlier blocks invite-only admission.
  await authenticated(fixture);
  fixture.env = withoutProvisioningCredentials(env);
  await writeFile(join(directory, '.env'), serializeEnv(fixture.env), { mode: 0o600 });
  await startProject(directory, 'local', fixture.env);
  return fixture;
}
function client(fixture: Instance) {
  let cookie = '';
  return async (path: string, body?: unknown, options: RequestInit = {}) => {
    // Internal Docker networks may not expose published ports on a nested
    // daemon. Execute HTTP inside the actual app container, keeping its normal
    // Host/Origin contract. This also makes egress isolation explicit.
    const requested = new URL(path, fixture.origin);
    const bytes = body === undefined ? options.body : JSON.stringify(body);
    const input = { path: requested.pathname + requested.search,
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { host: new URL(fixture.origin).host, origin: fixture.origin, 'x-or3-cloud-intent': 'mutation', cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
      body: bytes === undefined ? undefined : Buffer.from(bytes as string | Uint8Array).toString('base64') };
    const script = `const i=${JSON.stringify(input)};const q=require('node:http').request({hostname:'127.0.0.1',port:3000,path:i.path,method:i.method,headers:i.headers},r=>{const chunks=[];let size=0;r.on('data',c=>{size+=c.length;if(size>2097152)process.exit(1);chunks.push(c)});r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,headers:Object.entries(r.headers).filter(([k])=>k!=='set-cookie'),cookies:r.headers['set-cookie']||[],body:Buffer.concat(chunks).toString('base64')})))});q.setTimeout(30000,()=>q.destroy());q.on('error',()=>process.exit(1));q.end(i.body===undefined?undefined:Buffer.from(i.body,'base64'));`;
    const result = JSON.parse(await command(composeArgs(fixture.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e', script]), fixture.directory));
    const responseHeaders = new Headers(result.headers);
    for (const value of result.cookies) responseHeaders.append('set-cookie', value);
    const response = new Response(Buffer.from(result.body, 'base64'), { status: result.status, headers: responseHeaders });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
    assert(response.ok, `${path}: ${response.status} ${response.ok ? '' : await response.text()}`);
    return response;
  };
}
const evidence = (name: string, detail?: unknown, kind: 'passed' | 'limitation' = 'passed') => {
  outcomes.push({ name, kind, detail }); console.log(`${kind === 'passed' ? 'PASS' : 'LIMITATION'} ${name}`);
};
type FixtureRow = { tableName: string; pk: string; payload: Record<string, unknown> };
const fixtureRows: FixtureRow[] = [];
let secondWorkspace: { id: string; storageId: string; rows: FixtureRow[] } | undefined;
let legacyAttachment: { hash: string; storageId: string; bytes: Buffer } | undefined;
const extraFilesystemFiles: Array<{ name: string; sha256: string }> = [];
const fileBytes = Buffer.from('Synthetic backup document and attachment bytes.\n');
const hash = `sha256:${createHash('sha256').update(fileBytes).digest('hex')}`;
let storageId: string | undefined;
let workspaceId: string;
let replayBody: unknown;
let replayReceipt: unknown;
const concurrentPairs: Array<[string, string]> = [];
const acceptedPairs = new Set<string>();
const caps = { fileKindCapability: 'v1', workspaceItemCapability: 'v1' };
function op(tableName: string, pk: string, payload: Record<string, unknown>, clock = 1) {
  return { id: randomUUID(), tableName, pk, payload, operation: 'put',
    stamp: { deviceId: 'synthetic-backup-device', opId: randomUUID(), hlc: `${Date.now()}:0:backup`, clock },
    createdAt: Date.now(), attempts: 0, status: 'pending' };
}
async function authenticated(fixture: Instance) {
  const api = client(fixture);
  await api('/api/basic-auth/sign-in', { email, password });
  const session = await (await api('/api/auth/session')).json();
  assert.equal(session.session.role, 'owner');
  return { api, session };
}
async function verify(fixture: Instance, includeSecondary = true, expectedAttachmentBytes = fileBytes) {
  const { api, session } = await authenticated(fixture);
  assert.equal(session.session.workspace.id, workspaceId);
  const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
  for (const row of fixtureRows) {
    const actual = snapshot.items.find((item: { pk: string; tableName: string }) => item.pk === row.pk && item.tableName === row.tableName);
    assert(actual, `Missing ${row.tableName}/${row.pk}`);
    for (const [key, value] of Object.entries(row.payload)) assert.deepEqual(actual.payload[key], value, `${row.tableName}/${row.pk}/${key}`);
  }
  if (emptyStorageOnly) {
    assert(!snapshot.items.some((item: { tableName: string }) => item.tableName === 'file_meta'));
    const exists = await command(composeArgs(fixture.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
      "console.log(require('node:fs').existsSync(process.env.OR3_STORAGE_FS_ROOT+'/workspaces'))"]), fixture.directory);
    assert.equal(exists, 'false', 'Legitimate empty-storage fixture must have no workspace object directories');
  } else {
    assert.equal(typeof storageId, 'string');
    const download = await (await api('/api/storage/presign-download', { workspace_id: workspaceId, hash, storage_id: storageId, file_kind_capability: 'v1' })).json();
    const original = await api(download.url);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), expectedAttachmentBytes);
  }
  if (legacyAttachment) {
    const download = await (await api('/api/storage/presign-download', { workspace_id: workspaceId, hash: legacyAttachment.hash,
      storage_id: legacyAttachment.storageId, file_kind_capability: 'v1' })).json();
    assert.deepEqual(Buffer.from(await (await api(download.url)).arrayBuffer()), legacyAttachment.bytes);
  }
  if (extraFilesystemFiles.length) {
    const script = `const fs=require('node:fs'),crypto=require('node:crypto');const root=${JSON.stringify(`${fixture.env.OR3_STORAGE_FS_ROOT}/workspaces/${workspaceId}/`)};console.log(JSON.stringify(${JSON.stringify(extraFilesystemFiles)}.map(item=>({name:item.name,sha256:crypto.createHash('sha256').update(fs.readFileSync(root+item.name)).digest('hex')}))))`;
    const observed = JSON.parse(await command(composeArgs(fixture.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e', script]), fixture.directory));
    assert.deepEqual(observed, extraFilesystemFiles, 'Native verification must preserve uncommitted/temporary/opaque files without rewriting bytes');
  }
  const replay = await (await api('/api/sync/push', replayBody)).json();
  const canonicalReceipt = (result: { opId: string; success: boolean; serverVersion: number; applied?: boolean }) =>
    ({ opId: result.opId, success: result.success, serverVersion: result.serverVersion, applied: result.applied });
  assert.deepEqual(replay.results.map(canonicalReceipt), (replayReceipt as { results: Array<Parameters<typeof canonicalReceipt>[0]> }).results.map(canonicalReceipt));
  assert(replay.results.every((result: { replayed?: boolean }) => result.replayed === true));
  assert.equal(replay.serverVersion, snapshot.highWatermark, 'Replay must not allocate new workspace versions');
  if (secondWorkspace && includeSecondary) {
    await api('/api/workspaces/active', { id: secondWorkspace.id });
    const session = await (await api('/api/auth/session')).json();
    assert.equal(session.session.workspace.id, secondWorkspace.id);
    assert.equal(session.session.role, 'owner');
    const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId: secondWorkspace.id }, pageSize: 100, ...caps })).json();
    for (const row of secondWorkspace.rows) {
      const actual = snapshot.items.find((item: { pk: string; tableName: string }) => item.pk === row.pk && item.tableName === row.tableName);
      assert(actual, `Missing secondary ${row.tableName}/${row.pk}`);
      for (const [key, value] of Object.entries(row.payload)) assert.deepEqual(actual.payload[key], value, `secondary ${row.tableName}/${row.pk}/${key}`);
    }
    const download = await (await api('/api/storage/presign-download', { workspace_id: secondWorkspace.id, hash,
      storage_id: secondWorkspace.storageId, file_kind_capability: 'v1' })).json();
    assert.deepEqual(Buffer.from(await (await api(download.url)).arrayBuffer()), fileBytes);
    await api('/api/workspaces/active', { id: workspaceId });
    assert.equal((await (await api('/api/auth/session')).json()).session.workspace.id, workspaceId);
  }
  let capturedPairs = 0;
  for (const pair of concurrentPairs) {
    const captured = pair.filter(pk => snapshot.items.some((item: { pk: string }) => item.pk === pk));
    assert(captured.length === 0 || captured.length === 2, 'Backup split an atomic SQLite push batch');
    if (acceptedPairs.has(pair[0])) assert.equal(captured.length, 2, 'Backup lost an acknowledged atomic push batch');
    if (captured.length === 2) capturedPairs++;
  }
  const integrity = await command(composeArgs(fixture.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
    "const Database=require('/app/.output/server/node_modules/better-sqlite3');for(const p of ['/data/auth.sqlite','/data/sync.sqlite']){const db=new Database(p,{readonly:true,fileMustExist:true});if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)process.exit(1);db.close()}console.log('integrity and foreign keys ok')"]), fixture.directory);
  assert.equal(integrity, 'integrity and foreign keys ok');
  return { rows: fixtureRows.length, attachmentBytes: emptyStorageOnly ? 0 : fileBytes.length, integrity: 'ok', identity: 'owner and workspace preserved', replay: 'idempotent', capturedPairs,
    ...(emptyStorageOnly ? { emptyStorageHasNoCanonicalReferencesOrObjectDirectory: true } : {}),
    ...(secondWorkspace && includeSecondary ? { secondWorkspaceRows: secondWorkspace.rows.length, sharedHashBytesVerifiedPerWorkspace: true, duplicateRecordIdsScoped: true } : {}) };
}
async function backup(fixture: Instance) {
  const previous = await import('node:fs/promises').then(fs => fs.readdir(join(fixture.directory, '.or3-cloud/backups')));
  await backupCommand(fixture.directory, [], {});
  const next = await import('node:fs/promises').then(fs => fs.readdir(join(fixture.directory, '.or3-cloud/backups')));
  const created = next.filter(value => !previous.includes(value));
  assert.equal(created.length, 1);
  return join(fixture.directory, '.or3-cloud/backups', created[0]);
}
async function verifyBrowser(fixture: Instance) {
  const { chromium, expect } = await import('@playwright/test');
  const container = await command(composeArgs(fixture.directory, 'local', ['ps', '-q', 'or3']), fixture.directory);
  assert(/^[a-f0-9]{12,64}$/.test(container));
  const ip = await command(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', container]);
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(ip));
  // The local relay exposes only this disposable, internally networked app.
  // Keep its normal Host/Origin values so the browser exercises real guards.
  const relay = createHttpServer((incoming, outgoing) => {
    const upstream = httpRequest({ hostname: ip, port: 3000, path: incoming.url,
      method: incoming.method, headers: { ...incoming.headers, 'accept-encoding': 'identity' } }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!outgoing.headersSent) { outgoing.writeHead(502); outgoing.end(); }
      else outgoing.destroy();
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolveListen, reject) => {
    relay.once('error', reject);
    relay.listen(Number(new URL(fixture.origin).port), '127.0.0.1', resolveListen);
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === fixture.origin && !url.pathname.startsWith('/api/openrouter/') ? route.continue() : route.abort();
    });
    // Reuse real provider sign-in inside the app container. Playwright's API
    // request client relies on Node HTTP response.url behavior that Bun differs
    // on; pass only these newly issued synthetic session cookies to Chromium.
    const login = await client(fixture)('/api/basic-auth/sign-in', { email, password });
    await context.addCookies(login.headers.getSetCookie().map(header => {
      const [pair = '', ...attributes] = header.split(';');
      const equal = pair.indexOf('=');
      assert(equal > 0);
      const flags = attributes.map(value => value.trim().toLowerCase());
      return { name: pair.slice(0, equal), value: pair.slice(equal + 1), url: fixture.origin,
        httpOnly: flags.includes('httponly'), secure: flags.includes('secure'),
        sameSite: flags.includes('samesite=strict') ? 'Strict' as const : flags.includes('samesite=none') ? 'None' as const : 'Lax' as const };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.goto(fixture.origin);
    const palette = page.getByRole('button', { name: 'Open command palette' }).first();
    await expect(palette).toBeVisible({ timeout: 45_000 });
    const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true });
    if (await welcome.isVisible()) await welcome.click();
    const open = async (title: string) => {
      const row = page.getByRole('button', { name: new RegExp(`^${title}(?: |$)`) }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        // Workspace hydration can finish after the first paint and show the
        // normal welcome dialog. Dismiss it after hydration before selecting.
        if (await welcome.isVisible()) await welcome.click();
        await expect(welcome).not.toBeVisible({ timeout: 1_000 });
        await row.click({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
    };
    await open('Synthetic restore conversation');
    await expect(page.getByRole('tabpanel').getByText('Synthetic chat body', { exact: true })).toBeVisible({ timeout: 30_000 });
    await open('Synthetic document');
    await expect(page.getByRole('tabpanel').getByText('Synthetic restored document', { exact: true })).toBeVisible({ timeout: 30_000 });
    await mkdir(join(evidencePath, '..'), { recursive: true });
    await page.screenshot({ path: join(evidencePath, '..', 'restored-browser.png') });
    return { freshBrowser: true, chatBodyVisible: true, documentBodyVisible: true, externalRequestsBlocked: true };
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await mkdir(join(evidencePath, '..'), { recursive: true });
      await page.screenshot({ path: join(evidencePath, '..', 'restored-browser-failed.png') }).catch(() => undefined);
    }
    throw error;
  } finally {
    await browser?.close();
    relay.closeAllConnections();
    // Bun closes the listener as well as its sockets here. Node leaves it
    // listening; only request close when the runtime still has a listener.
    if (relay.listening) await new Promise<void>((resolveClose, reject) => relay.close(error => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolveClose();
    }));
  }
}
try {
  const source = await instance('source');
  const { api, session } = await authenticated(source);
  workspaceId = session.session.workspace.id;
  const base = { deleted: false, clock: 1, created_at: 1, updated_at: 1 };
  if (!emptyStorageOnly) {
    const upload = await (await api('/api/storage/presign-upload', { workspace_id: workspaceId, hash, mime_type: 'text/plain', size_bytes: fileBytes.length, file_kind_capability: 'v1' })).json();
    const response = await api(upload.url, undefined, { method: upload.method ?? 'PUT', body: fileBytes, headers: { ...upload.headers, 'content-type': 'text/plain' } });
    const receipt = await response.json();
    storageId = upload.storageId ?? receipt.storageId;
    await api('/api/storage/commit', { workspace_id: workspaceId, hash, storage_id: storageId, intent_id: upload.intentId,
      storage_provider_id: 'fs', mime_type: 'text/plain', size_bytes: fileBytes.length, name: 'drill.txt', kind: 'file', file_kind_capability: 'v1' });
    fixtureRows.push({ tableName: 'file_meta', pk: hash, payload: { ...base, hash, name: 'drill.txt', mime_type: 'text/plain', kind: 'file', size_bytes: fileBytes.length, storage_id: storageId, storage_provider_id: 'fs' } });
  }
  fixtureRows.push(
    { tableName: 'threads', pk: 'drill-thread', payload: { ...base, id: 'drill-thread', title: 'Synthetic restore conversation', status: 'active', pinned: false } },
    { tableName: 'messages', pk: 'drill-message', payload: { ...base, id: 'drill-message', thread_id: 'drill-thread', role: 'user', index: 0, order_key: '0000000001', content: 'Synthetic chat body', file_hashes: JSON.stringify(emptyStorageOnly ? [] : [hash]) } },
    { tableName: 'posts', pk: 'drill-document', payload: { ...base, id: 'drill-document', title: 'Synthetic document', post_type: 'doc', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic restored document' }] }] }), file_hashes: '[]', meta: '{}' } },
    { tableName: 'projects', pk: 'drill-project', payload: { ...base, id: 'drill-project', name: 'Synthetic project', data: [{ kind: 'doc', id: 'drill-document' }] } },
    { tableName: 'kv', pk: 'drill-settings', payload: { id: 'drill-settings', name: 'backup_drill_settings', value: { theme: 'retro', nested: ['retained', 42] }, clock: 1, created_at: 1, updated_at: 1 } },
  );
  if (filesystemCompatOnly && !emptyStorageOnly) {
    const bytes = Buffer.from('Synthetic legacy MD5 attachment bytes.\n');
    const legacyHash = `md5:${createHash('md5').update(bytes).digest('hex')}`;
    legacyAttachment = { hash: legacyHash, storageId: `${workspaceId}:${legacyHash}`, bytes };
    fixtureRows.push({ tableName: 'file_meta', pk: legacyHash, payload: { ...base, hash: legacyHash, name: 'legacy-drill.txt',
      mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length, storage_id: legacyAttachment.storageId, storage_provider_id: 'fs' } });
    fixtureRows.find(row => row.tableName === 'messages')!.payload.file_hashes = JSON.stringify([hash, legacyHash]);
    const large = Buffer.alloc(150_001, 0x93);
    const empty = Buffer.alloc(0);
    const wrong = Buffer.from('Uncommitted upload bytes do not yet match their future key.');
    const temporaryKey = `sha256_${createHash('sha256').update('future committed bytes').digest('hex')}`;
    const fixtures = [
      { name: legacyHash.replace(':', '_'), bytes },
      { name: `sha256_${createHash('sha256').update(large).digest('hex')}`, bytes: large },
      { name: `sha256_${createHash('sha256').update(empty).digest('hex')}`, bytes: empty },
      { name: temporaryKey, bytes: wrong },
      { name: `${temporaryKey}.meta.json.tmp-fixture`, bytes: Buffer.from('{}') },
      { name: 'opaque-generation-fixture.blob', bytes: Buffer.from('Opaque generation bytes retained') },
      { name: 'opaque-generation-fixture.blob.meta.json', bytes: Buffer.from('{}') },
    ];
    for (const item of fixtures) extraFilesystemFiles.push({ name: item.name, sha256: createHash('sha256').update(item.bytes).digest('hex') });
    // Local filesystem fixtures simulate a pre-existing legacy object and
    // retained artifacts; they do not exercise a new MD5 upload contract.
    const script = `const fs=require('node:fs');const root=${JSON.stringify(`${source.env.OR3_STORAGE_FS_ROOT}/workspaces/${workspaceId}/`)};const files=${JSON.stringify(fixtures.map(item => ({ name: item.name, base64: item.bytes.length === large.length ? undefined : item.bytes.toString('base64'), large: item.bytes.length === large.length })))};for(const item of files){fs.writeFileSync(root+item.name,item.large?Buffer.alloc(150001,0x93):Buffer.from(item.base64,'base64'))}for(const name of files.slice(0,3).map(item=>item.name))fs.writeFileSync(root+name+'.meta.json',JSON.stringify({workspace_id:${JSON.stringify(workspaceId)},hash:name.replace('_',':'),committed_at:new Date().toISOString()}))`;
    await command(composeArgs(source.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e', script]), source.directory);
  }
  replayBody = { scope: { workspaceId }, ...caps, ops: fixtureRows.map(row => op(row.tableName, row.pk, row.payload)) };
  replayReceipt = await (await api('/api/sync/push', replayBody)).json();
  assert((replayReceipt as { results: Array<{ success: boolean }> }).results.every(result => result.success));
  if (multiWorkspaceOnly) {
    const created = await (await api('/api/workspaces', { name: 'Synthetic second restore workspace' })).json();
    assert.equal(typeof created.id, 'string');
    assert.notEqual(created.id, workspaceId);
    await api('/api/workspaces/active', { id: created.id });
    const upload = await (await api('/api/storage/presign-upload', { workspace_id: created.id, hash, name: 'second-drill.txt',
      mime_type: 'text/plain', size_bytes: fileBytes.length, kind: 'file', file_kind_capability: 'v1' })).json();
    const receipt = await (await api(upload.url, undefined, { method: upload.method ?? 'PUT', body: fileBytes,
      headers: { ...upload.headers, 'content-type': 'text/plain' } })).json();
    const secondStorageId = upload.storageId ?? receipt.storageId;
    assert.notEqual(secondStorageId, storageId, 'Equal hashes in distinct workspaces need distinct scoped storage IDs');
    await api('/api/storage/commit', { workspace_id: created.id, hash, storage_id: secondStorageId, intent_id: upload.intentId,
      storage_provider_id: 'fs', mime_type: 'text/plain', size_bytes: fileBytes.length, name: 'second-drill.txt', kind: 'file', file_kind_capability: 'v1' });
    const rows = fixtureRows.map(row => {
      const payload = structuredClone(row.payload);
      if (row.tableName === 'file_meta') { payload.storage_id = secondStorageId; payload.name = 'second-drill.txt'; }
      if (row.tableName === 'threads') payload.title = 'Second workspace conversation';
      if (row.tableName === 'messages') payload.content = 'Second workspace chat body';
      if (row.tableName === 'posts') payload.title = 'Second workspace document';
      if (row.tableName === 'projects') payload.name = 'Second workspace project';
      if (row.tableName === 'kv') payload.value = { theme: 'light', nested: ['second workspace', 99] };
      return { ...row, payload };
    });
    const pushed = await (await api('/api/sync/push', { scope: { workspaceId: created.id }, ...caps,
      ops: rows.map(row => op(row.tableName, row.pk, row.payload)) })).json();
    assert(pushed.results.every((result: { success: boolean }) => result.success));
    secondWorkspace = { id: created.id, storageId: secondStorageId, rows };
    await api('/api/workspaces/active', { id: workspaceId });
  }
  evidence(emptyStorageOnly ? 'populated source has authenticated chat/document/settings and no attachment references or object directories'
    : 'populated source uses authenticated sync, real SQLite and FS attachment', await verify(source));
  let racingWrites: Array<Promise<unknown>> = [];
  if (deep || concurrencyOnly) {
    const pairBody = (index: number) => {
      const pair: [string, string] = [`race-${index}-a`, `race-${index}-b`];
      concurrentPairs.push(pair);
      return { scope: { workspaceId }, ...caps, ops: pair.map(id => op('posts', id,
        { ...base, id, title: id, post_type: 'doc', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Atomic pair ${index}` }] }] }), file_hashes: '[]' })) };
    };
    const first = await (await api('/api/sync/push', pairBody(0))).json();
    assert(first.results.every((result: { success: boolean }) => result.success));
    acceptedPairs.add(concurrentPairs[0]![0]);
    const bodies = Array.from({ length: 7 }, (_, index) => pairBody(index + 1));
    let launched = false;
    lifecycleFaults.beforeCommand = async (_command, args) => {
      if (!launched && args[0] === 'compose' && args.includes('stop')) {
        launched = true;
        racingWrites = bodies.map(async body => {
          const response = await (await api('/api/sync/push', body)).json();
          assert(response.results.every((result: { success: boolean }) => result.success));
          return response;
        });
        // Observe rejections immediately, before awaiting backup completion.
        for (const write of racingWrites) void write.catch(() => undefined);
        if (concurrencyOnly) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([Promise.any(racingWrites), new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('No concurrent write acknowledged within five seconds')), 5_000);
            })]);
          } finally { clearTimeout(timeout); }
        }
      }
    };
  }
  let sourceBackup: string;
  try { sourceBackup = await backup(source); }
  finally { delete lifecycleFaults.beforeCommand; }
  if (deep || concurrencyOnly) {
    const settled = await Promise.allSettled(racingWrites);
    settled.forEach((result, index) => { if (result.status === 'fulfilled') acceptedPairs.add(concurrentPairs[index + 1]![0]); });
    if (concurrencyOnly) assert(acceptedPairs.size > 1, 'At least one racing batch must be acknowledged before stopping');
    evidence('seven synthetic push batches race the actual stopped-volume capture', {
      accepted: settled.filter(result => result.status === 'fulfilled').length,
      refusedOrInterrupted: settled.filter(result => result.status === 'rejected').length,
      bound: '8 atomic pairs; restoration verifies every acknowledged pair remains present and no pair is split',
      stopGate: concurrencyOnly ? 'Wait for at least one successful racing batch before requesting stop' : 'Stop immediately after launching racers',
    });
  }
  const sourceManifest = await readManifest(sourceBackup, source.directory);
  evidence('source backup authenticated', { archiveSha256: sourceManifest.dataSha256 });
  const archive = await run('tar', ['tzf', join(sourceBackup, 'data.tgz')]);
  assert(archive.ok, archive.stderr);
  const entries = archive.stdout.trim().split('\n');
  for (const name of ['./auth.sqlite', './sync.sqlite', './auth.sqlite-wal', './sync.sqlite-wal']) assert(entries.includes(name), `Missing captured ${name}`);
  assert.equal(entries.some(name => name.endsWith('.meta.json')), !emptyStorageOnly);
  evidence(emptyStorageOnly ? 'real archive contains both SQLite databases and WALs, with no attachment payloads or sidecars'
    : 'real archive contains both SQLite databases, WALs, blob and sidecar');
  await stopProject(source.directory, 'local');
  const target = await instance('target');
  await assert.rejects(restoreCommand(target.directory, { yes: true }, [sourceBackup]), /authentication failed|different.*identity/);
  evidence('managed restore refuses a foreign deployment before mutation');
  await stopProject(target.directory, 'local');
  // Deliberate test-only transfer to a *different* disposable volume through
  // the production primitive. The managed CLI's identity gate stays intact.
  await restoreVolumeArchive(target.directory, 'local', target.env, sourceBackup);
  await startProject(target.directory, 'local', target.env);
  evidence('separate instance reads source archive after actual restart', await verify(target));
  await stopProject(target.directory, 'local');
  await startProject(target.directory, 'local', target.env);
  evidence('second cold restart preserves chats/documents/attachment/settings and references', await verify(target));
  if (walCorruptionOnly) {
    await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
      "const Database=require('/app/.output/server/node_modules/better-sqlite3');const db=new Database('/data/sync.sqlite');const result=db.pragma('wal_checkpoint(TRUNCATE)');if(result[0]?.busy)throw Error('Synthetic checkpoint was busy');db.close()"]), target.directory);
    const { api } = await authenticated(target);
    const accepted = await (await api('/api/sync/push', { scope: { workspaceId }, ...caps,
      ops: [op('posts', 'wal-sentinel', { ...base, id: 'wal-sentinel', title: 'Committed WAL sentinel', post_type: 'doc',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Committed after checkpoint' }] }] }), file_hashes: '[]' })] })).json();
    assert(accepted.results.every((result: { success: boolean }) => result.success));
  }
  const targetBackup = await backup(target);
  for (const fault of filesystemCompatOnly || blobContentOnly || archiveRaceOnly || multiWorkspaceOnly || concurrencyOnly || builtCliOnly || recoveryOnly || crashOnly || browserOnly || journalOnly || attachmentOnly || sqliteOnly || capacityOnly ? [] : ['missing-data', 'missing-config', 'missing-asset', 'checksum', 'future-schema', 'version-mismatch', 'corrupt-tar',
    ...(deep ? ['missing-auth-database', 'missing-sync-database'] : [])]) {
    const path = join(root, fault);
    await cp(targetBackup, path, { recursive: true });
    if (['missing-data', 'missing-config', 'missing-asset'].includes(fault)) await rm(join(path, fault === 'missing-data' ? 'data.tgz' : fault === 'missing-config' ? 'config.env' : 'managed-assets/compose.yaml'));
    if (fault === 'checksum') await appendFile(join(path, 'data.tgz'), 'corrupt');
    if (['future-schema', 'version-mismatch', 'corrupt-tar'].includes(fault)) {
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
      if (fault === 'future-schema') manifest.schemaVersion = 2;
      if (fault === 'version-mismatch') manifest.appVersion = '999.0.0';
      if (fault === 'corrupt-tar') {
        const { gzipSync } = await import('node:zlib');
        await writeFile(join(path, 'data.tgz'), gzipSync(Buffer.from('signed gzip that is not tar')));
        manifest.dataSha256 = await sha256File(join(path, 'data.tgz'));
      }
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(path, 'manifest.json'), text);
      await writeBackupAuthentication(target.directory, path, text);
    }
    if (fault.endsWith('-database')) {
      const tree = join(root, `${fault}-tree`);
      await mkdir(tree);
      const unpacked = await run('tar', ['xzf', join(path, 'data.tgz'), '-C', tree]);
      assert(unpacked.ok, unpacked.stderr);
      const name = fault === 'missing-auth-database' ? 'auth.sqlite' : 'sync.sqlite';
      for (const suffix of ['', '-wal', '-shm']) await rm(join(tree, name + suffix), { force: true });
      const packed = await run('tar', ['czf', join(path, 'data.tgz'), '-C', tree, '.']);
      assert(packed.ok, packed.stderr);
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
      manifest.dataSha256 = await sha256File(join(path, 'data.tgz'));
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(path, 'manifest.json'), text);
      await writeBackupAuthentication(target.directory, path, text);
    }
    await assert.rejects(restoreCommand(target.directory, { yes: true }, [path]));
    assert.equal((await readState(target.directory)).incompleteOperation, undefined);
    evidence(`restore rejects ${fault}; target is intact`, await verify(target));
  }
  if (!filesystemCompatOnly && !blobContentOnly && !archiveRaceOnly && !multiWorkspaceOnly && !concurrencyOnly && !builtCliOnly && !recoveryOnly && !crashOnly && !browserOnly && !journalOnly && !attachmentOnly && !sqliteOnly && !capacityOnly) {
    // Fail the extraction process after volume clearing. The safe pre-start
    // automatic recovery must restore actual data, not merely return exit 0.
    const interrupted = join(root, 'interrupted-extraction');
    await cp(targetBackup, interrupted, { recursive: true });
    let extractionFailed = false;
    lifecycleFaults.beforeCommand = async (_command, args) => {
      if (!extractionFailed && args.includes('find /data -mindepth 1 -delete')) {
        extractionFailed = true;
        // Corrupt the authenticated fixture only after validation, immediately
        // before clearing. The real streamed extraction must now fail.
        await writeFile(join(interrupted, 'data.tgz'), Buffer.from('interrupted archive read'));
      }
    };
    try { await assert.rejects(restoreCommand(target.directory, { yes: true }, [interrupted]), /pre-restore snapshot.*was restored/); }
    finally { delete lifecycleFaults.beforeCommand; }
    assert(extractionFailed);
    evidence('interrupted extraction restores the actual pre-mutation SQLite/blob snapshot', await verify(target));
    // Accept a real write after startup, then fail image verification. This is
    // the data-loss regression: an automatic second extraction erased this row.
    let acceptedWrite = false;
    lifecycleFaults.beforeCommand = async (_command, args) => {
      if (!acceptedWrite && args[0] === 'inspect' && args.includes('{{.Image}}')) {
        const { api: live } = await authenticated(target);
        const write = await (await live('/api/sync/push', { scope: { workspaceId }, ...caps,
          ops: [op('posts', 'post-start-write', { ...base, id: 'post-start-write', title: 'Post-start write', post_type: 'doc', content: 'Must survive verification failure', file_hashes: '[]' })] })).json();
        assert(write.results.every((result: { success: boolean }) => result.success));
        acceptedWrite = true;
        throw new Error('synthetic verification failure after accepted write');
      }
    };
    try { await assert.rejects(restoreCommand(target.directory, { yes: true }, [targetBackup]), /NOT restored automatically/); }
    finally { delete lifecycleFaults.beforeCommand; }
    assert(acceptedWrite);
    assert.equal((await readState(target.directory)).incompleteOperation?.phase, 'starting-target');
    const { api: live } = await authenticated(target);
    const snapshot = await (await live('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
    assert(snapshot.items.some((item: { pk: string }) => item.pk === 'post-start-write'));
    await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
    evidence('post-start write survives verification failure and plain recovery refusal');
    await recoverCommand(target.directory, { restore: true, yes: true });
    evidence('explicit recovery restores actual pre-mutation data after post-start failure', await verify(target));
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    evidence('successful managed restore verified through authenticated reads after restart', await verify(target));
  }
  if (deep || recoveryOnly) {
    const interrupted = join(root, 'double-failure');
    await cp(targetBackup, interrupted, { recursive: true });
    let clears = 0;
    lifecycleFaults.beforeCommand = async (_command, args) => {
      if (args.includes('find /data -mindepth 1 -delete')) {
        clears++;
        if (clears === 1) await writeFile(join(interrupted, 'data.tgz'), Buffer.from('interrupted archive read'));
        if (clears === 2) throw new Error('synthetic automatic recovery failure');
      }
    };
    try { await assert.rejects(restoreCommand(target.directory, { yes: true }, [interrupted]), /automatic restoration.*also failed/); }
    finally { delete lifecycleFaults.beforeCommand; }
    assert.equal(clears, 2);
    const pending = (await readState(target.directory)).incompleteOperation;
    assert.equal(pending?.phase, 'restoring-previous');
    assert(pending?.previousBackupPath);
    await readManifest(pending.previousBackupPath, target.directory);
    await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
    evidence('failed extraction and failed automatic recovery retain the verified pre-mutation snapshot and journal');
    await recoverCommand(target.directory, { restore: true, yes: true });
    evidence('explicit recovery after double failure restores actual databases, references and attachment', await verify(target));
    // The app can accept writes before the final state.json commit. Exercise
    // that filesystem failure with a real write and another cold restart.
    let started = false;
    let commitFailed = false;
    lifecycleFaults.beforeCommand = async (_command, args) => {
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) started = true;
    };
    lifecycleFaults.beforeStateWrite = async () => {
      if (started && !commitFailed) {
        commitFailed = true;
        const { api } = await authenticated(target);
        const write = await (await api('/api/sync/push', { scope: { workspaceId }, ...caps,
          ops: [op('posts', 'terminal-write', { ...base, id: 'terminal-write', title: 'Terminal write', post_type: 'doc', content: 'Must survive state commit failure', file_hashes: '[]' })] })).json();
        assert(write.results.every((result: { success: boolean }) => result.success));
        throw new Error('synthetic terminal state commit failure after accepted write');
      }
    };
    try { await assert.rejects(restoreCommand(target.directory, { yes: true }, [targetBackup]), /NOT restored automatically/); }
    finally { delete lifecycleFaults.beforeCommand; delete lifecycleFaults.beforeStateWrite; }
    assert(commitFailed);
    assert.equal((await readState(target.directory)).incompleteOperation?.phase, 'starting-target');
    await stopProject(target.directory, 'local');
    await startProject(target.directory, 'local', target.env);
    const { api } = await authenticated(target);
    const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
    assert(snapshot.items.some((item: { pk: string }) => item.pk === 'terminal-write'));
    await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
    evidence('accepted write survives terminal state commit failure and cold restart; destructive plain recovery is refused');
    await recoverCommand(target.directory, { restore: true, yes: true });
    evidence('explicit recovery after terminal commit failure restores actual pre-mutation snapshot', await verify(target));
  }
  if (deep || crashOnly) {
    // Kill a separate CLI process at the selected boundary, bypassing its
    // exception handler. The journal must survive actual process death.
    const childPath = join(root, 'crash-restore.ts');
    const restoreModule = fileURLToPath(new URL('../../packages/or3-cloud/src/commands/restore.ts', import.meta.url));
    const faultModule = fileURLToPath(new URL('../../packages/or3-cloud/src/lifecycle-faults.ts', import.meta.url));
    if (prestartCrashOnly) {
      const { api } = await authenticated(target);
      const accepted = await (await api('/api/sync/push', { scope: { workspaceId }, ...caps,
        ops: [op('posts', 'pre-mutation-write', { ...base, id: 'pre-mutation-write', title: 'Original snapshot sentinel',
          post_type: 'doc', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Accepted before restore' }] }] }), file_hashes: '[]' })] })).json();
      assert(accepted.results.every((result: { success: boolean }) => result.success));
    }
    await writeFile(childPath, `import { restoreCommand } from ${JSON.stringify(restoreModule)};
import { lifecycleFaults } from ${JSON.stringify(faultModule)};
lifecycleFaults.beforeCommand = (_command, args) => {
  if (${prestartCrashOnly ? "args.join(' ').includes('quick_check')" : "args[0] === 'inspect' && args.includes('{{.Image}}')"}) process.kill(process.pid, 'SIGKILL');
};
await restoreCommand(${JSON.stringify(target.directory)}, { yes: true }, [${JSON.stringify(targetBackup)}]);\n`, { mode: 0o600 });
    const child = await run(process.execPath, [childPath], root);
    assert(!child.ok, 'Crash fixture must terminate before terminal commit');
    if (prestartCrashOnly) {
      const pending = (await readState(target.directory)).incompleteOperation;
      assert.equal(pending?.phase, 'target-mutating');
      assert(pending?.previousBackupPath);
      await readManifest(pending.previousBackupPath, target.directory);
      assert.equal(await command(composeArgs(target.directory, 'local', ['ps', '--status', 'running', '-q', 'or3']), target.directory), '');
      const older = await command(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true', '-v', `${target.state.volumeName}:/data`, '--entrypoint', nodePath, image, '-e',
        `const Database=require('/app/.output/server/node_modules/better-sqlite3');const db=new Database('/data/sync.sqlite',{readonly:true,fileMustExist:true});console.log(db.prepare('SELECT count(*) as n FROM s_posts WHERE id=? AND workspace_id=?').get('pre-mutation-write',${JSON.stringify(workspaceId)}).n);db.close()`], target.directory);
      assert.equal(older, '0', 'Requested older archive must really have replaced the live volume');
      await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
      evidence('SIGKILL after real extraction but before startup leaves app stopped and target-mutating journal; older target lacks the pre-mutation sentinel');
      await recoverCommand(target.directory, { restore: true, yes: true });
      await stopProject(target.directory, 'local');
      await startProject(target.directory, 'local', target.env);
      const { api } = await authenticated(target);
      const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
      assert(snapshot.items.some((item: { pk: string }) => item.pk === 'pre-mutation-write'));
      evidence('explicit recovery after pre-start CLI death restores original sentinel, baseline records and attachment through cold restart', await verify(target));
    } else {
      assert.equal((await readState(target.directory)).incompleteOperation?.phase, 'starting-target');
      const { api } = await authenticated(target);
      const write = await (await api('/api/sync/push', { scope: { workspaceId }, ...caps,
        ops: [op('posts', 'crash-write', { ...base, id: 'crash-write', title: 'Crash write', post_type: 'doc', content: 'Accepted after CLI death', file_hashes: '[]' })] })).json();
      assert(write.results.every((result: { success: boolean }) => result.success));
      await stopProject(target.directory, 'local');
      await startProject(target.directory, 'local', target.env);
      const { api: restarted } = await authenticated(target);
      const snapshot = await (await restarted('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
      assert(snapshot.items.some((item: { pk: string }) => item.pk === 'crash-write'));
      await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
      evidence('SIGKILL after target startup retains durable journal; subsequently accepted write survives cold restart and plain recovery refusal');
      await recoverCommand(target.directory, { restore: true, yes: true });
      evidence('explicit recovery after abrupt CLI death restores actual pre-mutation data and bytes', await verify(target));
    }
  }
  if (deep || attachmentOnly || workspaceOmissionOnly) {
    const missing = join(root, 'missing-archived-blob');
    const tree = join(root, 'missing-blob-tree');
    await cp(targetBackup, missing, { recursive: true });
    await mkdir(tree);
    const unpack = await run('tar', ['xzf', join(missing, 'data.tgz'), '-C', tree]);
    assert(unpack.ok, unpack.stderr);
    const missingWorkspace = workspaceOmissionOnly ? secondWorkspace!.id : workspaceId;
    const blob = join(tree, 'storage/workspaces', missingWorkspace, hash.replace(':', '_'));
    assert.deepEqual(await readFile(blob), fileBytes);
    if (workspaceOmissionOnly) assert.deepEqual(await readFile(join(tree, 'storage/workspaces', workspaceId, hash.replace(':', '_'))), fileBytes);
    await rm(blob);
    const packed = await run('tar', ['czf', join(missing, 'data.tgz'), '-C', tree, '.']);
    assert(packed.ok, packed.stderr);
    const manifest = JSON.parse(await readFile(join(missing, 'manifest.json'), 'utf8'));
    manifest.dataSha256 = await sha256File(join(missing, 'data.tgz'));
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(missing, 'manifest.json'), text);
    await writeBackupAuthentication(target.directory, missing, text);
    const beforeState = await readState(target.directory);
    const beforeContainer = await command(composeArgs(target.directory, 'local', ['ps', '-q', 'or3']), target.directory);
    await assert.rejects(restoreCommand(target.directory, { yes: true }, [missing]), /sidecar without its required blob payload/);
    assert.equal((await readState(target.directory)).incompleteOperation, undefined);
    assert.deepEqual(await readState(target.directory), beforeState);
    assert.equal(await command(composeArgs(target.directory, 'local', ['ps', '-q', 'or3']), target.directory), beforeContainer);
    evidence(workspaceOmissionOnly
      ? 'second-workspace blob omission refused before mutation despite identical first-workspace hash; both scopes remain intact'
      : 'authenticated archive missing a committed sidecar payload is refused; live data and attachment remain intact', await verify(target));
    // Pairing cannot detect a completed object whose blob and sidecar are both
    // absent. Preserve this narrower data-integrity boundary as real evidence.
    await rm(blob + '.meta.json');
    const repacked = await run('tar', ['czf', join(missing, 'data.tgz'), '-C', tree, '.']);
    assert(repacked.ok, repacked.stderr);
    manifest.dataSha256 = await sha256File(join(missing, 'data.tgz'));
    const missingBothText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(missing, 'manifest.json'), missingBothText);
    await writeBackupAuthentication(target.directory, missing, missingBothText);
    await restoreCommand(target.directory, { yes: true }, [missing]);
    await assert.rejects(verify(target), /404|File not found/);
    if (workspaceOmissionOnly) {
      const { api } = await authenticated(target);
      await api('/api/workspaces/active', { id: workspaceId });
      evidence('both second-workspace payload and sidecar omitted: first workspace stays intact while second download fails', {
        firstWorkspace: await verify(target, false), secondWorkspaceDownload: 404,
        boundary: 'Database-reference completeness remains unresolved; another workspace with the same hash must not satisfy this reference',
      }, 'limitation');
    }
    outcomes.push({ name: 'Authenticated, well-formed archive missing both a referenced blob and its sidecar passes structural restore; app download detects the omission',
      kind: 'limitation', detail: 'Pairing checks available committed sidecars; absent blob and sidecar cannot be discovered without database-reference validation. Deep health is not an attachment audit.' });
    console.log('DATA-INTEGRITY LIMITATION authenticated archive missing both blob and sidecar requires database-reference validation');
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    evidence('known-good backup recovers attachment bytes after semantic omission', await verify(target));
  }
  if (deep || journalOnly) {
    let started = false;
    let accepted = false;
    let failedWrites = 0;
    lifecycleFaults.beforeCommand = (_command, args) => {
      if (args[0] === 'inspect' && args.includes('{{.Image}}')) started = true;
    };
    lifecycleFaults.beforeStateWrite = async () => {
      if (!started) return;
      failedWrites++;
      if (!accepted) {
        const { api } = await authenticated(target);
        const write = await (await api('/api/sync/push', { scope: { workspaceId }, ...caps,
          ops: [op('posts', 'journal-write', { ...base, id: 'journal-write', title: 'Journal write', post_type: 'doc', content: 'Accepted before persistent state failure', file_hashes: '[]' })] })).json();
        assert(write.results.every((result: { success: boolean }) => result.success));
        accepted = true;
      }
      throw new Error('synthetic persistent state write failure');
    };
    try { await assert.rejects(restoreCommand(target.directory, { yes: true }, [targetBackup]), /synthetic persistent state write failure/); }
    finally { delete lifecycleFaults.beforeCommand; delete lifecycleFaults.beforeStateWrite; }
    assert(accepted && failedWrites >= 2);
    assert.equal((await readState(target.directory)).incompleteOperation?.phase, 'starting-target');
    const assertJournalWrite = async () => {
      const { api } = await authenticated(target);
      const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
      assert(snapshot.items.some((item: { pk: string }) => item.pk === 'journal-write'));
    };
    await assertJournalWrite();
    await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
    evidence('durable starting-target journal and accepted write survive both terminal commit and error-record write failures');
    let cleared = false;
    lifecycleFaults.beforeCommand = (_command, args) => {
      if (args.includes('find /data -mindepth 1 -delete')) cleared = true;
    };
    lifecycleFaults.beforeStateWrite = () => { throw new Error('synthetic recovery journal write failure'); };
    try { await assert.rejects(recoverCommand(target.directory, { restore: true, yes: true }), /synthetic recovery journal write failure/); }
    finally { delete lifecycleFaults.beforeCommand; delete lifecycleFaults.beforeStateWrite; }
    assert(!cleared, 'Recovery must journal before clearing any data');
    assert.equal((await readState(target.directory)).incompleteOperation?.phase, 'starting-target');
    await assertJournalWrite();
    evidence('failed recovery journal persistence refuses extraction and preserves live accepted write');
    await recoverCommand(target.directory, { restore: true, yes: true });
    evidence('retry after journal persistence is available restores actual pre-mutation data and attachment', await verify(target));
  }
  if (sqliteOnly && !walCorruptionOnly) {
    for (const [index, fault] of (sqliteWalOnly ? [
      { database: 'sync.sqlite', payload: 'missing-wal' },
    ] : [
      { database: 'sync.sqlite', payload: 'non-sqlite' },
      { database: 'auth.sqlite', payload: 'non-sqlite' },
      { database: 'sync.sqlite', payload: 'empty-schema' },
    ]).entries()) {
      const broken = join(root, `corrupt-sqlite-${index}`);
      const tree = join(root, `corrupt-sqlite-tree-${index}`);
      await cp(targetBackup, broken, { recursive: true });
      await mkdir(tree);
      const unpacked = await run('tar', ['xzf', join(broken, 'data.tgz'), '-C', tree]);
      assert(unpacked.ok, unpacked.stderr);
      let payload = Buffer.from('synthetic payload that is not SQLite');
      if (fault.payload === 'empty-schema') {
        const empty = await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
          "const fs=require('node:fs');const Database=require('/app/.output/server/node_modules/better-sqlite3');const path='/tmp/synthetic-empty.sqlite';const db=new Database(path);db.pragma('user_version=1');if(db.pragma('quick_check',{simple:true})!=='ok')throw Error('Fixture integrity failure');db.close();console.log(fs.readFileSync(path).toString('base64'));fs.unlinkSync(path)"]), target.directory);
        payload = Buffer.from(empty, 'base64');
      }
      if (fault.payload !== 'missing-wal') await writeFile(join(tree, fault.database), payload);
      for (const suffix of ['-wal', '-shm']) await rm(join(tree, fault.database + suffix), { force: true });
      const packed = await run('tar', ['czf', join(broken, 'data.tgz'), '-C', tree, '.']);
      assert(packed.ok, packed.stderr);
      const manifest = JSON.parse(await readFile(join(broken, 'manifest.json'), 'utf8'));
      manifest.dataSha256 = await sha256File(join(broken, 'data.tgz'));
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(broken, 'manifest.json'), text);
      await writeBackupAuthentication(target.directory, broken, text);
      let clears = 0;
      lifecycleFaults.beforeCommand = (_command, args) => {
        if (args.includes('find /data -mindepth 1 -delete')) clears++;
      };
      const startedAt = Date.now();
      try {
        await assert.rejects(restoreCommand(target.directory, { yes: true }, [broken]), /snapshot .* was restored:/);
      }
      finally { delete lifecycleFaults.beforeCommand; }
      assert.equal(clears, 2, 'Refused payload and safe automatic snapshot recovery each extract once');
      assert.equal((await readState(target.directory)).incompleteOperation, undefined);
      assert.match((await readState(target.directory)).lastError ?? '', /SQLite database integrity verification failed/);
      evidence('real database payload refused before startup; automatic recovery restores original records and attachment', {
        fault, elapsedMs: Date.now() - startedAt, verification: await verify(target),
      });
    }
    if (!sqliteWalOnly) {
      let interrupted = 0;
      let started = 0;
      lifecycleFaults.beforeCommand = (_command, args) => {
        if (args.join(' ').includes('quick_check') && interrupted < 2) {
          interrupted++;
          throw new Error('Synthetic native validation interruption');
        }
        if (args[0] === 'compose' && args.includes('up')) started++;
      };
      try {
        await assert.rejects(restoreCommand(target.directory, { yes: true }, [targetBackup]), /automatic restoration .* also failed/);
      } finally { delete lifecycleFaults.beforeCommand; }
      assert.equal(interrupted, 2);
      assert.equal(started, 0, 'Neither refused target nor interrupted snapshot may start');
      const pending = (await readState(target.directory)).incompleteOperation;
      assert.equal(pending?.phase, 'restoring-previous');
      assert(pending?.previousBackupPath);
      await readManifest(pending.previousBackupPath, target.directory);
      await assert.rejects(recoverCommand(target.directory), /may have replaced data/);
      evidence('interrupted native validation and automatic recovery preserve the verified snapshot and journal without starting either app');
      await recoverCommand(target.directory, { restore: true, yes: true });
      evidence('explicit retry after native validation interruption restores actual records and attachment bytes', await verify(target));
    }
  }
  if (walCorruptionOnly) {
    const broken = join(root, 'corrupt-wal-header');
    const tree = join(root, 'corrupt-wal-tree');
    await cp(targetBackup, broken, { recursive: true });
    await mkdir(tree);
    const unpacked = await run('tar', ['xzf', join(broken, 'data.tgz'), '-C', tree]);
    assert(unpacked.ok, unpacked.stderr);
    const wal = await readFile(join(tree, 'sync.sqlite-wal'));
    const originalWal = Buffer.from(wal);
    assert(wal.length > 32);
    if (walTailOnly) {
      const frameSize = wal.readUInt32BE(8) + 24;
      assert.equal((wal.length - 32) % frameSize, 0);
      const lastCommitPages = wal.readUInt32BE(wal.length - frameSize + 4);
      assert(lastCommitPages > 0, 'Truncation fixture must target a frame carrying an actual commit marker');
      for (const fault of ['truncated-commit', 'first-frame-salt']) {
        const { api: before } = await authenticated(target);
        const original = await (await before('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
        assert(original.items.some((item: { pk: string }) => item.pk === 'wal-sentinel'));
        const damaged = fault === 'truncated-commit' ? Buffer.from(wal.subarray(0, wal.length - 1)) : Buffer.from(wal);
        if (fault === 'first-frame-salt') damaged[32 + 8] = damaged[32 + 8]! ^ 0xff;
        await writeFile(join(tree, 'sync.sqlite-wal'), damaged);
        await rm(join(tree, 'sync.sqlite-shm'), { force: true });
        const packed = await run('tar', ['czf', join(broken, 'data.tgz'), '-C', tree, '.']);
        assert(packed.ok, packed.stderr);
        const manifest = JSON.parse(await readFile(join(broken, 'manifest.json'), 'utf8'));
        manifest.dataSha256 = await sha256File(join(broken, 'data.tgz'));
        const text = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(join(broken, 'manifest.json'), text);
        await writeBackupAuthentication(target.directory, broken, text);
        await restoreCommand(target.directory, { yes: true }, [broken]);
        assert.equal((await readState(target.directory)).incompleteOperation, undefined);
        const { api } = await authenticated(target);
        const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
        assert(!snapshot.items.some((item: { pk: string }) => item.pk === 'wal-sentinel'));
        evidence(`${fault}: restore reports success while committed record is missing`, {
          sentinelBefore: true, sentinelAfter: false, walBytesBefore: wal.length, walBytesAfter: damaged.length,
          lastCommitPages, shmRemoved: true, baselineVerification: await verify(target),
          distinction: 'No damaged full matching-salt frame: indistinguishable from an interrupted append or stale reset tail without expected record inventory',
        }, 'limitation');
        if (fault === 'truncated-commit') {
          await restoreCommand(target.directory, { yes: true }, [targetBackup]);
          evidence('intact archive restores the committed record between independent tail faults', await verify(target));
        }
      }
    } else {
      const corruptionOffset = walFrameOnly ? 32 + 24 + 100 : 0;
      assert(wal.length > corruptionOffset);
      wal[corruptionOffset] = wal[corruptionOffset]! ^ 0xff;
      await writeFile(join(tree, 'sync.sqlite-wal'), wal);
      await rm(join(tree, 'sync.sqlite-shm'), { force: true });
      const packed = await run('tar', ['czf', join(broken, 'data.tgz'), '-C', tree, '.']);
      assert(packed.ok, packed.stderr);
      const manifest = JSON.parse(await readFile(join(broken, 'manifest.json'), 'utf8'));
      manifest.dataSha256 = await sha256File(join(broken, 'data.tgz'));
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(broken, 'manifest.json'), text);
      await writeBackupAuthentication(target.directory, broken, text);
      await assert.rejects(restoreCommand(target.directory, { yes: true }, [broken]), walFrameOnly
        ? /Invalid SQLite WAL frame checksum/ : /Invalid SQLite WAL header/);
      assert.equal((await readState(target.directory)).incompleteOperation, undefined);
      const { api } = await authenticated(target);
      const snapshot = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
      const retained = snapshot.items.some((item: { pk: string }) => item.pk === 'wal-sentinel');
      assert(retained, 'Refused corrupt target must recover the original committed WAL record');
      evidence(walFrameOnly
        ? 'corrupt WAL frame refused before startup; automatic recovery preserves committed WAL-only record and baseline data'
        : 'corrupt WAL header refused before startup; automatic recovery preserves committed WAL-only record and baseline data', {
        sentinelRetained: retained, walBytes: wal.length, shmRemoved: true, baselineVerification: await verify(target),
        corruptionOffset, outcome: 'Invalid archive refused; original pre-mutation snapshot restored',
      });
      if (walFrameOnly) {
        const frameSize = originalWal.readUInt32BE(8) + 24;
        for (const tail of ['stale', 'incomplete']) {
          const bytes = Buffer.from(originalWal.subarray(32, 32 + (tail === 'stale' ? frameSize : 100)));
          if (tail === 'stale') bytes[8] = bytes[8]! ^ 0xff;
          await writeFile(join(tree, 'sync.sqlite-wal'), Buffer.concat([originalWal, bytes]));
          const packed = await run('tar', ['czf', join(broken, 'data.tgz'), '-C', tree, '.']);
          assert(packed.ok, packed.stderr);
          manifest.dataSha256 = await sha256File(join(broken, 'data.tgz'));
          const text = `${JSON.stringify(manifest, null, 2)}\n`;
          await writeFile(join(broken, 'manifest.json'), text);
          await writeBackupAuthentication(target.directory, broken, text);
          await restoreCommand(target.directory, { yes: true }, [broken]);
          const { api } = await authenticated(target);
          const restored = await (await api('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
          assert(restored.items.some((item: { pk: string }) => item.pk === 'wal-sentinel'));
          evidence(`${tail} WAL tail remains accepted and preserves the committed record`, await verify(target));
        }
      }
    }
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    const { api: recovered } = await authenticated(target);
    const good = await (await recovered('/api/sync/snapshot', { scope: { workspaceId }, pageSize: 100, ...caps })).json();
    assert(good.items.some((item: { pk: string }) => item.pk === 'wal-sentinel'));
    evidence('known-good archive restores committed WAL sentinel and baseline records', await verify(target));
  }
  if (capacityOnly) {
    const large = join(root, 'capacity-archive');
    const tree = join(root, 'capacity-tree');
    await cp(targetBackup, large, { recursive: true });
    await mkdir(tree);
    const unpacked = await run('tar', ['xzf', join(large, 'data.tgz'), '-C', tree]);
    assert(unpacked.ok, unpacked.stderr);
    await writeFile(join(tree, 'synthetic-capacity-payload.bin'), '');
    const payloadMiB = sparseOnly ? 120 : 80;
    await truncate(join(tree, 'synthetic-capacity-payload.bin'), payloadMiB * 1024 * 1024);
    const packed = await run('tar', ['czf', join(large, 'data.tgz'), '-C', tree, '.']);
    assert(packed.ok, packed.stderr);
    const manifest = JSON.parse(await readFile(join(large, 'manifest.json'), 'utf8'));
    manifest.dataBytes = (manifest.dataBytes ?? 0) + payloadMiB * 1024 * 1024;
    manifest.dataSha256 = await sha256File(join(large, 'data.tgz'));
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(large, 'manifest.json'), text);
    await writeBackupAuthentication(target.directory, large, text);
    if (sparseOnly) await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
      "const fs=require('node:fs');const fd=fs.openSync('/data/synthetic-sparse.bin','w');fs.ftruncateSync(fd,128*1024*1024);fs.closeSync(fd)"]), target.directory);
    const before = await readFile(join(target.directory, '.or3-cloud/state.json'), 'utf8');
    let mutations = 0;
    lifecycleFaults.beforeCommand = (_command, args) => {
      if (args.includes('find /data -mindepth 1 -delete') || args[0] === 'compose' && args.some(arg => ['stop', 'down', 'up'].includes(arg))) mutations++;
    };
    let refusal = '';
    try {
      await assert.rejects(restoreCommand(target.directory, { yes: true }, [large]), error => {
        refusal = String(error);
        return /Restore needs at least .* only .* bytes are available/.test(refusal);
      });
    } finally { delete lifecycleFaults.beforeCommand; }
    assert.equal(mutations, 0);
    assert.equal(await readFile(join(target.directory, '.or3-cloud/state.json'), 'utf8'), before);
    evidence(`actual 96 MiB filesystem refuses an authenticated ${payloadMiB} MiB payload plus reserve before journal/service/data mutation`, {
      refusal, sparseLogicalMiB: sparseOnly ? 128 : 0, verification: await verify(target), volatileFixtureOnly: true,
    });
    await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', nodePath, '-e',
      "const fs=require('node:fs');const fd=fs.openSync('/data/synthetic-pressure.bin','w');const chunk=Buffer.alloc(65536);for(let i=0;i<640;i++)fs.writeSync(fd,chunk);fs.fsyncSync(fd);fs.closeSync(fd)"]), target.directory);
    const free = Number(await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', 'sh', '-c', "df -Pk /data | awk 'END { print $4 * 1024 }'"]), target.directory));
    assert(free < 64 * 1024 * 1024, 'Actual allocated pressure must leave less than the reserve');
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    await command(composeArgs(target.directory, 'local', ['exec', '-T', 'or3', 'sh', '-c', 'test ! -e /data/synthetic-pressure.bin']), target.directory);
    evidence('actual filesystem restore reclaims 40 MiB allocated pressure and preserves records when initial free bytes alone are insufficient', {
      freeBeforeBytes: free, verification: await verify(target), volatileFixtureOnly: true,
    });
  }
  if (blobContentOnly) {
    const damagedArchive = join(root, 'corrupt-blob-content');
    const tree = join(root, 'corrupt-blob-tree');
    await cp(targetBackup, damagedArchive, { recursive: true });
    await mkdir(tree);
    const unpacked = await run('tar', ['xzf', join(damagedArchive, 'data.tgz'), '-C', tree]);
    assert(unpacked.ok, unpacked.stderr);
    const blob = join(tree, 'storage/workspaces', workspaceId, hash.replace(':', '_'));
    const damagedBytes = await readFile(blob);
    assert.deepEqual(damagedBytes, fileBytes);
    damagedBytes[0] = damagedBytes[0]! ^ 0xff;
    await writeFile(blob, damagedBytes);
    const packed = await run('tar', ['czf', join(damagedArchive, 'data.tgz'), '-C', tree, '.']);
    assert(packed.ok, packed.stderr);
    const manifest = JSON.parse(await readFile(join(damagedArchive, 'manifest.json'), 'utf8'));
    manifest.dataSha256 = await sha256File(join(damagedArchive, 'data.tgz'));
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(damagedArchive, 'manifest.json'), text);
    await writeBackupAuthentication(target.directory, damagedArchive, text);
    await assert.rejects(restoreCommand(target.directory, { yes: true }, [damagedArchive]), /Filesystem payload hash mismatch/);
    assert.equal((await readState(target.directory)).incompleteOperation, undefined);
    const { api } = await authenticated(target);
    const download = await (await api('/api/storage/presign-download', { workspace_id: workspaceId, hash,
      storage_id: storageId, file_kind_capability: 'v1' })).json();
    const response = await api(download.url);
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.deepEqual(received, fileBytes);
    assert.notDeepEqual(received, damagedBytes);
    const receivedHash = `sha256:${createHash('sha256').update(received).digest('hex')}`;
    assert.equal(receivedHash, hash);
    evidence('corrupt committed attachment content refused before startup; snapshot recovery preserves original bytes and hash', {
      declaredHash: hash, receivedHash, status: response.status, byteLength: received.length,
      baselineRecordsAndNativeIntegrity: await verify(target),
    });
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    evidence('intact archive restores original attachment content and its declared hash', await verify(target));
  }
  if (archiveRaceOnly) {
    for (const fault of ['checksum-change', 'authenticated-database-omission']) {
      const changedArchive = join(root, `archive-race-${fault}`);
      await cp(targetBackup, changedArchive, { recursive: true });
      let validated = false;
      let changed = false;
      lifecycleFaults.beforeCommand = async (_command, args) => {
        if (!changed && args[0] === 'compose' && args.includes('stop')) {
          // Streamed tar commands do not use beforeCommand. The snapshot's
          // normal stop command is reached only after the early preflight.
          const pending = (await readState(target.directory)).incompleteOperation;
          assert.equal(pending?.phase, 'prepared');
          assert.equal(pending?.backupPath, changedArchive);
          assert(pending?.previousBackupPath);
          validated = true;
          changed = true;
          if (fault === 'checksum-change') await appendFile(join(changedArchive, 'data.tgz'), 'synthetic post-preflight mutation');
          else {
            const tree = join(root, 'archive-race-tree');
            await mkdir(tree);
            const unpacked = await run('tar', ['xzf', join(changedArchive, 'data.tgz'), '-C', tree]);
            assert(unpacked.ok, unpacked.stderr);
            for (const name of ['auth.sqlite', 'auth.sqlite-wal', 'auth.sqlite-shm']) await rm(join(tree, name), { force: true });
            const packed = await run('tar', ['czf', join(changedArchive, 'data.tgz'), '-C', tree, '.']);
            assert(packed.ok, packed.stderr);
            const manifest = JSON.parse(await readFile(join(changedArchive, 'manifest.json'), 'utf8'));
            manifest.dataSha256 = await sha256File(join(changedArchive, 'data.tgz'));
            const text = `${JSON.stringify(manifest, null, 2)}\n`;
            await writeFile(join(changedArchive, 'manifest.json'), text);
            await writeBackupAuthentication(target.directory, changedArchive, text);
          }
        }
      };
      try {
        await assert.rejects(restoreCommand(target.directory, { yes: true }, [changedArchive]), fault === 'checksum-change'
          ? /checksum mismatch/ : /missing required managed database payloads/);
      } finally { delete lifecycleFaults.beforeCommand; }
      assert(changed && validated);
      assert.equal((await readState(target.directory)).incompleteOperation, undefined);
      evidence(`${fault} after early preflight is refused by retained rechecks; pre-start recovery preserves live data`, await verify(target));
    }
    await stopProject(target.directory, 'local');
    await startProject(target.directory, 'local', target.env);
    evidence('post-preflight archive-race recovery survives an actual cold restart', await verify(target));
  }
  if (concurrencyOnly || multiWorkspaceOnly) {
    await restoreCommand(target.directory, { yes: true }, [targetBackup]);
    evidence(multiWorkspaceOnly ? 'managed restore retains both workspace memberships, duplicate record IDs and independently scoped shared-hash attachments'
      : 'managed restore retains every acknowledged concurrent atomic batch', await verify(target));
    await stopProject(target.directory, 'local');
    await startProject(target.directory, 'local', target.env);
    evidence(multiWorkspaceOnly ? 'both workspace settings, chats and attachment bytes remain distinct after another cold restart'
      : 'acknowledged concurrent batches remain intact after another cold restart', await verify(target));
  }
  if (builtCliOnly || filesystemCompatOnly) {
    if (alternateStorageOnly) {
      for (const fault of ['missing-blob', 'corrupt-legacy-blob']) {
        const broken = join(root, `alternate-${fault}`);
        const tree = join(root, `alternate-tree-${fault}`);
        await cp(targetBackup, broken, { recursive: true });
        await mkdir(tree);
        const unpack = await run('tar', ['xzf', join(broken, 'data.tgz'), '-C', tree]);
        assert(unpack.ok, unpack.stderr);
        const key = fault === 'missing-blob' ? hash : legacyAttachment!.hash;
        const blob = join(tree, 'retained uploads/workspaces', workspaceId, key.replace(':', '_'));
        if (fault === 'missing-blob') await rm(blob);
        else {
          const bytes = await readFile(blob);
          bytes[0] ^= 1;
          await writeFile(blob, bytes);
        }
        const packed = await run('tar', ['czf', join(broken, 'data.tgz'), '-C', tree, '.']);
        assert(packed.ok, packed.stderr);
        const manifest = JSON.parse(await readFile(join(broken, 'manifest.json'), 'utf8'));
        manifest.dataSha256 = await sha256File(join(broken, 'data.tgz'));
        const text = `${JSON.stringify(manifest, null, 2)}\n`;
        await writeFile(join(broken, 'manifest.json'), text);
        await writeBackupAuthentication(target.directory, broken, text);
        const beforeState = await readState(target.directory);
        const beforeContainer = await command(composeArgs(target.directory, 'local', ['ps', '-q', 'or3']), target.directory);
        await assert.rejects(restoreCommand(target.directory, { yes: true }, [broken]), fault === 'missing-blob'
          ? /sidecar without its required blob payload/ : /Filesystem payload hash mismatch/);
        if (fault === 'missing-blob') {
          assert.deepEqual(await readState(target.directory), beforeState);
          assert.equal(await command(composeArgs(target.directory, 'local', ['ps', '-q', 'or3']), target.directory), beforeContainer);
        }
        evidence(`alternate filesystem root with spaces: ${fault} refused and intact scoped objects retained`, await verify(target));
      }
    }
    const cli = fileURLToPath(new URL('../../packages/or3-cloud/dist/cli.mjs', import.meta.url));
    const restored = await run(process.execPath, [cli, 'restore', targetBackup, '--yes'], target.directory);
    assert(restored.ok, restored.stderr);
    assert.match(restored.stdout, /Restored backup-/);
    assert.equal((await readState(target.directory)).incompleteOperation, undefined);
    evidence(emptyStorageOnly ? 'built CLI native helper accepts legitimate absent filesystem object directory without inventing attachment references'
      : filesystemCompatOnly ? 'built CLI native helper accepts legacy MD5, empty/multi-chunk committed objects and preserves temporary/uncommitted/opaque fixtures'
      : 'built CLI dispatcher restores real archive with lease and serialized native database/WAL checks', await verify(target));
    await stopProject(target.directory, 'local');
    await startProject(target.directory, 'local', target.env);
    evidence('built CLI restore survives another actual cold restart', await verify(target));
    const status = await run(process.execPath, [cli, 'status', '--json'], target.directory);
    assert(status.ok, status.stderr);
    const state = JSON.parse(status.stdout);
    await writeFile(join(evidencePath, '..', 'built-cli-status.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    assert.equal(state.state.deploymentId, target.state.deploymentId);
    assert.equal(state.inProgress, false);
    assert.equal(state.lease, 'none');
    assert.equal(state.docker, true);
    const repoDigests = JSON.parse(await command(['image', 'inspect', '--format', '{{json .RepoDigests}}', image]));
    assert.equal(state.identityMatches, repoDigests.length ? true : null);
    const container = await command(composeArgs(target.directory, 'local', ['ps', '-q', 'or3']), target.directory);
    assert.equal(await command(['inspect', '--format', '{{.Image}}', container]), digest);
    evidence('built CLI read-only status remains available after restore lease release', {
      deploymentIdentityPreserved: true, lease: state.lease, docker: state.docker,
      identityMatches: state.identityMatches, runningImageIdMatches: true,
      boundary: 'Unpublished local fixture has no RepoDigests; status correctly leaves registry-qualified image identity unknown. Direct local image ID matches.',
    });
  }
  if (browserOnly) evidence('fresh browser reads restored conversation and document through the actual UI', await verifyBrowser(target));
  completed = true;
} finally {
  for (const key of Object.keys(lifecycleFaults)) delete lifecycleFaults[key as keyof typeof lifecycleFaults];
  for (const fixture of instances.reverse()) {
    try {
      await command(composeArgs(fixture.directory, 'local', ['down']), fixture.directory);
      if (fixture.volumeHolder) await command(['rm', '--force', fixture.volumeHolder], fixture.directory);
      await command(['volume', 'rm', fixture.state.volumeName], fixture.directory);
    } catch (error) { cleanupFailed = true; outcomes.push({ name: 'cleanup failure', kind: 'cleanup-failure', detail: String(error) }); }
  }
  await mkdir(join(evidencePath, '..'), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify({ completed, cleanupFailed, deep, alternateStorageOnly, emptyStorageOnly, filesystemCompatOnly, blobContentOnly, archiveRaceOnly, concurrencyOnly, multiWorkspaceOnly, workspaceOmissionOnly, builtCliOnly, recoveryOnly, crashOnly, prestartCrashOnly, browserOnly, journalOnly, attachmentOnly, sqliteOnly, sqliteWalOnly, walCorruptionOnly, walFrameOnly, walTailOnly, capacityOnly, sparseOnly, nodePath, cliRevision, sourceRevision, image, imageDigest: digest, packageVersion: PACKAGE_VERSION,
    outcomes, boundaries: ['Internal Docker networks and network-none extraction; no model requests.',
      'Cross-instance transfer uses production raw archive primitive after source authentication; managed foreign-identity gate is tested separately.',
      browserOnly ? 'Fresh-browser conversation/document read qualification; other UI flows and external provider stacks are not covered.'
        : 'API/backend persistence qualification; browser UI and external provider stacks are not covered.'], fixtureRoot: root }, null, 2)}\n`);
  if (!cleanupFailed) await rm(root, { recursive: true, force: true });
  if (cleanupFailed) process.exitCode = 1;
}

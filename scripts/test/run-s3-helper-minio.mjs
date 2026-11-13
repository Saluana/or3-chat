// Disposable helper-level smoke against a locally built, pinned MinIO binary.
// It checks real S3 request/checksum behavior, archive bytes and conflict
// refusal. It does not qualify the container image or managed lifecycle.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough, Readable } from 'node:stream';
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { captureRemoteObjects, checkRemoteReferences, reconcileReferences } from '../docker/remote-objects.mjs';
import { verifyArchive, withVerifiedArchive } from '../docker/remote-archive.mjs';
import { QUALIFIED_MIGRATIONS } from '../docker/backup-inspect.mjs';

const receipt = resolve('test-results/cloud-recovery-s3/helper-minio-native.json');
// A failed rerun must never leave an earlier passing result looking current.
await rm(receipt, { force: true });
const binary = process.env.OR3_MINIO_BINARY;
if (!binary || !binary.startsWith('/')) throw new Error('Set OR3_MINIO_BINARY to the absolute path of a disposable MinIO executable.');
const binaryMetadata = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' });
if (!binaryMetadata.includes('github.com/minio/minio\tv0.0.0-20251015172955-9e49d5e7a648\t')) throw new Error('MinIO binary does not identify the pinned source revision.');
const require = createRequire(import.meta.url);
const sdkVersion = JSON.parse(await readFile(require.resolve('@aws-sdk/client-s3/package.json'), 'utf8')).version;
if (sdkVersion !== '3.1164.0') throw new Error('The native smoke requires the launch-profile S3 SDK version 3.1164.0.');
const temporary = await mkdtemp(join(tmpdir(), 'or3-s3-minio-'));
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const port = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); });
});
const [apiPort, consolePort] = await Promise.all([port(), port()]);
const endpointOrigin = `http://127.0.0.1:${apiPort}`;
const accessKeyId = `fixture${randomBytes(10).toString('hex')}`;
const secretAccessKey = randomBytes(32).toString('hex');
const client = new S3Client({ endpoint: endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
const server = spawn(binary, ['server', '--address', `127.0.0.1:${apiPort}`, '--console-address', `127.0.0.1:${consolePort}`, join(temporary, 'data')], {
  env: { PATH: process.env.PATH, HOME: temporary, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey, MINIO_BROWSER: 'off', MINIO_UPDATE: 'off', GOMAXPROCS: '2' },
  stdio: 'ignore',
});
// Subscribe immediately; exitCode remains null for signal exits, and waiting
// for an already-emitted event can otherwise hang cleanup forever.
const serverDone = new Promise(done => {
  server.once('error', error => done({ error }));
  server.once('exit', (code, signal) => done({ code, signal }));
});
let result;
let deadline;
let runPromise;
let proxy;
let proxyClient;
const helperChildren = new Set();
try {
  const run = async () => {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('MinIO exited before becoming healthy.');
    try { healthy = (await fetch(`${endpointOrigin}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (healthy) break;
    await new Promise(done => setTimeout(done, 100));
  }
  if (!healthy) throw new Error('MinIO did not become healthy.');
  for (const Bucket of ['source-bucket', 'target-bucket', 'conflict-bucket', 'command-bucket']) await client.send(new CreateBucketCommand({ Bucket }));
  const source = { endpointOrigin, bucket: 'source-bucket', keyPrefix: 'fixture/' };
  const target = { ...source, bucket: 'target-bucket' };
  const conflict = { ...source, bucket: 'conflict-bucket' };
  const fixtures = [['workspace-a', 'sha256', Buffer.from('synthetic sha256 payload')], ['workspace-b', 'md5', Buffer.from('synthetic legacy payload')]].map(([workspaceId, algorithm, bytes]) => {
    const digest = `${algorithm}:${hash(algorithm, bytes)}`;
    const ref = { workspaceId, hash: digest, storageId: `fixture/${workspaceId}/${digest}`, sizeBytes: bytes.length };
    const marker = Buffer.from(JSON.stringify({ workspace_id: workspaceId, hash: digest, storage_id: ref.storageId, size_bytes: bytes.length, mime_type: 'text/plain' }));
    return { ref, bytes, marker };
  });
  for (const { ref, bytes, marker } of fixtures) {
    await client.send(new PutObjectCommand({ Bucket: source.bucket, Key: ref.storageId, Body: bytes }));
    await client.send(new PutObjectCommand({ Bucket: source.bucket, Key: `${ref.storageId}.meta.json`, Body: marker }));
  }
  const refs = fixtures.map(item => item.ref);
  // Run the actual helper command with a real SQLite inventory against MinIO.
  // The scripts and synthetic profile live in a private temporary directory.
  const helperDirectory = join(temporary, 'helper');
  await mkdir(helperDirectory, { mode: 0o700 });
  for (const name of ['backup-inspect.mjs', 'remote-archive.mjs', 'remote-objects.mjs']) await copyFile(new URL(`../docker/${name}`, import.meta.url), join(helperDirectory, name));
  await symlink(new URL('../../node_modules', import.meta.url), join(helperDirectory, 'node_modules'), 'dir');
  await writeFile(join(helperDirectory, 'backup-inspection-profile.json'), JSON.stringify({ contract: 2, sqlite: '0.0.29', s3: '0.0.15' }), { mode: 0o600 });
  const Database = require('better-sqlite3');
  const databasePath = join(temporary, 'sync.sqlite');
  const database = new Database(databasePath);
  try {
    database.exec('CREATE TABLE kysely_migration(name TEXT PRIMARY KEY); CREATE TABLE s_file_meta(workspace_id TEXT NOT NULL,id TEXT NOT NULL,data_json TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(workspace_id,id));');
    for (const name of QUALIFIED_MIGRATIONS) database.prepare('INSERT INTO kysely_migration VALUES(?)').run(name);
    for (const { ref } of fixtures) database.prepare('INSERT INTO s_file_meta VALUES(?,?,?,0)').run(ref.workspaceId, ref.hash, JSON.stringify({ size_bytes: ref.sizeBytes, storage_id: ref.storageId }));
  } finally { database.close(); }
  const helperEnv = { PATH: process.env.PATH, OR3_STORAGE_S3_ENDPOINT: endpointOrigin, OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: source.bucket, OR3_STORAGE_S3_KEY_PREFIX: 'fixture/', OR3_STORAGE_S3_ACCESS_KEY_ID: accessKeyId, OR3_STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey, OR3_STORAGE_S3_FORCE_PATH_STYLE: 'true', OR3_STORAGE_S3_ALLOW_INSECURE_HTTP: 'true' };
  const invoke = (operation, args, env) => new Promise((yes, no) => {
    const child = execFile(process.execPath, [join(helperDirectory, 'remote-objects.mjs'), operation, databasePath, ...args], { env, encoding: 'buffer', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      helperChildren.delete(child);
      if (error) no(new Error(`Disposable ${operation} helper failed.`)); else yes(stdout);
    });
    helperChildren.add(child);
  });
  const commandArchive = await invoke('capture', [], helperEnv);
  assert.equal((await verifyArchive(Readable.from([commandArchive]), refs, source)).objectCount, 2);
  const commandArchivePath = join(temporary, 'command.tar');
  await writeFile(commandArchivePath, commandArchive, { mode: 0o600 });
  const commandEnv = { ...helperEnv, OR3_STORAGE_S3_BUCKET: 'command-bucket', OR3_BACKUP_S3_ENDPOINT_ORIGIN: endpointOrigin, OR3_BACKUP_S3_BUCKET: source.bucket, OR3_BACKUP_S3_KEY_PREFIX: source.keyPrefix, OR3_BACKUP_ARCHIVE_SHA256: hash('sha256', commandArchive) };
  assert.deepEqual(JSON.parse(await invoke('reconcile', [commandArchivePath], commandEnv)), { uploaded: 2, markersCreated: 2 });
  assert.deepEqual(JSON.parse(await invoke('check-copy', [commandArchivePath], commandEnv)), { checked: 2, missing: [], mismatched: [] });
  const output = new PassThrough(), chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const captured = await captureRemoteObjects(client, source, refs, output);
  const archive = Buffer.concat(chunks), archivePath = join(temporary, 'remote.tar');
  await writeFile(archivePath, archive, { mode: 0o600 });
  assert.equal((await verifyArchive(Readable.from([archive]), refs, source)).objectCount, 2);
  const unauthorized = new S3Client({ endpoint: endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey: 'incorrect-fixture-secret' }, maxAttempts: 1 });
  try {
    const refused = new PassThrough(); refused.resume();
    await assert.rejects(captureRemoteObjects(unauthorized, source, refs, refused), /remote-forbidden/);
    assert.equal((await checkRemoteReferences(client, source, refs)).checked, 2);
  } finally { unauthorized.destroy(); }
  // Interrupt a real MinIO payload response after some bytes and require the
  // helper to resume with a range request and verify the completed archive.
  let interrupted = false, rangeSeen = '';
  proxy = createHttpServer((req, res) => {
    const upstream = httpRequest({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: req.headers }, response => {
      const payload = decodeURIComponent(req.url.split('?')[0]).endsWith(refs[0].storageId);
      if (payload && req.headers.range) rangeSeen = req.headers.range;
      res.writeHead(response.statusCode, response.headers);
      if (payload && !interrupted) {
        interrupted = true;
        response.once('data', chunk => { res.write(chunk.subarray(0, 7)); setTimeout(() => { response.destroy(); res.destroy(); }, 100); });
      } else response.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise((yes, no) => { proxy.once('error', no); proxy.listen(0, '127.0.0.1', yes); });
  const proxyEndpoint = `http://127.0.0.1:${proxy.address().port}`;
  proxyClient = new S3Client({ endpoint: proxyEndpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
  try {
    const proxiedSource = { ...source, endpointOrigin: proxyEndpoint };
    const resumedOutput = new PassThrough(), resumedChunks = [];
    resumedOutput.on('data', chunk => resumedChunks.push(chunk));
    await captureRemoteObjects(proxyClient, proxiedSource, [refs[0]], resumedOutput);
    assert.equal(rangeSeen, 'bytes=7-');
    assert.equal((await verifyArchive(Readable.from([Buffer.concat(resumedChunks)]), [refs[0]], proxiedSource)).objectCount, 1);
  } finally { proxyClient.destroy(); proxy.closeAllConnections(); await new Promise(yes => proxy.close(yes)); proxy = undefined; proxyClient = undefined; }
  const reconcile = () => withVerifiedArchive(archivePath, refs, source, hash('sha256', archive), entries => reconcileReferences(client, target, entries));
  assert.deepEqual(await reconcile(), { uploaded: 2, markersCreated: 2 });
  assert.deepEqual(await reconcile(), { uploaded: 0, markersCreated: 0 });
  assert.deepEqual(await checkRemoteReferences(client, target, refs), { checked: 2, missing: [], mismatched: [] });
  for (const { ref, bytes } of fixtures) {
    const object = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: ref.storageId }));
    assert.deepEqual(Buffer.from(await object.Body.transformToByteArray()), bytes);
  }
  await client.send(new PutObjectCommand({ Bucket: conflict.bucket, Key: refs[1].storageId, Body: Buffer.from('conflict') }));
  await assert.rejects(withVerifiedArchive(archivePath, refs, source, hash('sha256', archive), entries => reconcileReferences(client, conflict, entries)), /remote-target-conflict/);
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: conflict.bucket, Key: refs[0].storageId })), error => error.$metadata?.httpStatusCode === 404);
  await assert.rejects(client.send(new PutObjectCommand({ Bucket: target.bucket, Key: refs[0].storageId, Body: Buffer.from('overwrite'), IfNoneMatch: '*' })), error => error.$metadata?.httpStatusCode === 412);
  await assert.rejects(client.send(new PutObjectCommand({ Bucket: target.bucket, Key: 'checksum-negative-control', Body: 'invalid checksum', ChecksumSHA256: Buffer.alloc(32).toString('base64') })), error => error.$metadata?.httpStatusCode === 400 && error.name === 'XAmzContentChecksumMismatch');
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: target.bucket, Key: 'checksum-negative-control' })), error => error.$metadata?.httpStatusCode === 404);
  await client.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: `${refs[0].storageId}.meta.json` }));
  const missingOutput = new PassThrough(); missingOutput.resume();
  await assert.rejects(captureRemoteObjects(client, source, refs, missingOutput), /remote-missing/);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  result = {
    evidence: 'minio-native-helper-only', timestamp: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')),
    sourceHashes: Object.fromEntries(await Promise.all([['scripts/docker/backup-inspect.mjs', new URL('../docker/backup-inspect.mjs', import.meta.url)], ['scripts/docker/remote-archive.mjs', new URL('../docker/remote-archive.mjs', import.meta.url)], ['scripts/docker/remote-objects.mjs', new URL('../docker/remote-objects.mjs', import.meta.url)], ['scripts/test/run-s3-helper-minio.mjs', new URL(import.meta.url)]].map(async ([path, url]) => [path, hash('sha256', await readFile(url))]))),
    minioBinarySha256: hash('sha256', await readFile(binary)), minioModule: binaryMetadata.split('\n').find(line => line.includes('github.com/minio/minio\tv0.0.0-20251015172955-9e49d5e7a648\t'))?.trim(),
    nodeVersion: process.version, sdkVersion, sqliteVersion: JSON.parse(await readFile(require.resolve('better-sqlite3/package.json'), 'utf8')).version,
    objectCount: captured.objectCount, payloadBytes: captured.payloadBytes,
    cases: ['sqlite-helper-command-capture-reconcile-check', 'capture-and-verify', 'bad-credentials-forbidden', 'interrupted-payload-range-resume', 'restore-two-buckets', 'idempotent-reconcile', 'download-byte-equality', 'conflict-refusal-before-write', 'conditional-put', 'bad-checksum-refused', 'missing-marker-refused'],
  };
  };
  runPromise = run();
  await Promise.race([runPromise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Native MinIO helper smoke exceeded its 120-second deadline.')), 120_000); })]);
} finally {
  clearTimeout(deadline);
  for (const child of helperChildren) child.kill('SIGKILL');
  proxyClient?.destroy();
  proxy?.closeAllConnections();
  client.destroy();
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    const exited = await Promise.race([serverDone.then(() => true), new Promise(done => setTimeout(() => done(false), 5000))]);
    if (!exited) {
      server.kill('SIGKILL');
      if (!await Promise.race([serverDone.then(() => true), new Promise(done => setTimeout(() => done(false), 5000))])) throw new Error(`MinIO did not stop; inspect private temporary directory ${temporary}.`);
    }
  }
  if (runPromise && !await Promise.race([runPromise.then(() => true, () => true), new Promise(done => setTimeout(() => done(false), 5000))])) throw new Error(`Native smoke did not stop; inspect private temporary directory ${temporary}.`);
  await rm(temporary, { recursive: true, force: true });
}
await mkdir(resolve('test-results/cloud-recovery-s3'), { recursive: true, mode: 0o700 });
await writeFile(receipt, `${JSON.stringify({ ...result, cleanup: 'temporary-server-and-data-removed' }, null, 2)}\n`, { mode: 0o600 });
console.log(`Native MinIO helper smoke passed; receipt: ${receipt}`);

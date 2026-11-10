import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { createServer } from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import * as inspector from '../../../scripts/docker/backup-inspect.mjs';

// Real SQLite snapshots: a missing, wrongly scoped or unbounded object must
// never become a certified recovery reference. Pending and deleted rows are
// excluded; incomplete or unknown migrations cannot be inspected safely.
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
class OfflineDatabase {
  private db: Database;
  constructor(path: string) { this.db = new Database(path, { readonly: true }); }
  pragma(sql: string, options?: { simple: boolean }) { return options?.simple ? this.db.query(`PRAGMA ${sql}`).values()[0]?.[0] : this.db.exec(`PRAGMA ${sql}`); }
  prepare(sql: string) { return this.db.query(sql); }
  close() { this.db.close(); }
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'or3-s3-inventory-')); dirs.push(dir);
  const path = join(dir, 'sync.sqlite');
  const db = new Database(path);
  db.exec('CREATE TABLE kysely_migration(name TEXT PRIMARY KEY); CREATE TABLE s_file_meta(workspace_id TEXT NOT NULL,id TEXT NOT NULL,data_json TEXT NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(workspace_id,id));');
  for (const name of inspector.QUALIFIED_MIGRATIONS) db.query('INSERT INTO kysely_migration VALUES(?)').run(name);
  const put = (workspace: string, hash: string, data: unknown, deleted = 0) => db.query('INSERT OR REPLACE INTO s_file_meta VALUES(?,?,?,?)').run(workspace, hash, JSON.stringify(data), deleted);
  const read = (keyPrefix = 'prefix/') => [...inspector.iterateS3References(OfflineDatabase, path, { keyPrefix })];
  return { db, path, put, read };
}

// Space preflight must count only committed canonical objects and their exact
// payload sizes; invalid rows must refuse the backup instead of undercounting.
test('S3 reference summary counts recoverable bytes and refuses malformed rows', () => {
  const { db, path, put } = fixture();
  try {
    const first = 'a'.repeat(64), second = 'b'.repeat(32);
    expect(inspector.summarizeS3References(OfflineDatabase, path, { keyPrefix: 'prefix/' })).toEqual({ contract: 2, references: 0, payloadBytes: 0 });
    put('alpha', first, { size_bytes: 10, storage_id: `prefix/alpha/sha256:${first}` });
    put('beta', second, { size_bytes: 2 ** 30, storage_id: `prefix/beta/md5:${second}` });
    put('pending', first, { size_bytes: 999 });
    put('deleted', first, { size_bytes: 999, storage_id: 'not-a-key' }, 1);
    expect(inspector.summarizeS3References(OfflineDatabase, path, { keyPrefix: 'prefix/' })).toEqual({ contract: 2, references: 2, payloadBytes: 2 ** 30 + 10 });
    put('alpha', first, { size_bytes: 10, storage_id: 'wrong-key' });
    expect(() => inspector.summarizeS3References(OfflineDatabase, path, { keyPrefix: 'prefix/' })).toThrow('storage ID');
  } finally { db.close(); }
});

test('S3 inspection refuses unsupported profile and provider versions', () => {
  expect(() => inspector.assertS3InspectionProfile({ contract: 2, sqlite: '0.0.28', s3: '0.0.15' })).not.toThrow();
  for (const profile of [{ contract: 0, sqlite: '0.0.28', s3: '0.0.15' }, { contract: 2, sqlite: '0.0.27', s3: '0.0.15' }, { contract: 2, sqlite: '0.0.28', s3: '0.0.14' }]) {
    expect(() => inspector.assertS3InspectionProfile(profile)).toThrow('Unsupported');
  }
});

test('archive inventory accepts only a qualified filesystem or S3 inspection profile', () => {
  expect(() => inspector.assertArchiveInspectionProfile({ contract: 1, sqlite: '0.0.28', filesystem: '0.0.17' })).not.toThrow();
  expect(() => inspector.assertArchiveInspectionProfile({ contract: 2, sqlite: '0.0.28', s3: '0.0.15' })).not.toThrow();
  expect(() => inspector.assertArchiveInspectionProfile({ contract: 0, sqlite: '0.0.28', s3: '0.0.15' })).toThrow('Unsupported');
  expect(() => inspector.assertArchiveInspectionProfile({ contract: 2, sqlite: '0.0.28', s3: '0.0.14' })).toThrow('Unsupported');
});

test('S3 references are bound to canonical live rows and normalized object keys', () => {
  const { db, put, read } = fixture();
  try {
    const sha = 'a'.repeat(64), md5 = 'b'.repeat(32);
    put('alpha', sha, { size_bytes: 3, storage_id: `prefix/alpha/sha256:${sha}` });
    put('beta', `MD5:${md5}`, { sizeBytes: 0, storageId: `prefix/beta/md5:${md5}` });
    put('pending', sha, { size_bytes: 1 });
    put('deleted', sha, { size_bytes: 1, storage_id: 'not-a-key' }, 1);
    expect(read()).toEqual([
      { workspaceId: 'alpha', hash: `sha256:${sha}`, storageId: `prefix/alpha/sha256:${sha}`, sizeBytes: 3 },
      { workspaceId: 'beta', hash: `md5:${md5}`, storageId: `prefix/beta/md5:${md5}`, sizeBytes: 0 },
    ]);
    expect(() => read('other/')).toThrow('storage ID');
    put('alpha', sha, { size_bytes: 2 ** 30 + 1, storage_id: `prefix/alpha/sha256:${sha}` });
    expect(() => read()).toThrow('size');
    put('alpha', sha, { size_bytes: 3, storage_id: 's3-generation-v1:unsupported' });
    expect(() => read()).toThrow('storage ID');
    put('alpha', sha, { size_bytes: 3, storage_id: `prefix/alpha/sha256:${sha}` }, 2);
    expect(() => read()).toThrow('deletion state');
    db.query('DELETE FROM kysely_migration WHERE name=?').run(inspector.QUALIFIED_MIGRATIONS.at(-1)!);
    db.query('DELETE FROM kysely_migration WHERE name=?').run(inspector.QUALIFIED_MIGRATIONS.at(-2)!);
    expect(() => read()).toThrow('migration history');
  } finally { db.close(); }
});

test('S3 references reject invalid workspace and digest identities', () => {
  const { db, put, read } = fixture();
  try {
    const hash = 'a'.repeat(64);
    put('../escape', hash, { size_bytes: 1, storage_id: `prefix/../escape/sha256:${hash}` });
    expect(() => read()).toThrow('workspace');
    db.query('DELETE FROM s_file_meta').run();
    put('valid', 'not-a-hash', { size_bytes: 1, storage_id: 'prefix/valid/not-a-hash' });
    expect(() => read()).toThrow('hash');
  } finally { db.close(); }
});

test('S3 reference scan excludes time spent transferring prior objects', () => {
  const { db, path, put } = fixture();
  const originalNow = Date.now; let now = 10_000;
  try {
    const first = 'a'.repeat(64), second = 'b'.repeat(64);
    put('alpha', first, { size_bytes: 1, storage_id: `prefix/alpha/sha256:${first}` });
    put('beta', second, { size_bytes: 1, storage_id: `prefix/beta/sha256:${second}` });
    Date.now = () => now;
    const references = inspector.iterateS3References(OfflineDatabase, path, { keyPrefix: 'prefix/' });
    expect(references.next().value?.workspaceId).toBe('alpha');
    now += 120_000;
    expect(references.next().value?.workspaceId).toBe('beta');
    expect(references.next().done).toBe(true);
  } finally { Date.now = originalNow; db.close(); }
});

// A recovery archive must bind object bytes, marker metadata and the SQLite
// inventory. Corruption, missing entries, extra entries and truncation fail.
test('S3 recovery archives verify bytes, marker and exact reference set', async () => {
  const { createArchiveWriter, verifyArchive, withVerifiedArchive } = await import('../../../scripts/docker/remote-archive.mjs');
  const payload = Buffer.from('recoverable payload');
  const digest = createHash('sha256').update(payload).digest('hex');
  const ref = { workspaceId: 'workspace', hash: `sha256:${digest}`, storageId: `prefix/workspace/sha256:${digest}`, sizeBytes: payload.length };
  const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash: ref.hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
  const source = { endpointOrigin: 'https://storage.example.invalid', bucket: 'test', keyPrefix: 'prefix/' };
  const inventory = { version: 1, source, entries: [{ ...ref, mimeType: 'text/plain', markerSha256: createHash('sha256').update(marker).digest('hex'), markerBytes: marker.length }] };
  async function archive(blob = payload, markerBlob = marker, extra = false) {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const writer = createArchiveWriter(output);
    await writer.addFile(`objects/workspace/sha256_${digest}`, blob.length, Readable.from([blob]));
    await writer.addFile(`markers/workspace/sha256_${digest}.meta.json`, markerBlob.length, Readable.from([markerBlob]));
    if (extra) await writer.addFile('unexpected', 1, Readable.from([Buffer.from('x')]));
    await writer.finish(inventory);
    return Buffer.concat(chunks);
  }
  const first = await archive();
  expect(await archive()).toEqual(first);
  expect(await verifyArchive(Readable.from([first]), [ref], source)).toMatchObject({ contract: 2, kind: 's3-copy-v1', objectCount: 1, payloadBytes: payload.length });
  const dir = mkdtempSync(join(tmpdir(), 'or3-s3-verified-archive-')); dirs.push(dir);
  const archivePath = join(dir, 'remote-objects.tar'); writeFileSync(archivePath, first);
  const archiveHash = createHash('sha256').update(first).digest('hex');
  await withVerifiedArchive(archivePath, [ref], source, archiveHash, async entries => {
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ref).toEqual(ref);
    expect(await entries[0]!.readMarker()).toEqual(marker);
    const chunks: Buffer[] = []; for await (const chunk of entries[0]!.openPayload()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(payload);
  });
  await expect(withVerifiedArchive(archivePath, [ref], source, archiveHash, async entries => {
    const changed = Buffer.from(first); changed[1536] = changed[1536]! ^ 1;
    writeFileSync(archivePath, changed);
    await entries[0]!.readMarker();
  })).rejects.toThrow();
  writeFileSync(archivePath, first);
  const linked = join(dir, 'linked.tar'); symlinkSync(archivePath, linked);
  await expect(withVerifiedArchive(linked, [ref], source, archiveHash, async () => {})).rejects.toThrow();
  for (const endpointOrigin of ['https://storage.example.invalid/other', 'https://user:pass@storage.example.invalid', 'https://storage.example.invalid?bucket=other', 'file:///tmp/storage']) {
    await expect(verifyArchive(Readable.from([first]), [ref], { ...source, endpointOrigin })).rejects.toThrow('remote-source-invalid');
  }
  await expect(verifyArchive(Readable.from([await archive(Buffer.alloc(payload.length))]), [ref], source)).rejects.toThrow('remote-hash-mismatch');
  await expect(verifyArchive(Readable.from([await archive(payload, Buffer.from('{}'))]), [ref], source)).rejects.toThrow('remote-marker-invalid');
  await expect(verifyArchive(Readable.from([await archive(payload, marker, true)]), [ref], source)).rejects.toThrow('remote-extra');
  await expect(verifyArchive(Readable.from([first.subarray(0, 700)]), [ref], source)).rejects.toThrow('remote-');
  await expect(verifyArchive(Readable.from([first]), [], source)).rejects.toThrow('remote-extra');
  await expect(verifyArchive(Readable.from([first]), [ref], { ...source, bucket: 'other' })).rejects.toThrow('remote-inventory-mismatch');
});

test('reference-only safety inventory must match the archived database and source', async () => {
  const { verifyReferenceInventory } = await import('../../../scripts/docker/remote-archive.mjs');
  const ref = { workspaceId: 'workspace', hash: `sha256:${'c'.repeat(64)}`, storageId: `prefix/workspace/sha256:${'c'.repeat(64)}`, sizeBytes: 7 };
  const source = { endpointOrigin: 'https://storage.example.invalid', bucket: 'test', keyPrefix: 'prefix/' };
  const json = JSON.stringify({ version: 1, source, entries: [ref] });
  expect(await verifyReferenceInventory(json, [ref], source)).toMatchObject({ kind: 's3-reference-v1', objectCount: 1, payloadBytes: 7 });
  await expect(verifyReferenceInventory(json, [{ ...ref, sizeBytes: 8 }], source)).rejects.toThrow('remote-inventory-mismatch');
  await expect(verifyReferenceInventory(json, [ref], { ...source, keyPrefix: 'different/' })).rejects.toThrow('remote-inventory-mismatch');
  await expect(verifyReferenceInventory(JSON.stringify({ version: 1, source, entries: [ref, ref] }), [ref], source)).rejects.toThrow('remote-inventory-mismatch');
  const foreign = { ...ref, storageId: `other/workspace/${ref.hash}` };
  await expect(verifyReferenceInventory(JSON.stringify({ version: 1, source, entries: [foreign] }), [foreign], source)).rejects.toThrow('remote-inventory-mismatch');
});

// Exercise the actual SDK over HTTP. A missing marker or wrong remote bytes
// cannot produce a successful capture, even when the object server responds.
test('S3 capture downloads and verifies live objects through the SDK', async () => {
  const { captureRemoteObjects } = await import('../../../scripts/docker/remote-objects.mjs');
  const { verifyArchive } = await import('../../../scripts/docker/remote-archive.mjs');
  const original = Buffer.from('object contents');
  const hex = createHash('sha256').update(original).digest('hex');
  const ref = { workspaceId: 'workspace', hash: `sha256:${hex}`, storageId: `prefix/workspace/sha256:${hex}`, sizeBytes: original.length };
  const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash: ref.hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
  let body = original, markerMissing = false, temporaryFailures = 0, interruptedMarkers = 0;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url!.split('?')[0]!);
    requests.push(`${request.method} ${path}`);
    const isMarker = path === `/bucket/${ref.storageId}.meta.json`;
    if (isMarker && temporaryFailures > 0) {
      temporaryFailures--;
      response.writeHead(503, { 'content-type': 'application/xml' }); response.end('<Error><Code>ServiceUnavailable</Code></Error>'); return;
    }
    if (isMarker && interruptedMarkers > 0) {
      interruptedMarkers--;
      response.writeHead(200, { 'content-length': marker.length, connection: 'close' });
      response.write(marker.subarray(0, 8));
      setTimeout(() => response.destroy(), 10);
      return;
    }
    if (request.method !== 'GET' || (!isMarker && path !== `/bucket/${ref.storageId}`) || (isMarker && markerMissing)) {
      response.writeHead(404, { 'content-type': 'application/xml' }); response.end('<Error><Code>NoSuchKey</Code></Error>'); return;
    }
    const bytes = isMarker ? marker : body;
    response.writeHead(200, { 'content-length': bytes.length }); response.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen');
  const source = { endpointOrigin: `http://127.0.0.1:${address.port}`, bucket: 'bucket', keyPrefix: 'prefix/' };
  const client = new S3Client({ endpoint: source.endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture-secret' }, maxAttempts: 1 });
  async function capture() {
    const output = new PassThrough(); const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    await captureRemoteObjects(client, source, [ref], output);
    return Buffer.concat(chunks);
  }
  try {
    expect(await verifyArchive(Readable.from([await capture()]), [ref], source)).toMatchObject({ objectCount: 1, payloadBytes: original.length });
    expect(requests).toEqual([`GET /bucket/${ref.storageId}.meta.json`, `GET /bucket/${ref.storageId}`]);
    const beforeInvalid = requests.length;
    await expect(captureRemoteObjects(client, { ...source, endpointOrigin: `${source.endpointOrigin}/other` }, [ref], new PassThrough())).rejects.toThrow('remote-source-invalid');
    expect(requests).toHaveLength(beforeInvalid);
    temporaryFailures = 2;
    expect(await verifyArchive(Readable.from([await capture()]), [ref], source)).toMatchObject({ objectCount: 1 });
    expect(temporaryFailures).toBe(0);
    interruptedMarkers = 2;
    expect(await verifyArchive(Readable.from([await capture()]), [ref], source)).toMatchObject({ objectCount: 1 });
    expect(interruptedMarkers).toBe(0);
    body = Buffer.alloc(original.length);
    await expect(capture()).rejects.toThrow('remote-hash-mismatch');
    markerMissing = true;
    const countBeforeMissing = requests.length;
    await expect(capture()).rejects.toThrow('remote-missing');
    expect(requests.length - countBeforeMissing).toBe(1);
  } finally { client.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

// Every destination reference is checked before any PUT. Existing objects are
// never overwritten, and race-safe conditional writes carry the payload hash.
test('S3 reconciliation is additive and checks every target before writing', async () => {
  const { reconcileReferences, checkRemoteReferences } = await import('../../../scripts/docker/remote-objects.mjs');
  const objects = new Map<string, Buffer>();
  let corruptAfterPut = false, temporaryPutFailures = 0, interruptedMarkers = 0;
  const requests: Array<{ method: string; key: string; conditional?: string; checksum?: string }> = [];
  const server = createServer(async (request, response) => {
    const key = decodeURIComponent(request.url!.split('?')[0]!).replace(/^\/bucket\//, '');
    requests.push({ method: request.method!, key, conditional: request.headers['if-none-match'], checksum: request.headers['x-amz-checksum-sha256'] as string | undefined });
    if (request.method === 'GET') {
      const found = objects.get(key);
      if (!found) { response.writeHead(404, { 'content-type': 'application/xml' }); response.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
      if (key.endsWith('.meta.json') && interruptedMarkers > 0) {
        interruptedMarkers--;
        response.writeHead(200, { 'content-length': found.length, connection: 'close' }); response.write(found.subarray(0, 8));
        setTimeout(() => response.destroy(), 10); return;
      }
      response.writeHead(200, { 'content-length': found.length }); response.end(found); return;
    }
    if (request.method !== 'PUT' || request.headers['if-none-match'] !== '*') { response.writeHead(400); response.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (temporaryPutFailures > 0) { temporaryPutFailures--; response.writeHead(503, { 'content-type': 'application/xml' }); response.end('<Error><Code>ServiceUnavailable</Code></Error>'); return; }
    if (objects.has(key)) { response.writeHead(412, { 'content-type': 'application/xml' }); response.end('<Error><Code>PreconditionFailed</Code></Error>'); return; }
    const content = Buffer.concat(chunks);
    if (request.headers['x-amz-checksum-sha256'] && createHash('sha256').update(content).digest('base64') !== request.headers['x-amz-checksum-sha256']) { response.writeHead(400); response.end(); return; }
    objects.set(key, corruptAfterPut && !key.endsWith('.meta.json') ? Buffer.alloc(content.length) : content); response.writeHead(200); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen');
  const source = { endpointOrigin: `http://127.0.0.1:${address.port}`, bucket: 'bucket', keyPrefix: 'prefix/' };
  const client = new S3Client({ endpoint: source.endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture-secret' }, maxAttempts: 1 });
  const entries = ['one', 'two'].map(value => {
    const bytes = Buffer.from(value), hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const ref = { workspaceId: 'workspace', hash, storageId: `prefix/workspace/${hash}`, sizeBytes: bytes.length };
    const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
    return { ref, readMarker: async () => marker, openPayload: () => Readable.from([bytes]) };
  });
  try {
    expect(await reconcileReferences(client, source, entries)).toMatchObject({ uploaded: 2, markersCreated: 2 });
    const puts = requests.filter(entry => entry.method === 'PUT');
    expect(puts).toHaveLength(4);
    expect(puts.every(entry => entry.conditional === '*')).toBe(true);
    expect(puts.filter(entry => !entry.key.endsWith('.meta.json')).every(entry => Boolean(entry.checksum))).toBe(true);
    interruptedMarkers = 2;
    expect(await reconcileReferences(client, source, entries)).toMatchObject({ uploaded: 0, markersCreated: 0 });
    expect(interruptedMarkers).toBe(0);
    expect(await checkRemoteReferences(client, source, entries.map(entry => entry.ref))).toEqual({ checked: 2, missing: [], mismatched: [] });
    objects.delete(entries[0]!.ref.storageId);
    objects.set(entries[1]!.ref.storageId, Buffer.from('bad'));
    requests.length = 0;
    expect(await checkRemoteReferences(client, source, entries.map(entry => entry.ref))).toEqual({ checked: 2, missing: [entries[0]!.ref.storageId], mismatched: [entries[1]!.ref.storageId] });
    expect(requests.some(entry => entry.method === 'PUT')).toBe(false);
    requests.length = 0;
    await expect(reconcileReferences(client, source, entries)).rejects.toThrow('remote-target-conflict');
    expect(requests.some(entry => entry.method === 'PUT')).toBe(false);
    expect(objects.has(entries[0]!.ref.storageId)).toBe(false);
    objects.clear(); corruptAfterPut = true;
    await expect(reconcileReferences(client, source, entries)).rejects.toThrow('remote-target-conflict');
    expect(objects.has(`${entries[0]!.ref.storageId}.meta.json`)).toBe(false);
    objects.clear(); corruptAfterPut = false; requests.length = 0;
    const originalMarker = await entries[0]!.readMarker(); let reads = 0;
    const changedMarker = { ...entries[0]!, readMarker: async () => ++reads === 1 ? originalMarker : Buffer.from(originalMarker.toString().replace('text/plain', 'text/html')) };
    await expect(reconcileReferences(client, source, [changedMarker])).rejects.toThrow('remote-inventory-mismatch');
    expect(requests.some(entry => entry.method === 'PUT')).toBe(false);
    objects.clear(); corruptAfterPut = false; temporaryPutFailures = 2;
    expect(await reconcileReferences(client, source, entries)).toMatchObject({ uploaded: 2, markersCreated: 2 });
    expect(temporaryPutFailures).toBe(0);
  } finally { client.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

// Node is the image runtime. A partially read payload must be discarded and
// retried, without PUTting over an object that already exists.
test('S3 reconciliation retries an interrupted payload in Node', async () => {
  const moduleUrl = new URL('../../../scripts/docker/remote-objects.mjs', import.meta.url).href;
  const script = `
    import { createServer } from 'node:http';
    import { createHash } from 'node:crypto';
    import { Readable } from 'node:stream';
    import { S3Client } from '@aws-sdk/client-s3';
    import { reconcileReferences } from ${JSON.stringify(moduleUrl)};
    const payload = Buffer.from('payload body');
    const hash = 'sha256:' + createHash('sha256').update(payload).digest('hex');
    const ref = { workspaceId: 'workspace', hash, storageId: 'prefix/workspace/' + hash, sizeBytes: payload.length };
    const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
    let interrupted = 0, puts = 0;
    const server = createServer((req, res) => {
      if (req.method !== 'GET') { puts++; res.writeHead(500).end(); return; }
      const isMarker = decodeURIComponent(req.url.split('?')[0]).endsWith('.meta.json');
      const data = isMarker ? marker : payload;
      if (!isMarker && interrupted < 2) {
        interrupted++;
        res.writeHead(200, { 'content-length': data.length, connection: 'close' });
        res.write(data.subarray(0, 2), () => res.destroy());
      } else { res.writeHead(200, { 'content-length': data.length }); res.end(data); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpointOrigin = 'http://127.0.0.1:' + server.address().port;
    const client = new S3Client({ endpoint: endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture-secret' }, maxAttempts: 1 });
    try {
      const result = await reconcileReferences(client, { endpointOrigin, bucket: 'bucket', keyPrefix: 'prefix/' }, [{ ref, readMarker: async () => marker, openPayload: () => Readable.from([payload]) }]);
      if (interrupted !== 2 || puts !== 0 || result.uploaded !== 0 || result.markersCreated !== 0) throw new Error('unexpected reconciliation result');
    } finally { client.destroy(); await new Promise(resolve => server.close(resolve)); }
  `;
  const child = Bun.spawn(['node', '--input-type=module', '-e', script], { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
});

// Capture writes its archive as a stream. A range retry must resume after the
// exact bytes already written, and the completed archive must still verify.
test('S3 capture resumes an interrupted payload in Node', async () => {
  const transferUrl = new URL('../../../scripts/docker/remote-objects.mjs', import.meta.url).href;
  const archiveUrl = new URL('../../../scripts/docker/remote-archive.mjs', import.meta.url).href;
  const script = `
    import { createServer } from 'node:http';
    import { createHash } from 'node:crypto';
    import { PassThrough, Readable } from 'node:stream';
    import { S3Client } from '@aws-sdk/client-s3';
    import { captureRemoteObjects } from ${JSON.stringify(transferUrl)};
    import { verifyArchive } from ${JSON.stringify(archiveUrl)};
    const payload = Buffer.from('payload data that survives interruption');
    const hash = 'sha256:' + createHash('sha256').update(payload).digest('hex');
    const ref = { workspaceId: 'workspace', hash, storageId: 'prefix/workspace/' + hash, sizeBytes: payload.length };
    const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
    let payloadRequests = 0, rangeSeen = '', ignoreRange = false;
    const server = createServer((req, res) => {
      if (decodeURIComponent(req.url.split('?')[0]).endsWith('.meta.json')) { res.writeHead(200, { 'content-length': marker.length }); res.end(marker); return; }
      payloadRequests++;
      if (payloadRequests === 1) {
        res.writeHead(200, { 'content-length': payload.length, connection: 'close' });
        res.write(payload.subarray(0, 7), () => res.destroy()); return;
      }
      rangeSeen = req.headers.range || '';
      if (ignoreRange) { res.writeHead(200, { 'content-length': payload.length }); res.end(payload); return; }
      const start = Number(/^bytes=(\\d+)-$/.exec(rangeSeen)?.[1]);
      if (!Number.isSafeInteger(start) || start <= 0 || start >= payload.length) { res.writeHead(400).end(); return; }
      res.writeHead(206, { 'content-length': payload.length - start, 'content-range': 'bytes ' + start + '-' + (payload.length - 1) + '/' + payload.length });
      res.end(payload.subarray(start));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpointOrigin = 'http://127.0.0.1:' + server.address().port;
    const client = new S3Client({ endpoint: endpointOrigin, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture-secret' }, maxAttempts: 1 });
    try {
      const source = { endpointOrigin, bucket: 'bucket', keyPrefix: 'prefix/' };
      const output = new PassThrough(), chunks = [];
      output.on('data', chunk => chunks.push(chunk));
      await captureRemoteObjects(client, source, [ref], output);
      await verifyArchive(Readable.from([Buffer.concat(chunks)]), [ref], source);
      if (payloadRequests !== 2 || rangeSeen !== 'bytes=7-') throw new Error('invalid range retry');
      payloadRequests = 0; ignoreRange = true;
      const invalid = new PassThrough(); invalid.resume();
      try { await captureRemoteObjects(client, source, [ref], invalid); throw new Error('accepted ignored range'); }
      catch (error) { if (error.message !== 'remote-range-mismatch') throw error; }
    } finally { client.destroy(); await new Promise(resolve => server.close(resolve)); }
  `;
  const child = Bun.spawn(['node', '--input-type=module', '-e', script], { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
});

// Exercise the image-side command boundary with a real SQLite snapshot, Node,
// the SDK and a loopback object store. The profile is a synthetic fixture.
test('filesystem image profile does not include an S3 helper bundle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'or3-no-s3-bundle-')); dirs.push(dir);
  const child = Bun.spawn(['node', join(import.meta.dir, '../../../scripts/docker/prepare-remote-helper.mjs'), dir], { env: { ...process.env, OR3_DOCKER_PROFILE: 'basic-sqlite-fs' }, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, stderr).toBe(0);
  expect(existsSync(join(dir, 'remote-objects.mjs'))).toBe(false);
});

test('S3 capture command reads qualified references and fails closed on configuration', async () => {
  const { db, path, put } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'or3-s3-command-')); dirs.push(dir);
  copyFileSync(join(import.meta.dir, '../../../scripts/docker/backup-inspect.mjs'), join(dir, 'backup-inspect.mjs'));
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(join(import.meta.dir, '../../../node_modules/better-sqlite3'), join(dir, 'node_modules/better-sqlite3'), 'dir');
  const builder = Bun.spawn(['node', join(import.meta.dir, '../../../scripts/docker/prepare-remote-helper.mjs'), dir], { env: { ...process.env, OR3_DOCKER_PROFILE: 'clerk-sqlite-s3' }, stdout: 'pipe', stderr: 'pipe' });
  const [buildExit, buildError] = await Promise.all([builder.exited, new Response(builder.stderr).text()]);
  expect(buildExit, buildError).toBe(0);
  writeFileSync(join(dir, 'backup-inspection-profile.json'), JSON.stringify({ contract: 2, sqlite: '0.0.28', s3: '0.0.15' }));
  const payload = Buffer.from('capture command fixture');
  const hash = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const ref = { workspaceId: 'workspace', hash, storageId: `prefix/workspace/${hash}`, sizeBytes: payload.length };
  const marker = Buffer.from(JSON.stringify({ workspace_id: ref.workspaceId, hash, storage_id: ref.storageId, size_bytes: ref.sizeBytes, mime_type: 'text/plain' }));
  put(ref.workspaceId, hash, { size_bytes: ref.sizeBytes, storage_id: ref.storageId }); db.close();
  let objectMissing = false;
  let targetObjects: Map<string, Buffer> | undefined;
  let targetReads = 0, targetWrites = 0;
  const server = createServer(async (request, response) => {
    if (targetObjects) {
      const key = decodeURIComponent(request.url!.split('?')[0]!).replace(/^\/recovery\//, '');
      if (request.method === 'GET') {
        targetReads++;
        const found = targetObjects.get(key);
        if (!found) { response.writeHead(404, { 'content-type': 'application/xml' }); response.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
        response.writeHead(200, { 'content-length': found.length }); response.end(found); return;
      }
      if (request.method !== 'PUT' || request.headers['if-none-match'] !== '*') { response.writeHead(400); response.end(); return; }
      targetWrites++;
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      targetObjects.set(key, Buffer.concat(chunks)); response.writeHead(200); response.end(); return;
    }
    if (objectMissing && !decodeURIComponent(request.url!.split('?')[0]!).endsWith('.meta.json')) { response.writeHead(404, { 'content-type': 'application/xml' }); response.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
    const bytes = decodeURIComponent(request.url!.split('?')[0]!).endsWith('.meta.json') ? marker : payload;
    response.writeHead(200, { 'content-length': bytes.length }); response.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen');
  const endpointOrigin = `http://127.0.0.1:${address.port}`;
  const environment = { ...process.env, OR3_STORAGE_S3_ENDPOINT: endpointOrigin, OR3_STORAGE_S3_REGION: 'us-east-1', OR3_STORAGE_S3_BUCKET: 'bucket', OR3_STORAGE_S3_KEY_PREFIX: '/prefix/', OR3_STORAGE_S3_ACCESS_KEY_ID: 'fixture', OR3_STORAGE_S3_SECRET_ACCESS_KEY: 'fixture-secret', OR3_STORAGE_S3_FORCE_PATH_STYLE: 'true', OR3_STORAGE_S3_ALLOW_INSECURE_HTTP: 'true' };
  const run = async (env: NodeJS.ProcessEnv) => {
    const child = Bun.spawn(['node', join(dir, 'remote-objects.mjs'), 'capture', path], { env, stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text()]);
    return { exitCode, bytes: Buffer.from(stdout), stderr };
  };
  const offline = async (operation: string, input = Buffer.alloc(0), credentials = false) => {
    const child = Bun.spawn(['node', join(dir, 'remote-objects.mjs'), operation, path], { env: credentials ? environment : { ...environment, OR3_STORAGE_S3_ACCESS_KEY_ID: '', OR3_STORAGE_S3_SECRET_ACCESS_KEY: '' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(input); child.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  };
  try {
    const { verifyArchive } = await import('../../../scripts/docker/remote-archive.mjs');
    const result = await run(environment);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('fixture-secret');
    expect(await verifyArchive(Readable.from([result.bytes]), [ref], { endpointOrigin, bucket: 'bucket', keyPrefix: 'prefix/' })).toMatchObject({ objectCount: 1 });
    const verified = await offline('verify', result.bytes);
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ contract: 2, objectCount: 1, payloadBytes: payload.length });
    const corrupted = Buffer.from(result.bytes); corrupted[512] = corrupted[512]! ^ 1;
    expect((await offline('verify', corrupted)).exitCode).not.toBe(0);
    const inventory = await offline('inventory');
    expect(inventory.exitCode).toBe(0);
    expect(JSON.parse(inventory.stdout).entries).toEqual([ref]);
    const inventoryVerified = await offline('verify-inventory', Buffer.from(inventory.stdout));
    expect(inventoryVerified.exitCode).toBe(0);
    expect(JSON.parse(inventoryVerified.stdout)).toMatchObject({ kind: 's3-reference-v1', objectCount: 1 });
    expect((await offline('verify-inventory', Buffer.from('{"version":1}'))).exitCode).not.toBe(0);
    const checked = await offline('check', Buffer.from(inventory.stdout), true);
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout)).toEqual({ checked: 1, missing: [], mismatched: [] });
    objectMissing = true;
    const missing = await offline('check', Buffer.from(inventory.stdout), true);
    expect(JSON.parse(missing.stdout)).toEqual({ checked: 1, missing: [ref.storageId], mismatched: [] });
    objectMissing = false;
    const archivePath = join(dir, 'remote-objects.tar');
    const reconcile = async (expectedHash = createHash('sha256').update(result.bytes).digest('hex')) => {
      const env = { ...environment, OR3_STORAGE_S3_BUCKET: 'recovery', OR3_BACKUP_S3_ENDPOINT_ORIGIN: endpointOrigin, OR3_BACKUP_S3_BUCKET: 'bucket', OR3_BACKUP_S3_KEY_PREFIX: 'prefix/', OR3_BACKUP_ARCHIVE_SHA256: expectedHash };
      const child = Bun.spawn(['node', join(dir, 'remote-objects.mjs'), 'reconcile', path, archivePath], { env, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { exitCode, stdout, stderr };
    };
    targetObjects = new Map(); writeFileSync(archivePath, corrupted);
    expect((await reconcile()).exitCode).not.toBe(0);
    expect(targetObjects.size).toBe(0);
    writeFileSync(archivePath, result.bytes);
    expect((await reconcile('0'.repeat(64))).exitCode).not.toBe(0);
    expect(targetObjects.size).toBe(0);
    const restored = await reconcile();
    expect(restored.exitCode, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({ uploaded: 1, markersCreated: 1 });
    expect(targetObjects.get(ref.storageId)).toEqual(payload);
    expect(targetObjects.get(`${ref.storageId}.meta.json`)).toEqual(marker);
    const writesBeforeChecks = targetWrites;
    // Post-restore verification must read the authenticated archive and the
    // target only; missing payloads and conflicting marker MIME are failures.
    const checkCopy = async (expectedHash = createHash('sha256').update(result.bytes).digest('hex')) => {
      const env = { ...environment, OR3_STORAGE_S3_BUCKET: 'recovery', OR3_BACKUP_S3_ENDPOINT_ORIGIN: endpointOrigin, OR3_BACKUP_S3_BUCKET: 'bucket', OR3_BACKUP_S3_KEY_PREFIX: 'prefix/', OR3_BACKUP_ARCHIVE_SHA256: expectedHash };
      const child = Bun.spawn(['node', join(dir, 'remote-objects.mjs'), 'check-copy', path, archivePath], { env, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { exitCode, stdout, stderr };
    };
    const healthyCopy = await checkCopy();
    expect(healthyCopy.exitCode, healthyCopy.stderr).toBe(0);
    expect(JSON.parse(healthyCopy.stdout)).toEqual({ checked: 1, missing: [], mismatched: [] });
    targetObjects.delete(ref.storageId);
    expect(JSON.parse((await checkCopy()).stdout)).toEqual({ checked: 1, missing: [ref.storageId], mismatched: [] });
    targetObjects.set(ref.storageId, payload);
    targetObjects.set(`${ref.storageId}.meta.json`, Buffer.from(JSON.stringify({ ...JSON.parse(marker.toString()), mime_type: 'image/png' })));
    expect(JSON.parse((await checkCopy()).stdout)).toEqual({ checked: 1, missing: [], mismatched: [ref.storageId] });
    const readsBeforeInvalidArchive = targetReads;
    expect((await checkCopy('0'.repeat(64))).exitCode).not.toBe(0);
    expect(targetReads).toBe(readsBeforeInvalidArchive);
    expect(targetWrites).toBe(writesBeforeChecks);
    targetObjects = undefined;
    const refused = await run({ ...environment, OR3_STORAGE_S3_ENDPOINT: `${endpointOrigin}/different-path` });
    expect(refused.exitCode).not.toBe(0);
    expect(refused.bytes.length).toBe(0);
    expect(refused.stderr).not.toContain('fixture-secret');
    writeFileSync(join(dir, 'backup-inspection-profile.json'), JSON.stringify({ contract: 0, sqlite: '0.0.28', s3: '0.0.15' }));
    expect((await run(environment)).exitCode).not.toBe(0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

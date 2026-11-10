import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { assertRemoteSource, createArchiveWriter, validateMarker, verifyArchive, verifyReferenceInventory, withVerifiedArchive } from './remote-archive.mjs';
import { assertS3InspectionProfile, iterateS3References } from './backup-inspect.mjs';

const MAX_MARKER = 64 * 1024;
const errorCode = error => error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey' || error?.name === 'NotFound'
  ? 'remote-missing' : error?.$metadata?.httpStatusCode === 403 ? 'remote-forbidden' : 'remote-transfer-failed';
const retryable = error => {
  const status = error?.$metadata?.httpStatusCode;
  return status === 429 || status >= 500 || !status && (['AbortError', 'TimeoutError', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'SocketError'].some(value => error?.name === value || error?.code === value) || error?.cause && error.cause !== error && retryable(error.cause));
};
const backoff = attempt => new Promise(resolve => setTimeout(resolve, Math.random() * Math.min(8000, 200 * 2 ** attempt)));

async function getOnce(client, bucket, key, range) {
  const controller = new AbortController();
  let timeout;
  const reset = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 60_000); };
  reset();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-` } : {}) }), { abortSignal: controller.signal });
    if (!result.Body || typeof result.Body[Symbol.asyncIterator] !== 'function') throw new Error('remote-transfer-failed');
    if (range && (result.ContentRange !== `bytes ${range.start}-${range.total - 1}/${range.total}` || result.ContentLength !== range.total - range.start)) {
      result.Body.destroy?.();
      throw new Error('remote-range-mismatch');
    }
    async function* body() {
      try { for await (const chunk of result.Body) { reset(); yield Buffer.from(chunk); } }
      finally { clearTimeout(timeout); }
    }
    return body();
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// Resume only from a verified range boundary after a transient transport
// failure. The archive writer hashes the complete concatenated byte stream.
async function* getPayload(client, bucket, ref) {
  let offset = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const stream = await getOnce(client, bucket, ref.storageId, offset ? { start: offset, total: ref.sizeBytes } : undefined);
      for await (const chunk of stream) {
        offset += chunk.length;
        if (offset > ref.sizeBytes) throw new Error('remote-size-mismatch');
        yield chunk;
      }
      if (offset !== ref.sizeBytes) throw new Error('remote-size-mismatch');
      return;
    } catch (error) {
      if (error?.message === 'remote-range-mismatch' || error?.message === 'remote-size-mismatch') throw error;
      if (!retryable(error) || attempt >= 3 || offset >= ref.sizeBytes && offset !== 0) throw new Error(errorCode(error));
      await backoff(attempt);
    }
  }
}

// A marker is bounded, so a failed partial response can be discarded and
// downloaded again without committing any bytes to the output archive.
async function getMarker(client, bucket, key) {
  for (let attempt = 0; ; attempt++) {
    try {
      const stream = await getOnce(client, bucket, key);
      const parts = []; let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > MAX_MARKER) throw new Error('remote-marker-invalid');
        parts.push(chunk);
      }
      return Buffer.concat(parts, bytes);
    } catch (error) {
      if (error?.message === 'remote-marker-invalid') throw error;
      if (!retryable(error) || attempt >= 3) throw new Error(errorCode(error));
      await backoff(attempt);
    }
  }
}

async function put(client, input) {
  const controller = new AbortController();
  let timeout;
  const reset = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 60_000); };
  reset();
  const original = input.Body;
  if (!Buffer.isBuffer(original) && original && typeof original[Symbol.asyncIterator] === 'function') {
    input.Body = Readable.from((async function* () { for await (const chunk of original) { reset(); yield chunk; } })());
  }
  try { await client.send(new PutObjectCommand(input), { abortSignal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

/** Capture only the exact canonical references; the caller verifies and authenticates the result. */
export async function captureRemoteObjects(client, source, references, output) {
  assertRemoteSource(source);
  const writer = createArchiveWriter(output);
  const entries = [];
  let payloadBytes = 0;
  for (const ref of references) {
    if (entries.length >= 100_000 || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.workspaceId) ||
        !/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/.test(ref.hash) ||
        !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0 || ref.sizeBytes > 2 ** 30 ||
        ref.storageId !== `${source.keyPrefix}${ref.workspaceId}/${ref.hash}`) throw new Error('remote-inventory-mismatch');
    const marker = await getMarker(client, source.bucket, `${ref.storageId}.meta.json`);
    const { mimeType } = validateMarker(marker, ref);
    const payload = getPayload(client, source.bucket, ref);
    const name = `${ref.workspaceId}/${ref.hash.replace(':', '_')}`;
    let hashes;
    try { hashes = await writer.addFile(`objects/${name}`, ref.sizeBytes, payload); }
    catch (error) { throw new Error(['remote-size-mismatch', 'remote-range-mismatch', 'remote-missing', 'remote-forbidden'].includes(error?.message) ? error.message : 'remote-transfer-failed'); }
    if (hashes[ref.hash.split(':')[0]] !== ref.hash.split(':')[1]) throw new Error('remote-hash-mismatch');
    await writer.addFile(`markers/${name}.meta.json`, marker.length, [marker]);
    entries.push({ ...ref, mimeType, markerSha256: createHash('sha256').update(marker).digest('hex'), markerBytes: marker.length });
    payloadBytes += ref.sizeBytes;
  }
  const inventorySha256 = await writer.finish({ version: 1, source, entries });
  return { contract: 2, kind: 's3-copy-v1', objectCount: entries.length, payloadBytes, inventorySha256 };
}

async function targetPayloadPresent(client, source, ref) {
  for (let attempt = 0; ; attempt++) {
    try {
      const stream = await getOnce(client, source.bucket, ref.storageId);
      const hash = createHash(ref.hash.split(':')[0]);
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > ref.sizeBytes) throw new Error('remote-target-conflict');
        hash.update(chunk);
      }
      if (bytes !== ref.sizeBytes || hash.digest('hex') !== ref.hash.split(':')[1]) throw new Error('remote-target-conflict');
      return true;
    } catch (error) {
      if (errorCode(error) === 'remote-missing') return false;
      if (error?.message === 'remote-target-conflict') throw error;
      if (!retryable(error) || attempt >= 3) throw new Error(errorCode(error));
      await backoff(attempt);
    }
  }
}

async function targetMarkerPresent(client, source, ref, mimeType) {
  try {
    const marker = await getMarker(client, source.bucket, `${ref.storageId}.meta.json`);
    if (validateMarker(marker, ref).mimeType !== mimeType && mimeType !== undefined) throw new Error('remote-target-conflict');
  } catch (error) {
    if (error.message === 'remote-missing') return false;
    if (error.message === 'remote-marker-invalid' || error.message === 'remote-target-conflict') throw new Error('remote-target-conflict');
    throw error;
  }
  return true;
}

// A reference-only snapshot cannot recreate objects. Check both object bytes
// and markers without changing the bucket before it is used for rollback.
export async function checkRemoteReferences(client, source, references, expectedMimeTypes) {
  assertRemoteSource(source);
  const seen = new Set(), missing = [], mismatched = [];
  let checked = 0;
  for (const ref of references) {
    if (checked >= 100_000 || !ref || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.workspaceId) || !/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/.test(ref.hash) ||
        !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0 || ref.sizeBytes > 2 ** 30 ||
        ref.storageId !== `${source.keyPrefix}${ref.workspaceId}/${ref.hash}` || seen.has(ref.storageId)) throw new Error('remote-inventory-mismatch');
    seen.add(ref.storageId); checked++;
    try {
      const payload = await targetPayloadPresent(client, source, ref);
      const marker = await targetMarkerPresent(client, source, ref, expectedMimeTypes?.get(ref.storageId));
      if (!payload || !marker) missing.push(ref.storageId);
    } catch (error) {
      if (error?.message !== 'remote-target-conflict') throw error;
      mismatched.push(ref.storageId);
    }
  }
  return { checked, missing, mismatched };
}

// Call only after verifying the complete archive offline. openPayload must open
// the corresponding bytes from that verified archive on every invocation.
// All existing target objects are checked before the first additive write.
export async function reconcileReferences(client, source, entries) {
  assertRemoteSource(source);
  if (!Array.isArray(entries) || entries.length > 100_000) throw new Error('remote-limit-exceeded');
  const prepared = [], seen = new Set();
  for (const entry of entries) {
    const ref = entry?.ref;
    if (!ref || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.workspaceId) || !/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/.test(ref.hash) ||
        !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0 || ref.sizeBytes > 2 ** 30 ||
        ref.storageId !== `${source.keyPrefix}${ref.workspaceId}/${ref.hash}` || seen.has(ref.storageId) || typeof entry.openPayload !== 'function' || typeof entry.readMarker !== 'function') throw new Error('remote-inventory-mismatch');
    const marker = Buffer.from(await entry.readMarker());
    const { mimeType } = validateMarker(marker, ref);
    seen.add(ref.storageId);
    const payloadPresent = await targetPayloadPresent(client, source, ref);
    const markerPresent = await targetMarkerPresent(client, source, ref, mimeType);
    prepared.push({ ...entry, markerSha256: createHash('sha256').update(marker).digest('hex'), mimeType, payloadPresent, markerPresent });
  }
  let uploaded = 0, markersCreated = 0;
  for (const entry of prepared) {
    const { ref, mimeType } = entry;
    let marker;
    if (!entry.markerPresent) {
      marker = Buffer.from(await entry.readMarker());
      if (createHash('sha256').update(marker).digest('hex') !== entry.markerSha256) throw new Error('remote-inventory-mismatch');
    }
    if (!entry.payloadPresent) {
      let complete = false;
      for (let attempt = 0; !complete && attempt < 4; attempt++) {
        try {
          const algorithm = ref.hash.split(':')[0], checksum = Buffer.from(ref.hash.split(':')[1], 'hex').toString('base64');
          await put(client, {
            Bucket: source.bucket, Key: ref.storageId, Body: entry.openPayload(), ContentLength: ref.sizeBytes,
            IfNoneMatch: '*', ContentType: mimeType, Metadata: { 'or3-hash': ref.hash, 'or3-workspace': ref.workspaceId },
            ...(algorithm === 'sha256' ? { ChecksumSHA256: checksum } : { ContentMD5: checksum }),
          });
          if (!await targetPayloadPresent(client, source, ref)) throw new Error('remote-target-conflict');
          uploaded++; complete = true;
        } catch (error) {
          const status = error?.$metadata?.httpStatusCode;
          if (['remote-target-conflict', 'remote-forbidden', 'remote-transfer-failed'].includes(error?.message)) throw error;
          if (status !== 409 && status !== 412 && !retryable(error)) throw new Error(errorCode(error));
          if (await targetPayloadPresent(client, source, ref)) complete = true;
          else if (attempt === 3) throw new Error(status === 409 || status === 412 ? 'remote-target-conflict' : errorCode(error));
          else await backoff(attempt);
        }
      }
    }
    if (!entry.markerPresent) {
      let complete = false;
      for (let attempt = 0; !complete && attempt < 4; attempt++) {
        try {
          await put(client, { Bucket: source.bucket, Key: `${ref.storageId}.meta.json`, Body: marker, ContentLength: marker.length, ContentType: 'application/json', IfNoneMatch: '*' });
          if (!await targetMarkerPresent(client, source, ref, mimeType)) throw new Error('remote-target-conflict');
          markersCreated++; complete = true;
        } catch (error) {
          const status = error?.$metadata?.httpStatusCode;
          if (['remote-target-conflict', 'remote-forbidden', 'remote-transfer-failed'].includes(error?.message)) throw error;
          if (status !== 409 && status !== 412 && !retryable(error)) throw new Error(errorCode(error));
          if (await targetMarkerPresent(client, source, ref, mimeType)) complete = true;
          else if (attempt === 3) throw new Error(status === 409 || status === 412 ? 'remote-target-conflict' : errorCode(error));
          else await backoff(attempt);
        }
      }
    }
  }
  return { uploaded, markersCreated };
}

// Image helper entry point. Credentials are read only from its environment;
// the archive is streamed to stdout and diagnostics never include config.
async function runHelperCommand(operation, databasePath, archivePath) {
  assertS3InspectionProfile(JSON.parse(readFileSync(new URL('./backup-inspection-profile.json', import.meta.url), 'utf8')));
  const value = name => (process.env[`OR3_STORAGE_S3_${name}`] ?? '').trim();
  const endpointText = value('ENDPOINT'), region = value('REGION'), bucket = value('BUCKET');
  if (!databasePath || !endpointText || !bucket) throw new Error('remote-config-invalid');
  let endpoint;
  try { endpoint = new URL(endpointText); } catch { throw new Error('remote-config-invalid'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.protocol === 'http:' && value('ALLOW_INSECURE_HTTP') !== 'true') throw new Error('remote-config-invalid');
  const prefix = value('KEY_PREFIX').replace(/^\/+/, '').replace(/\/+$/, '');
  const source = { endpointOrigin: endpoint.origin, bucket, keyPrefix: prefix ? `${prefix}/` : '' };
  assertRemoteSource(source);
  const require = createRequire(import.meta.url);
  const imageDatabase = '/app/.output/server/node_modules/better-sqlite3';
  const Database = require(existsSync(imageDatabase) ? imageDatabase : 'better-sqlite3');
  if (operation === 'inventory') {
    const inventory = JSON.stringify({ version: 1, source, entries: [...iterateS3References(Database, databasePath, source)] });
    if (Buffer.byteLength(inventory) > 64 * 1024 * 1024) throw new Error('remote-limit-exceeded');
    process.stdout.write(inventory);
    return;
  }
  let checkReferences;
  if (operation === 'verify-inventory' || operation === 'check') {
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) throw new Error('remote-limit-exceeded');
      chunks.push(chunk);
    }
    const inventory = Buffer.concat(chunks, bytes).toString('utf8');
    const summary = await verifyReferenceInventory(inventory, iterateS3References(Database, databasePath, source), source);
    if (operation === 'verify-inventory') {
      console.log(JSON.stringify(summary));
      return;
    }
    checkReferences = JSON.parse(inventory).entries;
  }
  if (operation === 'verify') {
    const summary = await verifyArchive(process.stdin, iterateS3References(Database, databasePath, source), source);
    console.log(JSON.stringify(summary));
    return;
  }
  const accessKeyId = value('ACCESS_KEY_ID'), secretAccessKey = value('SECRET_ACCESS_KEY'), sessionToken = value('SESSION_TOKEN');
  if (!region || !accessKeyId || !secretAccessKey) throw new Error('remote-config-invalid');
  const client = new S3Client({ endpoint: source.endpointOrigin, region, forcePathStyle: value('FORCE_PATH_STYLE') === 'true', credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }, maxAttempts: 1 });
  try {
    if (operation === 'check') console.log(JSON.stringify(await checkRemoteReferences(client, source, checkReferences)));
    else if (operation === 'reconcile' || operation === 'check-copy') {
      const backupSource = { endpointOrigin: process.env.OR3_BACKUP_S3_ENDPOINT_ORIGIN, bucket: process.env.OR3_BACKUP_S3_BUCKET, keyPrefix: process.env.OR3_BACKUP_S3_KEY_PREFIX };
      assertRemoteSource(backupSource);
      if (backupSource.keyPrefix !== source.keyPrefix || !archivePath) throw new Error('remote-inventory-mismatch');
      const result = await withVerifiedArchive(archivePath, iterateS3References(Database, databasePath, backupSource), backupSource, process.env.OR3_BACKUP_ARCHIVE_SHA256, async entries => {
        if (operation === 'reconcile') return reconcileReferences(client, source, entries);
        const expectedMimeTypes = new Map();
        for (const entry of entries) expectedMimeTypes.set(entry.ref.storageId, validateMarker(await entry.readMarker(), entry.ref).mimeType);
        return checkRemoteReferences(client, source, entries.map(entry => entry.ref), expectedMimeTypes);
      });
      console.log(JSON.stringify(result));
    }
    else await captureRemoteObjects(client, source, iterateS3References(Database, databasePath, source), process.stdout);
  }
  finally { client.destroy(); }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!['capture', 'verify', 'inventory', 'verify-inventory', 'check', 'reconcile', 'check-copy'].includes(process.argv[2]) || process.argv.length !== (['reconcile', 'check-copy'].includes(process.argv[2]) ? 5 : 4)) throw new Error('remote-command-unsupported');
    await runHelperCommand(process.argv[2], process.argv[3], process.argv[4]);
  } catch (error) {
    const code = /^remote-[a-z-]+$/.test(error?.message ?? '') ? error.message : 'remote-inspection-failed';
    console.error(code);
    process.exitCode = 1;
  }
}

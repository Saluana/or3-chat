import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';

const BLOCK = 512;
const MAX_MARKER = 64 * 1024;
const MAX_INVENTORY = 64 * 1024 * 1024;
const MAX_OBJECTS = 100_000;
const MAX_OBJECT = 2 ** 30;
const fail = (code) => { throw new Error(code); };
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const entryName = (ref, kind) => `${kind}/${ref.workspaceId}/${ref.hash.replace(':', '_')}${kind === 'markers' ? '.meta.json' : ''}`;

// Source identities are stored without credentials or endpoint paths. Refuse
// paths instead of silently collapsing two different services to one origin.
export function assertRemoteSource(source) {
  let endpoint;
  try { endpoint = new URL(source?.endpointOrigin); } catch { fail('remote-source-invalid'); }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.origin !== source.endpointOrigin ||
      typeof source.bucket !== 'string' || !source.bucket || source.bucket.length > 255 || /[\x00-\x20\x7f/\\]/.test(source.bucket) ||
      typeof source.keyPrefix !== 'string' || source.keyPrefix.length > 512 || /[\x00-\x1f\\]/.test(source.keyPrefix) ||
      source.keyPrefix && (source.keyPrefix.startsWith('/') || !source.keyPrefix.endsWith('/') || source.keyPrefix.slice(0, -1).split('/').some(part => !part || part === '.' || part === '..'))) fail('remote-source-invalid');
}

export function validateMarker(bytes, ref) {
  if (bytes.length > MAX_MARKER) fail('remote-marker-invalid');
  let marker;
  try { marker = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { fail('remote-marker-invalid'); }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || marker.workspace_id !== ref.workspaceId ||
      marker.hash !== ref.hash || marker.storage_id !== ref.storageId || marker.size_bytes !== ref.sizeBytes ||
      typeof marker.mime_type !== 'string' || !marker.mime_type || marker.mime_type.length > 1024 || /[\x00-\x1f\x7f]/.test(marker.mime_type)) fail('remote-marker-invalid');
  return { mimeType: marker.mime_type };
}

function writeField(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) fail('remote-limit-exceeded');
  bytes.copy(header, offset);
}
function octal(value, length) {
  const result = value.toString(8);
  if (!Number.isSafeInteger(value) || value < 0 || result.length >= length) fail('remote-limit-exceeded');
  return result.padStart(length - 1, '0') + '\0';
}
function makeHeader(name, size) {
  const header = Buffer.alloc(BLOCK);
  let leaf = name, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const split = name.lastIndexOf('/');
    if (split < 0) fail('remote-limit-exceeded');
    prefix = name.slice(0, split); leaf = name.slice(split + 1);
  }
  writeField(header, 0, 100, leaf);
  writeField(header, 100, 8, octal(0o600, 8));
  writeField(header, 108, 8, octal(0, 8));
  writeField(header, 116, 8, octal(0, 8));
  writeField(header, 124, 12, octal(size, 12));
  writeField(header, 136, 12, octal(0, 12));
  header.fill(32, 148, 156);
  header[156] = 48;
  writeField(header, 257, 6, 'ustar\0');
  writeField(header, 263, 2, '00');
  writeField(header, 345, 155, prefix);
  writeField(header, 148, 8, octal(header.reduce((sum, byte) => sum + byte, 0), 8));
  return header;
}

async function write(out, bytes) {
  if (!out.write(bytes)) await once(out, 'drain');
}

export function createArchiveWriter(out) {
  let finished = false;
  async function addFile(name, size, source) {
    if (finished || !Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT || !name || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) fail('remote-entry-unsupported');
    await write(out, makeHeader(name, size));
    const sha = createHash('sha256'), md5 = createHash('md5');
    let seen = 0;
    for await (const chunk of source) {
      const bytes = Buffer.from(chunk);
      seen += bytes.length;
      if (seen > size) fail('remote-size-mismatch');
      sha.update(bytes); md5.update(bytes); await write(out, bytes);
    }
    if (seen !== size) fail('remote-size-mismatch');
    if (size % BLOCK) await write(out, Buffer.alloc(BLOCK - size % BLOCK));
    return { sha256: sha.digest('hex'), md5: md5.digest('hex') };
  }
  return { addFile, async finish(inventory) {
    if (finished) fail('remote-entry-unsupported');
    const bytes = Buffer.from(JSON.stringify(inventory));
    if (bytes.length > MAX_INVENTORY) fail('remote-limit-exceeded');
    await addFile('inventory.json', bytes.length, [bytes]);
    finished = true;
    await write(out, Buffer.alloc(BLOCK * 2));
    out.end();
    return digest('sha256', bytes);
  } };
}

function reader(input) {
  const iterator = input[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  return { async read(size) {
    const parts = []; let left = size;
    while (left) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) fail('remote-entry-unsupported');
        pending = Buffer.from(next.value);
        if (!pending.length) continue;
      }
      const take = Math.min(left, pending.length);
      parts.push(pending.subarray(0, take)); pending = pending.subarray(take); left -= take;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, size);
  }, async end() {
    if (pending.some(byte => byte !== 0)) fail('remote-extra');
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      if (Buffer.from(next.value).some(byte => byte !== 0)) fail('remote-extra');
    }
  } };
}
function stringField(header, offset, length) {
  const value = header.subarray(offset, offset + length);
  const nul = value.indexOf(0);
  const used = nul < 0 ? value : value.subarray(0, nul);
  if (nul >= 0 && value.subarray(nul).some(byte => byte !== 0)) fail('remote-entry-unsupported');
  return used.toString('utf8');
}
function numberField(header, offset, length) {
  const value = stringField(header, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) fail('remote-entry-unsupported');
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result)) fail('remote-limit-exceeded');
  return result;
}
function parseHeader(header) {
  const expected = numberField(header, 148, 8);
  const copy = Buffer.from(header); copy.fill(32, 148, 156);
  if (copy.reduce((sum, byte) => sum + byte, 0) !== expected || header[156] !== 48 ||
      stringField(header, 257, 6) !== 'ustar' || stringField(header, 263, 2) !== '00') fail('remote-entry-unsupported');
  const leaf = stringField(header, 0, 100), prefix = stringField(header, 345, 155);
  const name = prefix ? `${prefix}/${leaf}` : leaf;
  if (!name || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\\]/.test(name)) fail('remote-entry-unsupported');
  return { name, size: numberField(header, 124, 12) };
}

function referenceMap(references, source) {
  assertRemoteSource(source);
  const map = new Map();
  for (const ref of references) {
    if (map.size >= MAX_OBJECTS || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.workspaceId) || !/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32})$/.test(ref.hash) || !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes < 0 || ref.sizeBytes > MAX_OBJECT) fail('remote-limit-exceeded');
    if (ref.storageId !== `${source.keyPrefix}${ref.workspaceId}/${ref.hash}`) fail('remote-inventory-mismatch');
    const key = `${ref.workspaceId}/${ref.hash}`;
    if (map.has(key)) fail('remote-duplicate');
    map.set(key, { ref });
  }
  return map;
}

function verifyInventory(inventory, map, source) {
  if (!inventory || inventory.version !== 1 || !inventory.source || inventory.source.endpointOrigin !== source.endpointOrigin || inventory.source.bucket !== source.bucket || inventory.source.keyPrefix !== source.keyPrefix || !Array.isArray(inventory.entries) || inventory.entries.length !== map.size) fail('remote-inventory-mismatch');
  const seen = new Set();
  for (const item of inventory.entries) {
    const key = `${item.workspaceId}/${item.hash}`, record = map.get(key);
    if (!record || seen.has(key) || item.storageId !== record.ref.storageId || item.sizeBytes !== record.ref.sizeBytes || item.mimeType !== record.mimeType || item.markerSha256 !== record.markerSha256 || item.markerBytes !== record.markerBytes) fail('remote-inventory-mismatch');
    seen.add(key);
  }
}

// Reference-only snapshots support same-bucket rollback checks; unlike a copy
// archive, they do not contain file bytes and are never a recovery point.
export async function verifyReferenceInventory(json, references, source) {
  if (typeof json !== 'string' || Buffer.byteLength(json) > MAX_INVENTORY) fail('remote-limit-exceeded');
  let inventory;
  try { inventory = JSON.parse(json); } catch { fail('remote-inventory-mismatch'); }
  const map = referenceMap(references, source);
  if (!inventory || inventory.version !== 1 || !inventory.source || inventory.source.endpointOrigin !== source.endpointOrigin || inventory.source.bucket !== source.bucket || inventory.source.keyPrefix !== source.keyPrefix || !Array.isArray(inventory.entries) || inventory.entries.length !== map.size) fail('remote-inventory-mismatch');
  const seen = new Set();
  let payloadBytes = 0;
  for (const item of inventory.entries) {
    if (!item || typeof item !== 'object') fail('remote-inventory-mismatch');
    const key = `${item.workspaceId}/${item.hash}`, record = map.get(key);
    if (!record || seen.has(key) || item.storageId !== record.ref.storageId || item.sizeBytes !== record.ref.sizeBytes) fail('remote-inventory-mismatch');
    seen.add(key); payloadBytes += item.sizeBytes;
  }
  return { contract: 2, kind: 's3-reference-v1', objectCount: map.size, payloadBytes, inventorySha256: digest('sha256', Buffer.from(json)) };
}

async function verifyArchiveDetails(input, references, source) {
  const map = referenceMap(references, source), expected = new Map();
  for (const record of map.values()) for (const kind of ['objects', 'markers']) expected.set(entryName(record.ref, kind), { record, kind });
  const stream = reader(input), seen = new Set();
  let inventoryBytes, payloadBytes = 0;
  for (;;) {
    const header = await stream.read(BLOCK);
    if (header.every(byte => byte === 0)) {
      if (!(await stream.read(BLOCK)).every(byte => byte === 0)) fail('remote-entry-unsupported');
      await stream.end(); break;
    }
    if (inventoryBytes) fail('remote-extra');
    const { name, size } = parseHeader(header);
    if (seen.has(name)) fail('remote-duplicate');
    seen.add(name);
    const item = expected.get(name);
    if (name !== 'inventory.json' && !item) fail('remote-extra');
    if (name === 'inventory.json' && size > MAX_INVENTORY || item?.kind === 'markers' && size > MAX_MARKER || item?.kind === 'objects' && size !== item.record.ref.sizeBytes) fail('remote-size-mismatch');
    const chunks = [], hash = item?.kind === 'objects' ? createHash(item.record.ref.hash.split(':')[0]) : undefined;
    for (let remaining = size; remaining > 0;) {
      const bytes = await stream.read(Math.min(remaining, 64 * 1024)); remaining -= bytes.length;
      if (hash) hash.update(bytes); else chunks.push(bytes);
    }
    if (size % BLOCK && !(await stream.read(BLOCK - size % BLOCK)).every(byte => byte === 0)) fail('remote-entry-unsupported');
    if (name === 'inventory.json') inventoryBytes = Buffer.concat(chunks, size);
    else if (item.kind === 'objects') {
      if (hash.digest('hex') !== item.record.ref.hash.split(':')[1]) fail('remote-hash-mismatch');
      item.record.object = true; payloadBytes += size;
    } else {
      const bytes = Buffer.concat(chunks, size);
      item.record.mimeType = validateMarker(bytes, item.record.ref).mimeType;
      item.record.markerSha256 = digest('sha256', bytes); item.record.markerBytes = size;
    }
  }
  if (!inventoryBytes || [...map.values()].some(item => !item.object || !item.markerSha256)) fail('remote-missing');
  let inventory;
  try { inventory = JSON.parse(inventoryBytes.toString('utf8')); } catch { fail('remote-inventory-mismatch'); }
  verifyInventory(inventory, map, source);
  return { summary: { contract: 2, kind: 's3-copy-v1', objectCount: map.size, payloadBytes, inventorySha256: digest('sha256', inventoryBytes) }, records: map };
}

export async function verifyArchive(input, references, source) {
  return (await verifyArchiveDetails(input, references, source)).summary;
}

// A restore needs repeatable, bounded reads for conditional PUT retries. Keep
// one descriptor open after complete offline verification; never extract paths
// from the archive and never retain all marker or payload bytes in memory.
export async function withVerifiedArchive(path, references, source, expectedSha256, use) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) fail('remote-inventory-mismatch');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let active = true;
  try {
    const original = await handle.stat({ bigint: true });
    if (!original.isFile() || original.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('remote-entry-unsupported');
    const assertUnchanged = async () => {
      if (!active) fail('remote-entry-unsupported');
      const current = await handle.stat({ bigint: true });
      if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino || current.size !== original.size || current.mtimeNs !== original.mtimeNs || current.ctimeNs !== original.ctimeNs) fail('remote-archive-changed');
    };
    const readAt = async (size, position) => {
      const result = Buffer.alloc(size); let used = 0;
      while (used < size) {
        const read = await handle.read(result, used, size - used, position + used);
        if (!read.bytesRead) fail('remote-entry-unsupported');
        used += read.bytesRead;
      }
      return result;
    };
    const archiveHash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) archiveHash.update(chunk);
    if (archiveHash.digest('hex') !== expectedSha256) fail('remote-archive-checksum-mismatch');
    await assertUnchanged();
    const { records } = await verifyArchiveDetails(handle.createReadStream({ start: 0, autoClose: false }), references, source);
    await assertUnchanged();
    const byName = new Map();
    for (const record of records.values()) for (const kind of ['objects', 'markers']) byName.set(entryName(record.ref, kind), { record, kind });
    let position = 0;
    for (;;) {
      const header = await readAt(BLOCK, position); position += BLOCK;
      if (header.every(byte => byte === 0)) break;
      const { name, size } = parseHeader(header);
      const item = byName.get(name);
      if (item?.kind === 'objects') {
        if (size !== item.record.ref.sizeBytes || item.record.payloadOffset !== undefined) fail('remote-archive-changed');
        item.record.payloadOffset = position;
      } else if (item?.kind === 'markers') {
        if (size !== item.record.markerBytes || item.record.markerOffset !== undefined) fail('remote-archive-changed');
        item.record.markerOffset = position;
      } else if (name !== 'inventory.json') fail('remote-archive-changed');
      position += Math.ceil(size / BLOCK) * BLOCK;
      if (!Number.isSafeInteger(position) || BigInt(position) > original.size) fail('remote-archive-changed');
    }
    await assertUnchanged();
    const entries = [...records.values()].map(record => {
      if (record.payloadOffset === undefined || record.markerOffset === undefined) fail('remote-archive-changed');
      return {
        ref: record.ref,
        async readMarker() {
          await assertUnchanged();
          const bytes = await readAt(record.markerBytes, record.markerOffset);
          if (digest('sha256', bytes) !== record.markerSha256) fail('remote-archive-changed');
          await assertUnchanged();
          return bytes;
        },
        openPayload() {
          return Readable.from((async function* () {
            await assertUnchanged();
            if (record.ref.sizeBytes) {
              const input = handle.createReadStream({ start: record.payloadOffset, end: record.payloadOffset + record.ref.sizeBytes - 1, autoClose: false });
              for await (const chunk of input) yield chunk;
            }
            await assertUnchanged();
          })());
        },
      };
    });
    const result = await use(entries);
    await assertUnchanged();
    return result;
  } finally {
    active = false;
    await handle.close();
  }
}

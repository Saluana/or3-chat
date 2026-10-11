import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertValidSqliteWalFrames, isValidSqliteWalHeader } from './fixtures/sqlite-wal-diagnostics';

const directories = new Set<string>();
afterEach(async () => {
  for (const root of directories) await rm(root, { recursive: true, force: true });
  directories.clear();
});
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'or3-wal-diagnostics-'));
  directories.add(root);
  return { root };
}

test('WAL header validation accepts a real header and refuses every single-byte corruption and short header', () => {
  const validate = isValidSqliteWalHeader;
  const valid = Buffer.from('377f0682002de218000010000000000063ab680c9fc69e53e14fae76ecd64cba', 'hex');
  expect(validate(valid)).toBe(true);
  // Equivalent documented header with big-endian checksum terms.
  expect(validate(Buffer.from('377f0683002de218000010000000000063ab680c9fc69e5379b04ee3c04fd4ef', 'hex'))).toBe(true);
  for (let index = 0; index < valid.length; index++) {
    const corrupted = Buffer.from(valid);
    corrupted[index] = corrupted[index]! ^ 0xff;
    expect(validate(corrupted)).toBe(false);
  }
  for (let length = 0; length < 32; length++) expect(validate(valid.subarray(0, length))).toBe(false);
});


test('WAL frame validation checks real native checksums and allows stale reuse and incomplete uncommitted tails', async () => {
  const fixture = await sandbox();
  for (const pageSize of [512, 4096, 65536]) {
    const path = join(fixture.root, `frames-${pageSize}.sqlite`);
    const db = new Database(path);
    try {
      db.exec(`PRAGMA page_size=${pageSize}; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT);`);
      db.run('INSERT INTO records VALUES (?, ?)', 'committed', 'synthetic committed WAL record');
      const wal = await readFile(`${path}-wal`);
      const frameSize = pageSize + 24;
      const header = wal.subarray(0, 32);
      expect(isValidSqliteWalHeader(header)).toBe(true);
      const validate = (bytes: Uint8Array) => assertValidSqliteWalFrames(header, bytes.byteLength,
        (offset: number, size: number) => bytes.subarray(offset, offset + size));
      const valid = validate(wal);
      expect(valid.checkedFrames).toBe((wal.length - 32) / frameSize);
      expect(valid.staleTail).toBe(false);
      for (const offset of [32, 32 + 4, 32 + 16, 32 + 24 + 100, wal.length - 1]) {
        const damaged = Buffer.from(wal);
        damaged[offset] = damaged[offset]! ^ 0xff;
        expect(() => validate(damaged)).toThrow('Invalid SQLite WAL frame checksum');
      }
      const staleFrame = Buffer.from(wal.subarray(32, 32 + frameSize));
      staleFrame[8] = staleFrame[8]! ^ 0xff;
      const reused = validate(Buffer.concat([wal, staleFrame]));
      expect(reused.checkedFrames).toBe(valid.checkedFrames);
      expect(reused.staleTail).toBe(true);
      const interrupted = validate(Buffer.concat([wal, wal.subarray(32, 32 + 100)]));
      expect(interrupted.checkedFrames).toBe(valid.checkedFrames);
      expect(interrupted.partialTailBytes).toBe(100);
      expect(db.query('SELECT value FROM records WHERE id=?').get('committed')).toEqual({ value: 'synthetic committed WAL record' });
    } finally { db.close(); }
  }
  // Fixed big-endian checksum vector: page/commit=1 followed by 4096 zero bytes.
  const header = Buffer.from('377f0683002de218000010000000000063ab680c9fc69e5379b04ee3c04fd4ef', 'hex');
  const frame = Buffer.alloc(24 + 4096);
  frame.writeUInt32BE(1, 0);
  frame.writeUInt32BE(1, 4);
  header.copy(frame, 8, 16, 24);
  frame.writeUInt32BE(0x60c19537, 16);
  frame.writeUInt32BE(0x10df20b8, 20);
  expect(assertValidSqliteWalFrames(header, 32 + frame.length, () => frame).checkedFrames).toBe(1);
  frame[100] = 1;
  expect(() => assertValidSqliteWalFrames(header, 32 + frame.length, () => frame)).toThrow('Invalid SQLite WAL frame checksum');
});

test('WAL frame validation accepts a real rolled-back WAL tail only with a matching verified commit boundary', async () => {
  const fixture = await sandbox();
  const path = join(fixture.root, 'rollback-tail.sqlite');
  const db = new Database(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=8; CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records VALUES (1, \'baseline\'); BEGIN IMMEDIATE; CREATE TABLE pending(id INTEGER PRIMARY KEY, bytes BLOB);');
    const insert = db.prepare('INSERT INTO pending VALUES (?, ?)');
    for (let index = 0; index < 32; index++) insert.run(index, Buffer.alloc(65536, 0x71));
    db.exec("ROLLBACK; UPDATE records SET value='retained after rollback' WHERE id=1;");
    const wal = await readFile(`${path}-wal`);
    const index = (await readFile(`${path}-shm`)).subarray(0, 96);
    expect(wal.length).toBeGreaterThan(1024 * 1024);
    const validate = (bytes: Uint8Array, hint?: Uint8Array) => assertValidSqliteWalFrames(bytes.subarray(0, 32), bytes.byteLength,
      (offset: number, size: number) => bytes.subarray(offset, offset + size), hint);
    expect(() => validate(wal)).toThrow('Invalid SQLite WAL frame checksum');
    expect(() => validate(wal, index)).not.toThrow();
    expect(db.query('SELECT value FROM records WHERE id=1').get()).toEqual({ value: 'retained after rollback' });
    for (let offset = 0; offset < 96; offset++) {
      const damagedIndex = Buffer.from(index);
      damagedIndex[offset] ^= 1;
      expect(() => validate(wal, damagedIndex)).toThrow('Invalid SQLite WAL frame checksum');
    }
    for (const length of [0, 31, 47, 48, 95]) expect(() => validate(wal, index.subarray(0, length))).toThrow('Invalid SQLite WAL frame checksum');
    const commitFrame = index.readUInt32LE(16);
    const frameSize = wal.readUInt32BE(8) + 24;
    for (const offset of [32 + 24 + 100, 32 + (commitFrame - 1) * frameSize + 4]) {
      const damagedWal = Buffer.from(wal);
      damagedWal[offset] ^= 0xff;
      expect(() => validate(damagedWal, index)).toThrow('Invalid SQLite WAL frame checksum');
    }
  } finally { db.close(); }
});

test('WAL commit-boundary hints verify both native byte orders and never authorize damaged committed frames', () => {
  const header = Buffer.from('377f0683002de218000010000000000063ab680c9fc69e5379b04ee3c04fd4ef', 'hex');
  const frame = Buffer.alloc(24 + 4096);
  frame.writeUInt32BE(1, 0); frame.writeUInt32BE(1, 4);
  header.copy(frame, 8, 16, 24);
  frame.writeUInt32BE(0x60c19537, 16); frame.writeUInt32BE(0x10df20b8, 20);
  const tail = Buffer.from(frame);
  tail.writeUInt32BE(0, 4); tail[100] = 1;
  const wal = Buffer.concat([header, frame, tail]);
  const validate = (bytes: Uint8Array, hint: Uint8Array) => assertValidSqliteWalFrames(header, bytes.byteLength,
    (offset: number, size: number) => bytes.subarray(offset, offset + size), hint);
  for (const littleEndian of [true, false]) {
    const index = Buffer.alloc(96);
    const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
    view.setUint32(0, 3007000, littleEndian);
    index[12] = 1; index[13] = 1;
    view.setUint16(14, 4096, littleEndian);
    view.setUint32(16, 1, littleEndian); view.setUint32(20, 1, littleEndian);
    view.setUint32(24, 0x60c19537, littleEndian); view.setUint32(28, 0x10df20b8, littleEndian);
    header.copy(index, 32, 16, 24);
    const seal = (bytes: Buffer) => {
      const values = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let first = 0; let second = 0;
      for (let offset = 0; offset < 40; offset += 8) {
        first = (first + values.getUint32(offset, littleEndian) + second) >>> 0;
        second = (second + values.getUint32(offset + 4, littleEndian) + first) >>> 0;
      }
      values.setUint32(40, first, littleEndian); values.setUint32(44, second, littleEndian);
      bytes.copy(bytes, 48, 0, 48);
    };
    seal(index);
    expect(validate(wal, index).discardedUncommittedTail).toBe(true);
    for (const offset of [0, 4, 12, 13, 14, 16, 20, 24, 32]) {
      const damaged = Buffer.from(index);
      damaged[offset] ^= 1;
      seal(damaged);
      expect(() => validate(wal, damaged)).toThrow('Invalid SQLite WAL frame checksum');
    }
    const bodyCorruption = Buffer.from(wal);
    bodyCorruption[32 + 24 + 100] ^= 1;
    expect(() => validate(bodyCorruption, index)).toThrow('Invalid SQLite WAL frame checksum');
    const hiddenCommit = Buffer.from(wal);
    hiddenCommit.writeUInt32BE(0, 32 + 4);
    expect(() => validate(hiddenCommit, index)).toThrow('Invalid SQLite WAL frame checksum');
    const extraCommit = Buffer.from(wal);
    extraCommit.writeUInt32BE(1, 32 + frame.length + 4);
    expect(() => validate(extraCommit, index)).toThrow('Invalid SQLite WAL frame checksum');
  }
});

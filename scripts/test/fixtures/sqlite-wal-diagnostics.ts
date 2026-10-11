// Offline diagnostic experiments only. These checks are deliberately excluded
// from production restore: a discarded tail cannot prove expected records.
import { isValidSqliteWalHeader } from '../../../packages/or3-cloud/src/backup/restore';

/** Validate the duplicated native-order WAL-index header as a commit-boundary hint. */
export function readSqliteWalCommitBoundary(header: Uint8Array, byteLength: number, indexHeader?: Uint8Array) {
  if (!indexHeader || indexHeader.byteLength !== 96 || !isValidSqliteWalHeader(header)) return undefined;
  for (let offset = 0; offset < 48; offset++) if (indexHeader[offset] !== indexHeader[offset + 48]) return undefined;
  const index = new DataView(indexHeader.buffer, indexHeader.byteOffset, indexHeader.byteLength);
  const littleEndian = index.getUint32(0, true) === 3007000;
  if (!littleEndian && index.getUint32(0) !== 3007000) return undefined;
  const wal = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const encodedPageSize = index.getUint16(14, littleEndian);
  const pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
  if (index.getUint32(4, littleEndian) !== 0 || indexHeader[12] !== 1
    || indexHeader[13] !== Number(wal.getUint32(0) === 0x377f0683) || pageSize !== wal.getUint32(8)
    || index.getUint32(32) !== wal.getUint32(16) || index.getUint32(36) !== wal.getUint32(20)) return undefined;
  let first = 0;
  let second = 0;
  for (let offset = 0; offset < 40; offset += 8) {
    first = (first + index.getUint32(offset, littleEndian) + second) >>> 0;
    second = (second + index.getUint32(offset + 4, littleEndian) + first) >>> 0;
  }
  if (first !== index.getUint32(40, littleEndian) || second !== index.getUint32(44, littleEndian)) return undefined;
  const frameCount = index.getUint32(16, littleEndian);
  const databasePages = index.getUint32(20, littleEndian);
  if (!frameCount || !databasePages || frameCount > Math.floor((byteLength - 32) / (pageSize + 24))) return undefined;
  return { frameCount, databasePages, checksumFirst: index.getUint32(24, littleEndian), checksumSecond: index.getUint32(28, littleEndian) };
}

/** Stream WAL frames; only a verified commit boundary may authorize a discarded same-salt tail. */
export function assertValidSqliteWalFrames(
  header: Uint8Array,
  byteLength: number,
  readFrame: (offset: number, size: number) => Uint8Array,
  indexHeader?: Uint8Array,
) {
  if (!isValidSqliteWalHeader(header)) throw new Error('Invalid SQLite WAL header');
  if (!Number.isSafeInteger(byteLength) || byteLength < 32) throw new Error('Invalid SQLite WAL size');
  const wal = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const frameSize = wal.getUint32(8) + 24;
  const littleEndian = wal.getUint32(0) === 0x377f0682;
  let first = wal.getUint32(24);
  let second = wal.getUint32(28);
  let checkedFrames = 0;
  const boundary = readSqliteWalCommitBoundary(header, byteLength, indexHeader);
  let verifiedBoundary = false;
  let lastCommitFrame = 0;
  let discardedUncommittedTail = false;
  let offset = 32;
  let staleTail = false;
  for (; byteLength - offset >= frameSize; offset += frameSize) {
    const bytes = readFrame(offset, frameSize);
    if (bytes.byteLength !== frameSize) throw new Error('Could not read SQLite WAL frame');
    const frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (frame.getUint32(8) !== wal.getUint32(16) || frame.getUint32(12) !== wal.getUint32(20)) {
      staleTail = true;
      break;
    }
    for (let word = 0; word < frameSize; word += 8) {
      // Only the first eight header bytes and page content enter the checksum.
      if (word === 8) word = 24;
      first = (first + frame.getUint32(word, littleEndian) + second) >>> 0;
      second = (second + frame.getUint32(word + 4, littleEndian) + first) >>> 0;
    }
    if (first !== frame.getUint32(16) || second !== frame.getUint32(20)) {
      // A rollback can rewind the next append without truncating its old
      // uncommitted frames or changing salts. Never discard corruption within
      // the archived index's independently verified committed prefix.
      if (!boundary || !verifiedBoundary || lastCommitFrame !== boundary.frameCount) throw new Error('Invalid SQLite WAL frame checksum');
      for (let tailOffset = offset; byteLength - tailOffset >= frameSize; tailOffset += frameSize) {
        const tailBytes = readFrame(tailOffset, frameSize);
        if (tailBytes.byteLength !== frameSize) throw new Error('Could not read SQLite WAL frame');
        const tail = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);
        if (tail.getUint32(8) !== wal.getUint32(16) || tail.getUint32(12) !== wal.getUint32(20)) break;
        if (tail.getUint32(4) !== 0) throw new Error('Invalid SQLite WAL frame checksum');
      }
      discardedUncommittedTail = true;
      staleTail = true;
      break;
    }
    checkedFrames++;
    if (frame.getUint32(4) !== 0) lastCommitFrame = checkedFrames;
    if (boundary && checkedFrames === boundary.frameCount) {
      verifiedBoundary = frame.getUint32(4) === boundary.databasePages
        && first === boundary.checksumFirst && second === boundary.checksumSecond;
    }
  }
  // SQLite ignores an incomplete final frame after an interrupted append.
  return { checkedFrames, staleTail, discardedUncommittedTail, partialTailBytes: staleTail ? 0 : byteLength - offset };
}

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { browserUploadFixture } from '../release/browser-upload-fixture.mjs';

// The browser upload must be a fresh valid image, not an existing object from
// the baseline persistence fixture or a previous qualification run.
describe('browser storage fixture', () => {
  it('creates distinct valid PNGs with a decodable pixel', () => {
    const first = browserUploadFixture();
    const second = browserUploadFixture();
    expect(first.equals(second)).toBe(false);
    const baseline = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(hash(first)).not.toBe(hash(baseline));
    expect(first.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    let offset = 8; const chunks: string[] = [];
    while (offset < first.length) {
      const size = first.readUInt32BE(offset);
      const typeAndData = first.subarray(offset + 4, offset + 8 + size);
      const type = typeAndData.subarray(0, 4).toString('ascii');
      expect(first.readUInt32BE(offset + 8 + size)).toBe(crc32(typeAndData));
      if (type === 'IDAT') expect(inflateSync(typeAndData.subarray(4))).toEqual(Buffer.from([0, 0, 0, 0, 255]));
      chunks.push(type); offset += size + 12;
    }
    expect(offset).toBe(first.length);
    expect(chunks).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
  });
});

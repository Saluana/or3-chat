import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name, 'ascii'), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

// A fresh valid one-pixel PNG prevents a previous object from satisfying the
// upload/download check. The nonce lives in a standard PNG text chunk.
export function browserUploadFixture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from(`qualification\0${randomUUID()}`, 'latin1')),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

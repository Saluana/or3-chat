#!/usr/bin/env node
/** Offline only: no credentials, network, live workspace or deletion activation. */
import { openAsBlob } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareSha256CloudBackup } from '../../shared/storage/sha256-backup-preparation';

function argument(name: string) {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) throw new Error('Use --input original.or3cloud --output prepared.or3cloud');
    return resolve(process.argv[index + 1]!);
}
const input = argument('--input'), output = argument('--output');
if (input === output) throw new Error('The original backup must remain unchanged. Choose a new output file.');
// Node checks the file's metadata while reading, rejecting a source modified
// during the multi-pass verification instead of mixing backup snapshots.
const result = await prepareSha256CloudBackup(await openAsBlob(input));
const destination = await open(output, 'wx', 0o600);
try {
    for await (const chunk of result.archive.stream()) {
        let offset = 0;
        while (offset < chunk.byteLength) {
            const { bytesWritten } = await destination.write(chunk, offset, chunk.byteLength - offset);
            if (!bytesWritten) throw new Error('The prepared archive could not be written completely.');
            offset += bytesWritten;
        }
    }
    await destination.sync();
    await destination.close();
} catch (error) {
    await destination.close().catch(() => {});
    await rm(output, { force: true });
    throw error;
}
console.log(JSON.stringify({ prepared: output, convertedFiles: result.convertedFiles, migrationExecuted: false }));

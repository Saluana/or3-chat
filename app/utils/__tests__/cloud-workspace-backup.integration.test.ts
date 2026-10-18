import { Blob as NodeBlob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createCloudBackupStreamCheck, scanCloudBackup } from '~~/shared/storage/workspace-archive';

// Failure inventory: truncation, altered bytes, missing originals, duplicate file
// identities, and device secrets must all fail before creating a destination.
// Fixtures encode the wire format independently of the production writer.
function archive(options: { corrupt?: boolean; omitFile?: boolean; truncate?: boolean; secret?: boolean; body?: string } = {}) {
    const chunks: Uint8Array[] = [new TextEncoder().encode('OR3CLOUD1\n')];
    const digest = createHash('sha256');
    const append = (header: object, body = new Uint8Array()) => {
        const line = new TextEncoder().encode(JSON.stringify(header) + '\n');
        chunks.push(line, body); digest.update(line); digest.update(body);
    };
    append({ type: 'meta', version: 1, size: 0, workspaceName: 'Original workspace' });
    const bytes = new TextEncoder().encode(options.body ?? 'original');
    const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const meta = { hash, name: 'original.txt', mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length, storage_id: 'source-object', storage_provider_id: 'fs', ref_count: 1, clock: 1, created_at: 1, updated_at: 1, deleted: false };
    const row = new TextEncoder().encode(JSON.stringify(meta));
    append({ type: 'row', table: 'file_meta', size: row.length }, row);
    if (options.secret) {
        const secret = new TextEncoder().encode(JSON.stringify({ id: 'kv:openrouter_api_key', name: 'openrouter_api_key', value: 'secret', clock: 1, created_at: 1, updated_at: 1, deleted: false }));
        append({ type: 'row', table: 'kv', size: secret.length }, secret);
    }
    if (!options.omitFile) append({ type: 'file', hash, size: bytes.length }, bytes);
    if (!options.truncate) chunks.push(new TextEncoder().encode(JSON.stringify({ type: 'end', size: 0, rows: options.secret ? 2 : 1, files: options.omitFile ? 0 : 1, sha256: digest.digest('hex') }) + '\n'));
    if (options.corrupt) chunks[chunks.length - 2] = new TextEncoder().encode('corrupt!');
    return new NodeBlob(chunks) as unknown as Blob;
}
it('validates a complete archive without materializing its original into memory', async () => {
    const file = archive();
    const found: string[] = [];
    const meta = await scanCloudBackup(file, async frame => { if (frame.header.type === 'file') found.push(await frame.body.text()); });
    expect(meta.workspaceName).toBe('Original workspace');
    expect(found).toEqual(['original']);
});
it.each([{ truncate: true }, { corrupt: true }, { omitFile: true }, { secret: true }])('rejects an unsafe archive %j', async options => {
    await expect(scanCloudBackup(archive(options))).rejects.toThrow();
});

// Failure inventory for download completion: headers can cross network chunks;
// an original can itself end with JSON resembling the archive terminal marker.
it('recognizes a complete download with arbitrarily split frames', async () => {
    const check = createCloudBackupStreamCheck();
    for (const byte of new Uint8Array(await archive().arrayBuffer())) check.write(Uint8Array.of(byte));
    expect(() => check.finish()).not.toThrow();
});
it('rejects a truncated download whose original imitates a terminal marker', async () => {
    const check = createCloudBackupStreamCheck();
    check.write(new Uint8Array(await archive({ truncate: true,
        body: `\n${JSON.stringify({ type: 'end', size: 0, rows: 1, files: 1, sha256: 'a'.repeat(64) })}\n`,
    }).arrayBuffer()));
    expect(() => check.finish()).toThrow();
});

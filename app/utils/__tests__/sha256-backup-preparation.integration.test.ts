import { Blob as NodeBlob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prepareSha256CloudBackup } from '~~/shared/storage/sha256-backup-preparation';
import { scanCloudBackup } from '~~/shared/storage/workspace-archive';

// Failure inventory before implementation: invalid input checksum; stale object
// targets; missing attachment rewrites; silent identity coalescing; mutation of
// prose/extension data; compressed revision references; accidental live writes.
// The wire fixture and expected digests are independent of the converter.
const bytes = Buffer.from('legacy original');
const oldHash = `md5:${createHash('md5').update(bytes).digest('hex')}`;
const newHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
beforeEach(() => vi.stubGlobal('Blob', NodeBlob));
afterEach(() => vi.unstubAllGlobals());
function fixture(extra: 'none' | 'alias' | 'opaque' | 'encoded' | 'revision' | 'bare-reference' | 'corrupt' = 'none') {
    const pieces: Uint8Array[] = [Buffer.from('OR3CLOUD1\n')]; const digest = createHash('sha256');
    let rows = 0, files = 0;
    const append = (header: object, body = Buffer.alloc(0)) => { const line = Buffer.from(JSON.stringify(header) + '\n'); pieces.push(line, body); digest.update(line); digest.update(body); };
    const row = (table: string, value: object) => { const body = Buffer.from(JSON.stringify(value)); append({ type: 'row', table, size: body.length }, body); rows++; };
    const stamp = { created_at: 1, updated_at: 1, clock: 1, deleted: false };
    const meta = (hash: string) => row('file_meta', { hash, size_bytes: bytes.length, mime_type: 'text/plain', storage_id: 'old-key', storage_provider_id: 's3', ...stamp });
    append({ type: 'meta', version: 1, size: 0, workspaceName: 'Original' }); meta(oldHash);
    row('messages', { id: 'message', thread_id: 'thread', role: 'user', index: 0, order_key: 'order', content: 'Keep this text', file_hashes: JSON.stringify([oldHash]), ...stamp });
    row('posts', { id: 'document', title: 'Document', post_type: 'doc', content: JSON.stringify({ type: 'doc', content: [{ type: 'or3Image', attrs: { hash: oldHash } }] }), file_hashes: JSON.stringify([oldHash]), ...stamp });
    if (extra === 'alias') meta(newHash);
    if (extra === 'opaque') row('kv', { id: 'plugin:opaque', name: 'plugin:opaque', value: { reference: oldHash }, ...stamp });
    if (extra === 'encoded') row('kv', { id: 'plugin:opaque', name: 'plugin:opaque', value: Buffer.from(oldHash).toString('base64'), ...stamp });
    if (extra === 'revision') row('posts', { id: 'revision', title: 'Document', post_type: 'or3:document-revision-chunk', content: 'encoded-content', ...stamp });
    if (extra === 'bare-reference') row('posts', { id: 'custom', title: 'Document', post_type: 'doc', content: JSON.stringify({ attachment: `/legacy/${oldHash.slice(4)}` }), ...stamp });
    append({ type: 'file', hash: oldHash, size: bytes.length }, bytes); files++;
    if (extra === 'alias') { append({ type: 'file', hash: newHash, size: bytes.length }, bytes); files++; }
    pieces.push(Buffer.from(JSON.stringify({ type: 'end', size: 0, rows, files, sha256: extra === 'corrupt' ? '0'.repeat(64) : digest.digest('hex') }) + '\n'));
    return new NodeBlob(pieces) as unknown as Blob;
}
it('produces a separately verified SHA-256 backup with exact references and unchanged originals', async () => {
    const source = fixture(); const original = await source.text();
    const result = await prepareSha256CloudBackup(source);
    expect(result.convertedFiles).toBe(1);
    const rows: Record<string, unknown>[] = []; const hashes: string[] = [];
    await scanCloudBackup(result.archive, async frame => {
        if (frame.row) rows.push(frame.row);
        if (frame.header.type === 'file') { hashes.push(frame.header.hash); expect(Buffer.from(await frame.body.arrayBuffer())).toEqual(bytes); }
    });
    expect(hashes).toEqual([newHash]);
    expect(rows[0]?.hash).toBe(newHash);
    expect(rows[0]?.storage_id).toBeUndefined();
    expect(rows[0]?.storage_provider_id).toBeUndefined();
    expect(rows[1]?.file_hashes).toBe(JSON.stringify([newHash]));
    expect(rows[1]?.content).toBe('Keep this text');
    expect(JSON.parse(String(rows[2]?.content)).content[0].attrs.hash).toBe(newHash);
    expect(await source.text()).toBe(original);
});
it.each(['alias', 'opaque', 'encoded', 'revision', 'bare-reference', 'corrupt'] as const)('refuses unsafe %s preparation without yielding a replacement', async kind => {
    await expect(prepareSha256CloudBackup(fixture(kind))).rejects.toThrow();
});

it('prepares a new private archive on disk and refuses to overwrite either archive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'or3-backup-prepare-'));
    const input = join(directory, 'original.or3cloud'), output = join(directory, 'prepared.or3cloud');
    const original = Buffer.from(await fixture().arrayBuffer());
    const run = (destination: string) => execFileSync(process.execPath, ['--import', 'tsx', resolve('scripts/storage/prepare-sha256-backup.ts'),
        '--input', input, '--output', destination], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        await writeFile(input, original);
        expect(JSON.parse(run(output)).convertedFiles).toBe(1);
        const prepared = await readFile(output);
        await scanCloudBackup(new NodeBlob([prepared]) as unknown as Blob);
        expect(() => run(output)).toThrow();
        expect(() => run(input)).toThrow();
        expect(await readFile(input)).toEqual(original);
        expect(await readFile(output)).toEqual(prepared);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

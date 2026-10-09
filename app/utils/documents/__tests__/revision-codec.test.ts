import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    REVISION_CHUNK_MAX_CHARS,
    REVISION_SYNC_PAYLOAD_MAX_BYTES,
    assertRevisionSyncPayloadSize,
    decodeDocumentRevision,
    encodeDocumentRevision,
} from '../revision-codec';

afterEach(() => vi.unstubAllGlobals());

describe.each(['native', 'http'] as const)('document revision codec in %s contexts', (context) => {
    beforeEach(() => {
        if (context === 'http') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    });
    it('round trips, hashes, and chunks a large snapshot', async () => {
        const text = Array.from({ length: 70_000 }, (_, index) => String.fromCharCode(33 + (index % 80))).join('');
        const snapshot = {
            title: 'Large revision',
            content: {
                type: 'doc' as const,
                content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            },
        };
        const encoded = await encodeDocumentRevision(snapshot, { disableCompression: true });
        expect(encoded.chunks.length).toBeGreaterThan(1);
        expect(encoded.chunks.every((chunk) => chunk.length <= REVISION_CHUNK_MAX_CHARS)).toBe(true);
        expect(await decodeDocumentRevision(encoded)).toEqual(snapshot);
    });

    it('rejects corrupt content', async () => {
        const encoded = await encodeDocumentRevision({
            title: 'Revision',
            content: { type: 'doc', content: [] },
        }, { disableCompression: true });
        encoded.chunks[0] = `${encoded.chunks[0]!.slice(0, -1)}A`;
        await expect(decodeDocumentRevision(encoded)).rejects.toThrow(/checksum|invalid/iu);
    });

    it('preflights sync payloads below the provider limit', () => {
        expect(() => assertRevisionSyncPayloadSize({ content: 'x'.repeat(48 * 1024) })).not.toThrow();
        expect(() => assertRevisionSyncPayloadSize({
            content: 'x'.repeat(REVISION_SYNC_PAYLOAD_MAX_BYTES),
        })).toThrow(/maximum/iu);
    });
});

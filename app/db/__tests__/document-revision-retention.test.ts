import { describe, expect, it } from 'vitest';
import {
    selectRevisionIdsForRetention,
    type DocumentRevisionManifest,
} from '../document-revisions';

function manifest(index: number, createdAt: number, encodedBytes = 100): DocumentRevisionManifest {
    return {
        version: 1,
        revisionId: `revision-${index.toString().padStart(3, '0')}`,
        documentId: 'doc-1',
        source: 'auto',
        createdAt,
        titleContentHash: `${index}`.padStart(64, '0'),
        encoding: 'identity-base64url',
        originalBytes: encodedBytes,
        encodedBytes,
        chunkIds: [`chunk-${index}`],
        fileHashes: [],
    };
}

describe('document revision retention', () => {
    it('retains the newest twenty plus daily checkpoints deterministically', () => {
        const now = 2_000_000_000;
        const revisions = Array.from({ length: 40 }, (_, index) =>
            manifest(index, now - (index * 24 * 60 * 60))
        );
        const retained = selectRevisionIdsForRetention(revisions, now, 10_000_000);
        expect(retained.has('revision-000')).toBe(true);
        expect(retained.size).toBe(20);
    });

    it('always retains the newest checkpoint when it alone exceeds budget', () => {
        const now = 2_000_000_000;
        const retained = selectRevisionIdsForRetention([
            manifest(0, now, 6_000_000),
            manifest(1, now - 60, 100),
        ], now, 5_000_000);
        expect([...retained]).toEqual(['revision-000']);
    });
});

import { describe, expect, it } from 'vitest';
import { createCanonicalStorageContractFixture } from '../testing/canonical-storage-fixture';

describe('canonical storage contract fixture', () => {
    it('expresses pagination, upload integrity, quota, marker ordering, and retention', async () => {
        const hashA = `sha256:${'a'.repeat(64)}`;
        const hashB = `sha256:${'b'.repeat(64)}`;
        const fixture = createCanonicalStorageContractFixture({
            workspaceId: 'workspace-a',
            now: 10_000,
            retentionSeconds: 100,
            pageSize: 1,
        })
            .liveMetadata(hashA, { sizeBytes: 4, updatedAt: 9_800 })
            .liveMetadata(hashB, { sizeBytes: 8, updatedAt: 9_950 })
            .reference(hashA, { sourceTable: 'posts', sourceId: 'post-1' })
            .reservation(hashB, { sizeBytes: 8, expiresAt: 10_100 })
            .upload({
                hash: hashB,
                checksumSha256: 'base64-checksum',
                sizeBytes: 8,
                mimeType: 'image/png',
                reservedBytes: 8,
                expiresAt: 10_100,
            })
            .markerPair(hashA, { blobPage: 1, markerPage: 2, updatedAt: 9_800 });

        const first = await fixture.query({
            scope: { workspaceId: 'workspace-a' },
            kind: 'live_metadata',
            limit: 100,
        });
        expect(first).toMatchObject({ hasMore: true, nextCursor: '1' });
        expect(first.items).toHaveLength(1);
        expect(fixture.uploads[0]).toMatchObject({ reservedBytes: 8, checksumSha256: 'base64-checksum' });
        expect(fixture.markerPairs[0]).toMatchObject({ blobPage: 1, markerPage: 2 });
        expect(fixture.isPastRetention(9_800)).toBe(true);
        expect(fixture.isPastRetention(9_950)).toBe(false);
    });
});

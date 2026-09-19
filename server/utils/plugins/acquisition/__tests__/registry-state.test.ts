import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    RegistryStateAcceptanceError,
    RegistryStateCorruptError,
    RegistryStateStore,
} from '../registry-state';

function store(): RegistryStateStore {
    return new RegistryStateStore(mkdtempSync(resolve(tmpdir(), 'or3-registry-state-')));
}

const alpha = {
    releaseId: 'rel_alpha',
    pluginId: 'alpha',
    version: '1.0.0',
    sequence: 7,
    reason: 'exfiltrates unrelated documents',
};

describe('registry quarantine ledger', () => {
    it('keeps a release-scoped quarantine when an unrelated sequence advances', async () => {
        const state = store();
        await state.recordQuarantines([alpha]);
        // An unrelated release's advisory advances the freshness cursor.
        await state.acceptAdvisorySequence(9);
        const read = await state.read();
        expect(read.acceptedAdvisorySequence).toBe(9);
        expect(read.quarantinedReleases.rel_alpha).toMatchObject({
            pluginId: 'alpha',
            sequence: 7,
        });
    });

    it('only replaces an entry with a higher sequence and only when asked', async () => {
        const state = store();
        await state.recordQuarantines([alpha]);
        // A lower sequence for the same release cannot overwrite the decision.
        await state.recordQuarantines([
            { ...alpha, sequence: 3, reason: 'stale replayed advisory' },
        ]);
        expect((await state.read()).quarantinedReleases.rel_alpha?.sequence).toBe(7);

        // A higher sequence is a newer decision and does replace it.
        await state.recordQuarantines([
            { ...alpha, sequence: 11, reason: 'still quarantined after review' },
        ]);
        expect((await state.read()).quarantinedReleases.rel_alpha).toMatchObject({
            sequence: 11,
            reason: 'still quarantined after review',
        });
    });

    it('survives a sequence write that races with a quarantine write', async () => {
        const state = store();
        await Promise.all([
            state.acceptAdvisorySequence(4),
            state.recordQuarantines([alpha]),
        ]);
        const read = await state.read();
        expect(read.acceptedAdvisorySequence).toBe(4);
        expect(Object.keys(read.quarantinedReleases)).toContain('rel_alpha');
    });

    it('fails closed when the persisted ledger is unreadable', async () => {
        const state = store();
        await state.recordQuarantines([alpha]);
        writeFileSync(state.statePath(), '{not-json');
        await expect(state.read()).rejects.toBeInstanceOf(RegistryStateCorruptError);
    });

    it('treats an absent ledger as an empty initial state', async () => {
        expect((await store().read()).acceptedAdvisorySequence).toBe(0);
    });

    it('rejects an older same-sequence checkpoint but accepts a newer snapshot', async () => {
        const state = store();
        const first = {
            sequence: 7,
            snapshotSha256: `sha256-${'1'.repeat(64)}`,
            issuedAt: '2026-09-19T10:00:00.000Z',
            expiresAt: '2026-09-19T11:00:00.000Z',
        } as const;
        await state.acceptAdvisoryCheckpoint(first);
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...first,
                issuedAt: '2026-09-19T09:59:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'replay' });
        expect((await state.read()).acceptedAdvisoryCheckpoint?.snapshotSha256).toBe(first.snapshotSha256);
        const newer = { ...first, issuedAt: '2026-09-19T10:01:00.000Z' };
        await state.acceptAdvisoryCheckpoint(newer);
        expect((await state.read()).acceptedAdvisoryCheckpoint).toEqual(newer);
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...newer,
                snapshotSha256: `sha256-${'2'.repeat(64)}`,
                issuedAt: '2026-09-19T10:02:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'equivocation' });
    });

    it('rejects same-time equivocation and a stale competing writer', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-registry-state-race-'));
        const left = new RegistryStateStore(root);
        const right = new RegistryStateStore(root);
        const first = {
            sequence: 8,
            snapshotSha256: `sha256-${'3'.repeat(64)}`,
            issuedAt: '2026-09-19T10:00:00.000Z',
            expiresAt: '2026-09-19T11:00:00.000Z',
        } as const;
        const other = { ...first, snapshotSha256: `sha256-${'4'.repeat(64)}` };
        const results = await Promise.allSettled([
            left.acceptAdvisoryCheckpoint(first),
            right.acceptAdvisoryCheckpoint(other),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
            RegistryStateAcceptanceError
        );
        expect(['replay', 'equivocation']).toContain(
            (rejected as PromiseRejectedResult).reason.kind
        );
        await expect(
            left.acceptAdvisoryCheckpoint({
                ...first,
                snapshotSha256: `sha256-${'5'.repeat(64)}`,
            })
        ).rejects.toMatchObject({ kind: 'equivocation' });
    });

    it('fails closed when a persisted quarantine entry is malformed', async () => {
        const state = store();
        await state.recordQuarantines([alpha]);
        writeFileSync(
            state.statePath(),
            JSON.stringify({
                schemaVersion: 1,
                acceptedAdvisorySequence: 0,
                acceptedAdvisoryCheckpoint: null,
                quarantinedReleases: {
                    rel_alpha: { ...alpha, releaseId: 'rel_other' },
                },
                updatedAt: 1,
            })
        );
        await expect(state.read()).rejects.toBeInstanceOf(RegistryStateCorruptError);
    });
});

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

/** Create the state directory through a real write, then replace its contents. */
async function writeState(state: RegistryStateStore, contents: unknown): Promise<void> {
    await state.acceptAdvisorySequence(0);
    writeFileSync(state.statePath(), JSON.stringify(contents));
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

    it('keeps the quarantine ledger and revision floor across a restart', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-registry-state-restart-'));
        const first = new RegistryStateStore(root);
        await first.acceptAdvisoryCheckpoint({
            revision: 4,
            sequence: 9,
            snapshotSha256: `sha256-${'6'.repeat(64)}`,
            issuedAt: '2026-09-19T10:00:00.000Z',
            expiresAt: '2026-09-19T11:00:00.000Z',
        });
        await first.recordQuarantines([alpha]);

        // A fresh store over the same directory models a host restart: the
        // revision floor and the release-scoped decision must still be there.
        const second = new RegistryStateStore(root);
        const reopened = await second.read();
        expect(reopened.acceptedSecurityRevision).toBe(4);
        expect(reopened.acceptedAdvisorySequence).toBe(9);
        expect(reopened.quarantinedReleases.rel_alpha?.sequence).toBe(7);
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

    it('rejects an older same-revision checkpoint but accepts a newer snapshot', async () => {
        const state = store();
        const first = {
            revision: 3,
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

    it('rejects a lower revision and any digest change at the accepted revision', async () => {
        const state = store();
        const first = {
            revision: 5,
            sequence: 12,
            snapshotSha256: `sha256-${'a'.repeat(64)}`,
            issuedAt: '2026-09-19T10:00:00.000Z',
            expiresAt: '2026-09-19T11:00:00.000Z',
        } as const;
        await state.acceptAdvisoryCheckpoint(first);

        // A replayed older security state is a rollback.
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...first,
                revision: 4,
                sequence: 11,
                issuedAt: '2026-09-19T10:05:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'replay' });

        // Same revision, different digest: equivocation even at a new sequence,
        // because the revision is part of the snapshot identity.
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...first,
                sequence: 13,
                snapshotSha256: `sha256-${'b'.repeat(64)}`,
                issuedAt: '2026-09-19T10:06:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'equivocation' });

        // A higher revision may keep the advisory sequence (a key-status change)
        // and must be accepted.
        const keyStatusChange = {
            ...first,
            revision: 6,
            snapshotSha256: `sha256-${'c'.repeat(64)}`,
            issuedAt: '2026-09-19T10:07:00.000Z',
        };
        await state.acceptAdvisoryCheckpoint(keyStatusChange);
        expect((await state.read()).acceptedSecurityRevision).toBe(6);
        expect((await state.read()).acceptedAdvisorySequence).toBe(12);

        // The advisory sequence remains an independent floor.
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...keyStatusChange,
                revision: 7,
                sequence: 11,
                snapshotSha256: `sha256-${'d'.repeat(64)}`,
                issuedAt: '2026-09-19T10:08:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'replay' });
    });

    it('rejects same-time equivocation and a stale competing writer', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-registry-state-race-'));
        const left = new RegistryStateStore(root);
        const right = new RegistryStateStore(root);
        const first = {
            revision: 8,
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

    it('migrates v1 state by keeping the sequence floor and dropping v1 evidence', async () => {
        const state = store();
        // Create the directory the way a real first write would, then replace
        // the file with a pre-v2 state: schemaVersion 1, a v1-shaped checkpoint
        // without a revision, and a recorded quarantine that must survive.
        await state.recordQuarantines([alpha]);
        writeFileSync(
            state.statePath(),
            JSON.stringify({
                schemaVersion: 1,
                acceptedAdvisorySequence: 9,
                acceptedAdvisoryCheckpoint: {
                    sequence: 9,
                    snapshotSha256: `sha256-${'e'.repeat(64)}`,
                    issuedAt: '2026-09-19T10:00:00.000Z',
                    expiresAt: '2026-09-19T11:00:00.000Z',
                },
                quarantinedReleases: {
                    rel_alpha: { ...alpha, sequence: 7, recordedAt: 1 },
                },
                updatedAt: 1,
            })
        );

        const migrated = await state.read();
        expect(migrated.schemaVersion).toBe(2);
        expect(migrated.acceptedAdvisorySequence).toBe(9);
        expect(migrated.acceptedSecurityRevision).toBe(0);
        expect(migrated.acceptedAdvisoryCheckpoint).toBeNull();
        expect(migrated.quarantinedReleases.rel_alpha?.sequence).toBe(7);

        // A v1-shaped checkpoint cannot be replayed through the v2 API.
        await expect(
            state.acceptAdvisoryCheckpoint({
                sequence: 9,
                snapshotSha256: `sha256-${'e'.repeat(64)}`,
                issuedAt: '2026-09-19T10:05:00.000Z',
                expiresAt: '2026-09-19T11:00:00.000Z',
            } as never)
        ).rejects.toBeInstanceOf(TypeError);

        // The first v2 checkpoint at the migrated revision is accepted even
        // though its digest necessarily differs from the discarded v1 digest.
        const firstV2 = {
            revision: 0,
            sequence: 9,
            snapshotSha256: `sha256-${'f'.repeat(64)}`,
            issuedAt: '2026-09-19T10:06:00.000Z',
            expiresAt: '2026-09-19T11:00:00.000Z',
        };
        await state.acceptAdvisoryCheckpoint(firstV2);
        const after = await state.read();
        expect(after.acceptedSecurityRevision).toBe(0);
        expect(after.acceptedAdvisoryCheckpoint?.snapshotSha256).toBe(firstV2.snapshotSha256);

        // And a hostile pre-v2 snapshot replayed at the same revision is now
        // equivocation, not a silent replacement.
        await expect(
            state.acceptAdvisoryCheckpoint({
                ...firstV2,
                snapshotSha256: `sha256-${'1'.repeat(64)}`,
                issuedAt: '2026-09-19T10:07:00.000Z',
            })
        ).rejects.toMatchObject({ kind: 'equivocation' });
    });

    it('fails closed on unsupported or inconsistent persisted state', async () => {
        const unsupported = store();
        await writeState(unsupported, { schemaVersion: 3 });
        await expect(unsupported.read()).rejects.toBeInstanceOf(RegistryStateCorruptError);

        const missingRevision = store();
        await writeState(missingRevision, { schemaVersion: 2, acceptedAdvisorySequence: 1 });
        await expect(missingRevision.read()).rejects.toBeInstanceOf(RegistryStateCorruptError);

        const mismatched = store();
        await writeState(
            mismatched,
            {
                schemaVersion: 2,
                acceptedSecurityRevision: 4,
                acceptedAdvisorySequence: 7,
                acceptedAdvisoryCheckpoint: {
                    revision: 5,
                    sequence: 7,
                    snapshotSha256: `sha256-${'2'.repeat(64)}`,
                    issuedAt: '2026-09-19T10:00:00.000Z',
                    expiresAt: '2026-09-19T11:00:00.000Z',
                },
                quarantinedReleases: {},
                updatedAt: 1,
            }
        );
        await expect(mismatched.read()).rejects.toBeInstanceOf(RegistryStateCorruptError);
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

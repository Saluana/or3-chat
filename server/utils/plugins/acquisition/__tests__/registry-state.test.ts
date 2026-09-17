import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegistryStateStore } from '../registry-state';

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

    it('ignores an unreadable ledger rather than trusting it', async () => {
        const state = store();
        await state.recordQuarantines([alpha]);
        expect((await state.read()).quarantinedReleases.rel_alpha).toBeDefined();
    });
});

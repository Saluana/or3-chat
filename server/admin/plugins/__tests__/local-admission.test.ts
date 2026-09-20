import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    LOCAL_ADMISSION_PROVENANCE,
    readLocalAdmission,
    recordLocalAdmission,
    upgradeLocalAdmissionDigest,
} from '../local-admission';

/** Local provenance is explicit, bounded and digest-scoped: never a signature. */
describe('local admission provenance', () => {
    const root = () => {
        const directory = mkdtempSync(join(tmpdir(), 'or3-local-admission-'));
        return directory;
    };

    function record(overrides: Record<string, unknown> = {}) {
        return {
            schemaVersion: 1,
            pluginId: 'or3.sample-utility',
            packageDigest: `sha256-${'a'.repeat(64)}`,
            manifestDigest: `sha256-${'b'.repeat(64)}`,
            archiveSha256: `sha256-${'c'.repeat(64)}`,
            sourceSha256: `sha256-${'d'.repeat(64)}`,
            receiptSha256: `sha256-${'e'.repeat(64)}`,
            candidateVersion: '0.2.0',
            admittedAt: new Date(0).toISOString(),
            admittedBy: 'admin',
            ...overrides,
        } as Parameters<typeof recordLocalAdmission>[0];
    }

    it('round-trips a bounded record without secrets', async () => {
        const extensionsRoot = root();
        try {
            await recordLocalAdmission(record(), extensionsRoot);
            const read = await readLocalAdmission(
                'or3.sample-utility',
                `sha256-${'a'.repeat(64)}`,
                extensionsRoot
            );
            expect(read?.candidateVersion).toBe('0.2.0');
            expect(LOCAL_ADMISSION_PROVENANCE).toBe('local-development');
        } finally {
            rmSync(extensionsRoot, { recursive: true, force: true });
        }
    });

    it('returns null for unsigned catalog digests', async () => {
        const extensionsRoot = root();
        try {
            await expect(
                readLocalAdmission('or3.sample-utility', `sha256-${'f'.repeat(64)}`, extensionsRoot)
            ).resolves.toBeNull();
        } finally {
            rmSync(extensionsRoot, { recursive: true, force: true });
        }
    });

    it('refuses replacement of a frozen record and invalid identities', async () => {
        const extensionsRoot = root();
        try {
            await recordLocalAdmission(record(), extensionsRoot);
            await expect(recordLocalAdmission(record(), extensionsRoot)).rejects.toBeTruthy();
            await expect(
                recordLocalAdmission(record({ pluginId: '../escape' }), extensionsRoot)
            ).rejects.toThrow(/Invalid plugin id/);
            await expect(
                readLocalAdmission('../escape', `sha256-${'a'.repeat(64)}`, extensionsRoot)
            ).resolves.toBeNull();
        } finally {
            rmSync(extensionsRoot, { recursive: true, force: true });
        }
    });

    it('upgrades a schema 1 record to the canonical digest for identical bytes', async () => {
        const extensionsRoot = root();
        try {
            await recordLocalAdmission(record({ schemaVersion: 1 }), extensionsRoot);
            const upgraded = record({
                schemaVersion: 2,
                receiptSha256: `sha256-${'f'.repeat(64)}`,
            });
            await upgradeLocalAdmissionDigest(
                'or3.sample-utility',
                `sha256-${'a'.repeat(64)}`,
                upgraded,
                extensionsRoot
            );
            const read = await readLocalAdmission(
                'or3.sample-utility',
                `sha256-${'a'.repeat(64)}`,
                extensionsRoot
            );
            expect(read?.schemaVersion).toBe(2);
            expect(read?.receiptSha256).toBe(`sha256-${'f'.repeat(64)}`);
        } finally {
            rmSync(extensionsRoot, { recursive: true, force: true });
        }
    });

    it('refuses upgrades with drifted bytes or without a prior record', async () => {
        const extensionsRoot = root();
        try {
            await recordLocalAdmission(record({ schemaVersion: 1 }), extensionsRoot);
            await expect(
                upgradeLocalAdmissionDigest(
                    'or3.sample-utility',
                    `sha256-${'a'.repeat(64)}`,
                    record({ schemaVersion: 2, archiveSha256: `sha256-${'0'.repeat(64)}` }),
                    extensionsRoot
                )
            ).rejects.toMatchObject({ code: 'EEXIST' });
            await expect(
                upgradeLocalAdmissionDigest(
                    'or3.sample-utility',
                    `sha256-${'b'.repeat(64)}`,
                    record({ schemaVersion: 2 }),
                    extensionsRoot
                )
            ).rejects.toMatchObject({ code: 'EEXIST' });
        } finally {
            rmSync(extensionsRoot, { recursive: true, force: true });
        }
    });
});

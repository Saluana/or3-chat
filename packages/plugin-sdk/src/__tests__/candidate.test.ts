import { beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createV2Package } from '../cli/create';
import {
    buildProvenanceSha256,
    candidateReceiptSha256,
    canonicalCandidateJson,
    CandidateValidationError,
    createV2Candidate,
    hashSdkArtifact,
    parseCandidateReceipt,
    parseDeveloperVerificationReceipt,
    qualifyCandidateDirectory,
    verifyCandidateDirectory,
} from '../candidate';

/**
 * The candidate is the exact bytes tested, submitted and installed: creation
 * freezes sibling outputs, consumption verifies them without rebuilding, and
 * qualification compares a clean rebuild instead of replacing the archive.
 */

const CLEAN_PROBE = () => ({ revision: 'abc123def456', dirty: false });

function makePackage(): string {
    const root = mkdtempSync(join(tmpdir(), 'or3-candidate-src-'));
    createV2Package({ pluginId: 'or3.candidate-fixture', directory: root, template: 'portable-v1' });
    // Self-contained entry: no bare imports, so no bundler is needed in any runtime.
    writeFileSync(
        join(root, 'client.mjs'),
        `export const fixture = Object.freeze({ hello: 'candidate' });\n`
    );
    return root;
}

function makeOut(): string {
    const out = join(mkdtempSync(join(tmpdir(), 'or3-candidate-out-')), 'candidate');
    mkdirSync(out, { recursive: true });
    rmSync(out, { recursive: true, force: true });
    return out;
}

let temporaries: string[] = [];
beforeEach(() => {
    for (const path of temporaries) rmSync(path, { recursive: true, force: true });
    temporaries = [];
});
function track(path: string): string {
    temporaries.push(path);
    return path;
}

describe('createV2Candidate', () => {
    it('freezes sibling package/source/receipt outputs with matching digests', async () => {
        const root = track(makePackage());
        const out = track(makeOut());
        const created = await createV2Candidate(root, {
            outputDirectory: out,
            command: 'or3-plugin candidate . --out candidate',
            probeSourceControl: CLEAN_PROBE,
        });
        expect(created.receipt.pluginId).toBe('or3.candidate-fixture');
        expect(created.receipt.source).toEqual({ revision: 'abc123def456', dirty: false });
        expect(created.receipt.profile).toBe('or3-portable-client-v1');
        expect(created.receipt.buildProvenanceSha256).toBe(
            buildProvenanceSha256(created.receipt.source, created.receipt.build)
        );
        // The receipt itself validates, and its canonical encoding is stable.
        expect(parseCandidateReceipt(JSON.parse(JSON.stringify(created.receipt)))).toEqual(created.receipt);
        expect(canonicalCandidateJson(created.receipt)).toBe(canonicalCandidateJson(parseCandidateReceipt(created.receipt)));
        // Sibling outputs exist next to the receipt, never inside the archive.
        for (const file of ['package.zip', 'source.zip', 'receipt.json']) {
            expect(existsSync(join(out, file))).toBe(true);
        }
        // Creation leaves no build residue in the source tree.
        expect(readdirSync(root).filter((entry) => entry.startsWith('.candidate-') || entry.startsWith('.or3-pack'))).toEqual([]);
        // Dirty-vs-clean is recorded, not hidden: this snapshot is clean.
        expect(created.receipt.source.dirty).toBe(false);
    });

    it('records dirty development snapshots instead of hiding them', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: () => ({ revision: 'abc123def456', dirty: true }),
        });
        expect(created.receipt.source.dirty).toBe(true);
        // A dirty snapshot still verifies as a frozen candidate.
        await expect(verifyCandidateDirectory(created.candidateDirectory)).resolves.toMatchObject({
            receiptSha256: candidateReceiptSha256(created.receipt),
        });
    });

    it('refuses to replace a frozen candidate', async () => {
        const root = track(makePackage());
        const out = track(makeOut());
        await createV2Candidate(root, { outputDirectory: out, probeSourceControl: CLEAN_PROBE });
        await expect(
            createV2Candidate(root, { outputDirectory: out, probeSourceControl: CLEAN_PROBE })
        ).rejects.toThrow(/frozen candidate/);
    });

    it('a changed source is a new candidate, never a mutated one', async () => {
        const root = track(makePackage());
        const first = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        appendFileSync(join(root, 'client.mjs'), '// iteration two\n');
        const second = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        expect(second.receipt.packageTreeSha256).not.toBe(first.receipt.packageTreeSha256);
        expect(second.receipt.sourceSha256).not.toBe(first.receipt.sourceSha256);
        // The frozen first candidate still verifies unchanged.
        await expect(verifyCandidateDirectory(first.candidateDirectory)).resolves.toBeDefined();
    });
});

describe('verifyCandidateDirectory', () => {
    it('consumes frozen files without rebuilding', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        const before = readdirSync(root).slice().sort();
        const verified = await verifyCandidateDirectory(created.candidateDirectory);
        expect(verified.receipt).toEqual(created.receipt);
        // No build ran: the source tree is untouched.
        expect(readdirSync(root).slice().sort()).toEqual(before);
    });

    it('rejects tampered package bytes', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        const packagePath = join(created.candidateDirectory, 'package.zip');
        const bytes = Buffer.from(readFileSync(packagePath));
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        writeFileSync(packagePath, bytes);
        await expect(verifyCandidateDirectory(created.candidateDirectory)).rejects.toBeInstanceOf(
            CandidateValidationError
        );
    });

    it('rejects tampered source content', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        const sourcePath = join(created.candidateDirectory, 'source.zip');
        const bytes = Buffer.from(readFileSync(sourcePath));
        // Flip a byte inside the compressed data, not the trailing record:
        // the decoded content must differ (or fail its CRC check).
        const middle = Math.floor(bytes.length / 2);
        bytes[middle] = bytes[middle]! ^ 0xff;
        writeFileSync(sourcePath, bytes);
        await expect(verifyCandidateDirectory(created.candidateDirectory)).rejects.toThrow(
            /source/i
        );
    });

    it('rejects tampered source digests and unknown receipt fields', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        const receiptPath = join(created.candidateDirectory, 'receipt.json');
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
        writeFileSync(
            receiptPath,
            JSON.stringify({ ...receipt, packageTreeSha256: `sha256-${'0'.repeat(64)}` })
        );
        await expect(verifyCandidateDirectory(created.candidateDirectory)).rejects.toThrow(/package\.zip|provenance|digest/i);
        writeFileSync(receiptPath, JSON.stringify({ ...receipt, injectedField: 'nope' }));
        await expect(verifyCandidateDirectory(created.candidateDirectory)).rejects.toThrow(/unknown field/);
    });
});

describe('parseCandidateReceipt', () => {
    it('rejects malformed identities and oversized input', () => {
        const root = track(makePackage());
        return createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        }).then((created) => {
            const base = JSON.parse(JSON.stringify(created.receipt)) as Record<string, unknown>;
            expect(() => parseCandidateReceipt({ ...base, schemaVersion: 99 })).toThrow(/schema/);
            expect(() => parseCandidateReceipt({ ...base, pluginId: 'BAD ID!' })).toThrow(/pluginId/);
            expect(() => parseCandidateReceipt({ ...base, archiveSha256: 'nope' })).toThrow(/digest/);
            expect(() =>
                parseCandidateReceipt({ ...base, version: 'x'.repeat(65) })
            ).toThrow(/version/);
        });
    });

    it('records SDK artifact bytes, not just the version string', () => {
        const first = hashSdkArtifact();
        const second = hashSdkArtifact();
        expect(first.sdkArtifactSha256).toBe(second.sdkArtifactSha256);
        expect(first.sdkArtifactSha256).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(first.sdkArtifactSha256).not.toContain(first.sdkVersion);
    });
});

describe('parseDeveloperVerificationReceipt', () => {
    it('binds scope and outcome to one candidate receipt digest', () => {
        const receipt = parseDeveloperVerificationReceipt({
            schemaVersion: 1,
            candidateReceiptSha256: `sha256-${'a'.repeat(64)}`,
            hostBuild: 'or3-chat dev (basic-auth+sqlite)',
            hostFeatures: ['or3-portable-client-v1'],
            scope: 'runtime-canary',
            outcome: 'passed',
            recordedAt: new Date(0).toISOString(),
        });
        expect(receipt.scope).toBe('runtime-canary');
        expect(() =>
            parseDeveloperVerificationReceipt({ ...receipt, scope: 'trusted-review' })
        ).toThrow(/scope/);
        expect(() =>
            parseDeveloperVerificationReceipt({ ...receipt, extra: 1 })
        ).toThrow(/unknown field/);
    });
});

describe('qualifyCandidateDirectory', () => {
    it('passes a clean rebuild of the exact recorded inputs', async () => {
        const root = track(makePackage());
        const created = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        const qualified = await qualifyCandidateDirectory(root, created.candidateDirectory, {
            probeSourceControl: CLEAN_PROBE,
        });
        expect(qualified.receiptSha256).toBe(candidateReceiptSha256(created.receipt));
    });

    it('refuses dirty snapshots, moved revisions and changed bytes', async () => {
        const root = track(makePackage());
        const dirty = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: () => ({ revision: 'abc123def456', dirty: true }),
        });
        await expect(
            qualifyCandidateDirectory(root, dirty.candidateDirectory, {
                probeSourceControl: () => ({ revision: 'abc123def456', dirty: true }),
            })
        ).rejects.toThrow(/dirty/);

        const clean = await createV2Candidate(root, {
            outputDirectory: track(makeOut()),
            probeSourceControl: CLEAN_PROBE,
        });
        await expect(
            qualifyCandidateDirectory(root, clean.candidateDirectory, {
                probeSourceControl: () => ({ revision: 'other-revision', dirty: false }),
            })
        ).rejects.toThrow(/exact clean source commit/);

        appendFileSync(join(root, 'client.mjs'), '// drift\n');
        await expect(
            qualifyCandidateDirectory(root, clean.candidateDirectory, { probeSourceControl: CLEAN_PROBE })
        ).rejects.toThrow(/different bytes|exact clean source commit/);
    });
});

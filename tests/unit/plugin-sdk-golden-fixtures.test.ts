import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    PackageTreeValidationError,
    verifyCanonicalPackageEntries,
    verifyPackageTree,
    type PackageTreeEntryInput,
} from '../../server/admin/plugins/package-tree';
import { checkV2PackageConformance } from '../../scripts/plugin-runtime/check-v2-package-conformance';
import { inspectV2Package } from '../../scripts/plugin-runtime/cli/inspect';
import { packV2Package } from '../../scripts/plugin-runtime/cli/pack';
import {
    readPackageZip,
    writeDeterministicPackageZip,
} from '../../shared/plugins/package-archive';

const repoRoot = resolve(import.meta.dirname, '../..');
const goldenRoot = resolve(repoRoot, 'tests/plugin-runtime/golden');

interface ExpectedFile {
    readonly formatVersion: number;
    readonly validPortable: {
        readonly root: string;
        readonly digest: string;
        readonly manifestDigest: string;
        readonly entryCount: number;
        readonly manifestId: string | null;
        readonly manifestVersion: number | null;
        readonly conformanceStatus: string;
    };
    readonly invalidTrees: Record<
        string,
        {
            readonly root: string;
            readonly errorCode: string;
            readonly conformanceCode: string;
            readonly conformanceStatus: string;
        }
    >;
}

// The committed canonical-results file is the single source of truth for every
// golden digest. Never hardcode a digest in this test.
const expected = JSON.parse(
    readFileSync(resolve(goldenRoot, 'expected.json'), 'utf8')
) as ExpectedFile;
const validRoot = resolve(repoRoot, expected.validPortable.root);
const invalidTree = expected.invalidTrees['manifest-integrity-mismatch']!;
const invalidRoot = resolve(repoRoot, invalidTree.root);

const tempRoots: string[] = [];

afterAll(() => {
    while (tempRoots.length) {
        const root = tempRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const root = mkdtempSync(resolve(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

function errorCode(error: unknown): string | undefined {
    return error instanceof PackageTreeValidationError
        ? error.code
        : (error as { code?: string } | null)?.code;
}

async function asyncErrorCode(action: () => Promise<unknown>): Promise<string | undefined> {
    try {
        await action();
        return undefined;
    } catch (error) {
        return errorCode(error);
    }
}

function syncErrorCode(action: () => unknown): string | undefined {
    try {
        action();
        return undefined;
    } catch (error) {
        return errorCode(error);
    }
}

function file(
    path: string,
    bytes: Uint8Array = Buffer.from('x'),
    mode = 0o644
): PackageTreeEntryInput {
    return { path, kind: 'file', mode, bytes };
}

describe('golden package fixtures', () => {
    it('host verifyPackageTree matches the committed canonical results', async () => {
        const verified = await verifyPackageTree(validRoot);
        expect(verified.digest).toBe(expected.validPortable.digest);
        expect(verified.manifestDigest).toBe(expected.validPortable.manifestDigest);
        expect(verified.entryCount).toBe(expected.validPortable.entryCount);
        expect(verified.manifestId).toBe(expected.validPortable.manifestId);
        expect(verified.manifestVersion).toBe(expected.validPortable.manifestVersion);
        expect(verified.declaredManifestIntegrity).toBe(expected.validPortable.digest);
    });

    it('packer pack and inspect agree with the host identity', async () => {
        const pack = await packV2Package(validRoot, {
            outputDirectory: resolve(tempDir('or3-golden-pack-'), 'pack'),
        });
        expect(pack.verification.digest).toBe(expected.validPortable.digest);
        expect(pack.verification.manifestDigest).toBe(expected.validPortable.manifestDigest);
        expect(pack.verification.entryCount).toBe(expected.validPortable.entryCount);

        const copy = resolve(tempDir('or3-golden-inspect-'), 'valid-portable');
        cpSync(validRoot, copy, { recursive: true });
        const inspected = await inspectV2Package(copy, { repoRoot });
        expect(inspected.digest).toBe(expected.validPortable.digest);
        expect(inspected.manifestDigest).toBe(expected.validPortable.manifestDigest);
        expect(inspected.conformanceStatus).toBe(expected.validPortable.conformanceStatus);
    });

    it('deterministic archive round-trips to the tree digest and .or3pkg equals .zip', async () => {
        const archiveBytes = await writeDeterministicPackageZip(validRoot);
        const extracted = tempDir('or3-golden-extract-');
        const read = await readPackageZip(archiveBytes, { extractDirectory: extracted });
        expect(read.digest).toBe(expected.validPortable.digest);
        expect(read.entries).toBe(expected.validPortable.entryCount);

        const or3pkg = resolve(tempDir('or3-golden-or3pkg-'), 'package.or3pkg');
        const zip = resolve(tempDir('or3-golden-zip-'), 'package.zip');
        await packV2Package(validRoot, {
            outputDirectory: resolve(tempDir('or3-golden-pack-a-'), 'pack'),
            archivePath: or3pkg,
        });
        await packV2Package(validRoot, {
            outputDirectory: resolve(tempDir('or3-golden-pack-b-'), 'pack'),
            archivePath: zip,
        });
        const or3pkgBytes = readFileSync(or3pkg);
        const zipBytes = readFileSync(zip);
        expect(or3pkgBytes.equals(zipBytes)).toBe(true);

        const inspectedArchive = await inspectV2Package(or3pkg, { repoRoot });
        expect(inspectedArchive.digest).toBe(expected.validPortable.digest);
        expect(inspectedArchive.manifestDigest).toBe(expected.validPortable.manifestDigest);
    });

    it('reviewer conformance agrees for the valid portable fixture', async () => {
        const result = await checkV2PackageConformance(validRoot, { repoRoot });
        expect(result.status).toBe(expected.validPortable.conformanceStatus);
        expect(result.issues).toEqual([]);
        expect(result.digest).toBe(expected.validPortable.digest);
        expect(result.manifestDigest).toBe(expected.validPortable.manifestDigest);
    });

    it('invalid tree reports the declared canonical error through host and packer', async () => {
        const hostCode = await asyncErrorCode(() => verifyPackageTree(invalidRoot));
        expect(hostCode).toBe(invalidTree.errorCode);

        const packCode = await asyncErrorCode(() =>
            packV2Package(invalidRoot, {
                outputDirectory: resolve(tempDir('or3-golden-invalid-pack-'), 'pack'),
            })
        );
        expect(packCode).toBe(invalidTree.errorCode);

        const archiveCode = await asyncErrorCode(() =>
            writeDeterministicPackageZip(invalidRoot)
        );
        expect(archiveCode).toBe(invalidTree.errorCode);

        const canonicalCode = syncErrorCode(() =>
            verifyCanonicalPackageEntries([
                file(
                    'or3.manifest.json',
                    Buffer.from(readFileSync(resolve(invalidRoot, 'or3.manifest.json')))
                ),
            ])
        );
        expect(canonicalCode).toBe(invalidTree.errorCode);

        // The reviewer hashes the exact artifact it reviews, so a tampered
        // integrity field surfaces with the same canonical code the host,
        // packer and archive produce.
        const review = await checkV2PackageConformance(invalidRoot, { repoRoot });
        expect(review.status).toBe(invalidTree.conformanceStatus);
        expect(review.issues.map((entry) => entry.code)).toContain(
            invalidTree.conformanceCode
        );
        expect(review.digest).toBeNull();
        expect(review.manifestDigest).toBeNull();

        // Removing the tampered field proves it was the only difference from the
        // valid tree, and that integrity.package is excluded from the tree digest.
        const stripped = resolve(tempDir('or3-golden-stripped-'), 'invalid');
        cpSync(invalidRoot, stripped, { recursive: true });
        const manifestPath = resolve(stripped, 'or3.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        delete manifest.integrity;
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const strippedVerified = await verifyPackageTree(stripped);
        expect(strippedVerified.digest).toBe(expected.validPortable.digest);
        expect(strippedVerified.manifestDigest).toBe(expected.validPortable.manifestDigest);
    });

});

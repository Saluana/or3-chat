import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyPackageTree } from '../../server/admin/plugins/package-tree';

const repoRoot = resolve(import.meta.dirname, '../..');

// Golden digests lock the canonical implementation's byte-level behaviour.
// Captured from the pre-move implementation; they must not change without an
// explicit package-format version bump.
const GOLDEN_FIXTURES = [
    {
        root: 'tests/plugin-runtime/v2-conformance/valid',
        digest: 'sha256-057b74a84c8bf6ab9366e19609af833659d92e916e826df3354baae5e655139e',
        manifestDigest: 'sha256-173b14cc0bb385413ffad675492f95a4af148333106b98e725ab5aa03ba435d8',
    },
    {
        root: 'packages/plugin-sdk/templates/minimal-v2',
        digest: 'sha256-8c95b2b5665c346d68cb56658c186cf5fdaa116d81a85568b1018fc8860c85de',
        manifestDigest: 'sha256-a4f070a7d5e8e26fa91c73a757538415550c1c9c36ef831a50848f20414bfb8d',
    },
] as const;

describe('canonical package tree implementation', () => {
    it.each(GOLDEN_FIXTURES)('matches the committed golden digest: $root', async (fixture) => {
        const verified = await verifyPackageTree(resolve(repoRoot, fixture.root));
        expect(verified.digest).toBe(fixture.digest);
        expect(verified.manifestDigest).toBe(fixture.manifestDigest);
    });

    // Host code resolves @or3/plugin-sdk from a copied node_modules tree, so an
    // edit to the SDK source that is not reinstalled would silently run stale
    // hashing code. This turns that footgun into a failure with a clear fix.
    it('installed @or3/plugin-sdk copy matches the SDK source', async () => {
        const source = resolve(repoRoot, 'packages/plugin-sdk/src/package-tree.ts');
        const installed = resolve(repoRoot, 'node_modules/@or3/plugin-sdk/src/package-tree.ts');
        const [sourceBytes, installedBytes] = await Promise.all([
            readFile(source, 'utf8'),
            readFile(installed, 'utf8'),
        ]);
        expect(installedBytes, 'node_modules/@or3/plugin-sdk is stale; run `bun install`').toBe(
            sourceBytes
        );
    });
});

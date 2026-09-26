import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyPackageTree } from '../../server/admin/plugins/package-tree';

const repoRoot = resolve(import.meta.dirname, '../..');

// Golden digests lock the canonical implementation's byte-level behaviour.
// Captured from the canonical implementation. Update a digest only when the
// corresponding fixture bytes intentionally change; an algorithm change still
// requires an explicit package-format version bump.
const GOLDEN_FIXTURES = [
    {
        root: 'tests/plugin-runtime/v2-conformance/valid',
        digest: 'sha256-b06b3156f5ae90d3eff5367a0fa16ee0642ca4101bfe2e08afd8e9a8ebad9c46',
        manifestDigest: 'sha256-173b14cc0bb385413ffad675492f95a4af148333106b98e725ab5aa03ba435d8',
    },
    {
        root: 'packages/plugin-sdk/templates/minimal-v2',
        digest: 'sha256-c33cf020e185f050689916619ed399cc75ffa2341b91d8d58bbb6958577a4b8a',
        manifestDigest: 'sha256-a4f070a7d5e8e26fa91c73a757538415550c1c9c36ef831a50848f20414bfb8d',
    },
] as const;

describe('canonical package tree implementation', () => {
    it.each(GOLDEN_FIXTURES)('matches the committed golden digest: $root', async (fixture) => {
        const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'or3-package-golden-'));
        try {
            // Generated directories (such as dist) are ignored by Git but change
            // the package digest. Verify the tracked fixture bytes in isolation.
            const tracked = execFileSync('git', ['ls-files', '-z', '--', fixture.root], {
                cwd: repoRoot,
            }).toString('utf8').split('\0').filter(Boolean);
            expect(tracked.length).toBeGreaterThan(0);
            for (const path of tracked) {
                const destination = resolve(temporaryRoot, path.slice(fixture.root.length + 1));
                mkdirSync(dirname(destination), { recursive: true });
                cpSync(resolve(repoRoot, path), destination);
            }
            const verified = await verifyPackageTree(temporaryRoot);
            expect(verified.digest).toBe(fixture.digest);
            expect(verified.manifestDigest).toBe(fixture.manifestDigest);
        } finally {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
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

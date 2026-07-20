import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    PackageTreeValidationError,
    verifyCanonicalPackageEntries,
    verifyPackageTree,
    type PackageTreeEntryInput,
} from '../package-tree';

const manifest = Buffer.from('{"manifestVersion":2,"kind":"plugin","id":"example"}');

function entries(...extra: PackageTreeEntryInput[]): PackageTreeEntryInput[] {
    return [
        { path: 'or3.manifest.json', kind: 'file', mode: 0o100644, bytes: manifest },
        ...extra,
    ];
}

function expectCode(action: () => unknown, code: string): void {
    try {
        action();
        throw new Error('Expected package validation to fail');
    } catch (error) {
        expect(error).toBeInstanceOf(PackageTreeValidationError);
        expect((error as PackageTreeValidationError).code).toBe(code);
    }
}

describe('canonical package tree validation', () => {
    it.each(['../escape.mjs', '/absolute.mjs', 'C:\\escape.mjs'])(
        'rejects traversal or absolute path %s',
        (path) => expectCode(() => verifyCanonicalPackageEntries(entries({ path, kind: 'file', mode: 0o644 })), 'path-traversal')
    );

    it('detects duplicate normalized paths before accepting noncanonical spelling', () => {
        expectCode(
            () => verifyCanonicalPackageEntries(entries(
                { path: 'client.mjs', kind: 'file', mode: 0o644 },
                { path: 'ui/../client.mjs', kind: 'file', mode: 0o644 }
            )),
            'duplicate-path'
        );
    });

    it('rejects case-fold and Unicode-normalization collisions', () => {
        expectCode(
            () => verifyCanonicalPackageEntries(entries(
                { path: 'UI/Panel.mjs', kind: 'file', mode: 0o644 },
                { path: 'ui/panel.mjs', kind: 'file', mode: 0o644 }
            )),
            'case-fold-collision'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(entries(
                { path: 'caf\u00e9.mjs', kind: 'file', mode: 0o644 },
                { path: 'cafe\u0301.mjs', kind: 'file', mode: 0o644 }
            )),
            'duplicate-path'
        );
    });

    it.each([
        ['symlink', 'symlink'],
        ['device', 'unsupported-file-type'],
        ['socket', 'unsupported-file-type'],
        ['fifo', 'unsupported-file-type'],
    ] as const)('rejects %s entries', (kind, code) => {
        expectCode(
            () => verifyCanonicalPackageEntries(entries({ path: 'unsafe', kind, mode: 0o644 })),
            code
        );
    });

    it('binds executable mode class and byte length into the digest', () => {
        const plain = verifyCanonicalPackageEntries(entries({
            path: 'client.mjs', kind: 'file', mode: 0o100644, bytes: Buffer.from('x'), declaredLength: 1,
        }));
        const executable = verifyCanonicalPackageEntries(entries({
            path: 'client.mjs', kind: 'file', mode: 0o100755, bytes: Buffer.from('x'), declaredLength: 1,
        }));
        expect(plain.digest).not.toBe(executable.digest);
        expectCode(
            () => verifyCanonicalPackageEntries(entries({
                path: 'client.mjs', kind: 'file', mode: 0o100644, bytes: Buffer.from('x'), declaredLength: 2,
            })),
            'length-invalid'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(entries({
                path: 'client.mjs', kind: 'file', mode: 0o104644, bytes: Buffer.from('x'),
            })),
            'unsafe-mode'
        );
    });

    it('is deterministic across input order and non-executable permission detail', () => {
        const first = verifyCanonicalPackageEntries(entries(
            { path: 'z.mjs', kind: 'file', mode: 0o100644, bytes: Buffer.from('z') },
            { path: 'a.mjs', kind: 'file', mode: 0o100600, bytes: Buffer.from('a') }
        ));
        const second = verifyCanonicalPackageEntries(entries(
            { path: 'a.mjs', kind: 'file', mode: 0o100640, bytes: Buffer.from('a') },
            { path: 'z.mjs', kind: 'file', mode: 0o100600, bytes: Buffer.from('z') }
        ));
        expect(first.digest).toBe(second.digest);
    });

    it('omits integrity.package from canonical manifest bytes and verifies it', () => {
        const initial = verifyCanonicalPackageEntries(entries());
        const withIntegrity = Buffer.from(JSON.stringify({
            id: 'example',
            kind: 'plugin',
            manifestVersion: 2,
            integrity: { package: initial.digest },
        }));
        const verified = verifyCanonicalPackageEntries([
            { path: 'or3.manifest.json', kind: 'file', mode: 0o644, bytes: withIntegrity },
        ]);
        expect(verified.digest).toBe(initial.digest);
        expect(verified.declaredManifestIntegrity).toBe(initial.digest);

        const wrongIntegrity = Buffer.from(withIntegrity.toString().replace(initial.digest, `sha256-${'f'.repeat(64)}`));
        expectCode(
            () => verifyCanonicalPackageEntries([
                { path: 'or3.manifest.json', kind: 'file', mode: 0o644, bytes: wrongIntegrity },
            ]),
            'manifest-integrity-mismatch'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(entries(), { expectedDigest: `sha256-${'0'.repeat(64)}` }),
            'digest-mismatch'
        );
    });
});

describe('filesystem package tree verification', () => {
    function packageRoot(): string {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-package-tree-'));
        writeFileSync(resolve(root, 'or3.manifest.json'), manifest);
        writeFileSync(resolve(root, 'client.mjs'), 'export default 1;\n');
        return root;
    }

    it('hashes a real tree without following symlinks', async () => {
        const root = packageRoot();
        const verified = await verifyPackageTree(root);
        expect(verified.digest).toMatch(/^sha256-[a-f0-9]{64}$/);
        symlinkSync(resolve(root, 'client.mjs'), resolve(root, 'linked.mjs'));
        await expect(verifyPackageTree(root)).rejects.toMatchObject({ code: 'symlink' });
    });

    it('enforces entry, file, package, and path limits', () => {
        expectCode(
            () => verifyCanonicalPackageEntries(
                entries({ path: 'x', kind: 'file', mode: 0o644 }),
                { limits: { maximumEntries: 1 } }
            ),
            'too-many-entries'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(
                entries({ path: 'x', kind: 'file', mode: 0o644, bytes: Buffer.from('xx') }),
                { limits: { maximumFileBytes: 1 } }
            ),
            'length-invalid'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(
                entries({ path: 'x', kind: 'file', mode: 0o644, bytes: Buffer.from('x') }),
                { limits: { maximumPackageBytes: 1 } }
            ),
            'package-too-large'
        );
        expectCode(
            () => verifyCanonicalPackageEntries(
                entries({ path: 'long-name', kind: 'file', mode: 0o644 }),
                { limits: { maximumPathBytes: 4 } }
            ),
            'length-invalid'
        );
    });
});

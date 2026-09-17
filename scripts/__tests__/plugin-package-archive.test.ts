import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Zip, ZipPassThrough, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import {
    PackageTreeValidationError,
    verifyPackageTree,
} from '../../server/admin/plugins/package-tree';
import {
    readPackageZip,
    writeDeterministicPackageZip,
} from '../../shared/plugins/package-archive';
import { inspectV2Package } from '../plugin-runtime/cli/inspect';
import { packV2Package } from '../plugin-runtime/cli/pack';

const repoRoot = resolve(import.meta.dirname, '../..');
const validFixture = resolve(repoRoot, 'tests/plugin-runtime/v2-conformance/valid');
const tempRoots: string[] = [];

afterEach(() => {
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

function copyFixture(prefix: string): string {
    const root = resolve(tempDir(prefix), 'plugin');
    cpSync(validFixture, root, { recursive: true });
    return root;
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    try {
        await action();
    } catch (error) {
        expect(error).toBeInstanceOf(PackageTreeValidationError);
        expect((error as PackageTreeValidationError).code).toBe(code);
        return;
    }
    throw new Error(`Expected package validation failure with code ${code}`);
}

/** Builds a raw ZIP so tests can express hostile entry names fflate's object API cannot. */
function buildRawZip(entries: ReadonlyArray<{ name: string; data?: Uint8Array }>): Uint8Array {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, chunk) => {
        if (error) throw error;
        chunks.push(chunk);
    });
    for (const entry of entries) {
        const stream = new ZipPassThrough(entry.name);
        stream.mtime = new Date(1980, 0, 1);
        archive.add(stream);
        stream.push(entry.data ?? new Uint8Array(0), true);
    }
    archive.end();
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

const manifestBytes = readFileSync(resolve(validFixture, 'or3.manifest.json'));

describe('deterministic package archive', () => {
    it('produces byte-identical output for repeated exports of a nested fixture', async () => {
        const first = await writeDeterministicPackageZip(validFixture);
        const second = await writeDeterministicPackageZip(validFixture);
        expect(first[0]).toBe(0x50);
        expect(first[1]).toBe(0x4b);
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });

    it('round-trips nested, non-ASCII, and empty directories to the same digest', async () => {
        const tree = copyFixture('or3-archive-roundtrip-');
        mkdirSync(resolve(tree, 'empty-dir'), { recursive: true });
        mkdirSync(resolve(tree, 'unicode/空'), { recursive: true });
        writeFileSync(resolve(tree, 'unicode/空/数据.txt'), 'こんにちは');

        const verified = await verifyPackageTree(tree);
        const bytes = await writeDeterministicPackageZip(tree);
        const extracted = tempDir('or3-archive-extract-');
        const read = await readPackageZip(bytes, { extractDirectory: extracted });

        expect(read.digest).toBe(verified.digest);
        expect(read.entries).toBe(verified.entryCount);
        expect(existsSync(resolve(extracted, 'empty-dir'))).toBe(true);
        expect(readFileSync(resolve(extracted, 'unicode/空/数据.txt'), 'utf8')).toBe(
            'こんにちは'
        );
    });

    it('treats .or3pkg and .zip as byte-identical filename aliases', async () => {
        const tree = copyFixture('or3-archive-alias-');
        const output = tempDir('or3-archive-alias-out-');
        const or3pkg = resolve(output, 'package.or3pkg');
        const zip = resolve(output, 'package.zip');
        await packV2Package(tree, {
            archivePath: or3pkg,
            outputDirectory: resolve(tree, 'pack-a'),
        });
        await packV2Package(tree, {
            archivePath: zip,
            outputDirectory: resolve(tree, 'pack-b'),
        });
        expect(readFileSync(or3pkg).equals(readFileSync(zip))).toBe(true);
    });

    it('refuses to export a tree that fails canonical verification', async () => {
        const invalid = tempDir('or3-archive-invalid-');
        writeFileSync(resolve(invalid, 'client.mjs'), 'export default {};\n');
        await expectCode(() => writeDeterministicPackageZip(invalid), 'manifest-missing');

        const symlinked = copyFixture('or3-archive-symlink-');
        symlinkSync('client.mjs', resolve(symlinked, 'link.mjs'));
        await expectCode(() => writeDeterministicPackageZip(symlinked), 'symlink');

        const executable = copyFixture('or3-archive-exec-');
        chmodSync(resolve(executable, 'client.mjs'), 0o755);
        await expectCode(
            () => writeDeterministicPackageZip(executable),
            'unsupported-file-type'
        );
    });

    it('rejects zip-slip, duplicate, case-fold, and oversized entries with canonical codes', async () => {
        const manifest = { name: 'or3.manifest.json', data: manifestBytes };
        await expectCode(
            () =>
                readPackageZip(
                    buildRawZip([manifest, { name: '../escape.mjs', data: new Uint8Array(1) }])
                ),
            'path-traversal'
        );
        await expectCode(
            () =>
                readPackageZip(
                    buildRawZip([
                        manifest,
                        { name: 'dup.txt', data: new Uint8Array(1) },
                        { name: 'dup.txt', data: new Uint8Array(1) },
                    ])
                ),
            'duplicate-path'
        );
        await expectCode(
            () =>
                readPackageZip(
                    buildRawZip([
                        manifest,
                        { name: 'Readme.md', data: new Uint8Array(1) },
                        { name: 'readme.md', data: new Uint8Array(1) },
                    ])
                ),
            'case-fold-collision'
        );
        await expectCode(
            () =>
                readPackageZip(
                    buildRawZip([manifest, { name: 'big.bin', data: new Uint8Array(256) }]),
                    { limits: { maximumFileBytes: 128 } }
                ),
            'length-invalid'
        );
    });

    it('inspects an archive with the same digest as its source root', async () => {
        const tree = copyFixture('or3-archive-inspect-');
        const output = tempDir('or3-archive-inspect-out-');
        const archive = resolve(output, 'package.or3pkg');
        const packed = await packV2Package(tree, { archivePath: archive });
        expect(existsSync(archive)).toBe(true);
        expect(packed.archivePath).toBe(archive);

        const fromRoot = await inspectV2Package(tree, { repoRoot });
        const fromArchive = await inspectV2Package(archive, { repoRoot });
        expect(fromArchive.digest).toBe(fromRoot.digest);
        expect(fromArchive.manifestDigest).toBe(fromRoot.manifestDigest);
        expect(fromArchive.conformanceStatus).toBe(fromRoot.conformanceStatus);
        expect(fromArchive.importedPluginCode).toBe(false);
        expect(fromArchive.statePreflight).toMatchObject({
            status: 'eligible',
            code: 'state-initialization',
        });
    });

    it('inspects an archive by the digest of the artifact it verified', async () => {
        const tree = copyFixture('or3-archive-identity-');
        writeFileSync(resolve(tree, 'client.test.mjs'), 'export default 1;\n');
        mkdirSync(resolve(tree, 'empty-dir'), { recursive: true });
        const verified = await verifyPackageTree(tree);
        const bytes = await writeDeterministicPackageZip(tree);
        const archive = resolve(tempDir('or3-archive-identity-out-'), 'a.or3pkg');
        writeFileSync(archive, bytes);
        const inspected = await inspectV2Package(archive, { repoRoot });
        expect(inspected.digest).toBe(verified.digest);
        expect((await readPackageZip(bytes)).digest).toBe(inspected.digest);

        // A second archive differing only in a non-shipped test file must not
        // collapse to the same digest.
        writeFileSync(resolve(tree, 'client.test.mjs'), 'export default 2;\n');
        const bytesB = await writeDeterministicPackageZip(tree);
        const archiveB = resolve(tempDir('or3-archive-identity-b-'), 'b.or3pkg');
        writeFileSync(archiveB, bytesB);
        const inspectedB = await inspectV2Package(archiveB, { repoRoot });
        expect(inspectedB.digest).not.toBe(inspected.digest);
    });

    // Regressions for a read-only security review of the archive reader.
    it('bounds decompression before inflating, using canonical defaults when no limits are passed', async () => {
        const bomb = zipSync({
            'or3.manifest.json': manifestBytes,
            'bomb.bin': new Uint8Array(5 * 1024 * 1024),
        });
        // The compressed archive is tiny, so only a pre-inflation bound protects memory.
        expect(bomb.byteLength).toBeLessThan(64 * 1024);
        await expectCode(
            () => readPackageZip(bomb, { limits: { maximumFileBytes: 1024 } }),
            'length-invalid'
        );
        await expectCode(
            () => readPackageZip(bomb, { limits: { maximumPackageBytes: 1024 } }),
            'package-too-large'
        );
        // Defaults must be in effect even with no options at all.
        const oversized = zipSync({
            'or3.manifest.json': manifestBytes,
            'big.bin': new Uint8Array(33 * 1024 * 1024),
        });
        await expectCode(() => readPackageZip(oversized), 'length-invalid');
    });

    it('rejects an archive whose local header disagrees with its central directory', async () => {
        const bytes = zipSync({
            'or3.manifest.json': manifestBytes,
            'a.txt': new TextEncoder().encode('payload'),
        });
        const tampered = Buffer.from(bytes);
        const nameAt = tampered.indexOf(Buffer.from('a.txt'), 30);
        expect(nameAt).toBeGreaterThan(0);
        tampered[nameAt] = 'b'.charCodeAt(0);
        await expectCode(() => readPackageZip(tampered), 'length-invalid');
    });

    it('verifies the CRC-32 of decoded entry data', async () => {
        const bytes = Buffer.from(
            zipSync({
                'or3.manifest.json': manifestBytes,
                'a.txt': new TextEncoder().encode('payload payload payload'),
            })
        );
        bytes[bytes.length - 22 - (46 + 12) - 10] ^= 0xff;
        await expectCode(() => readPackageZip(bytes), 'length-invalid');
    });

    // Regressions for the second review pass: a central-directory-only reader
    // could otherwise disagree with a streaming extractor about the same bytes.
    it('rejects a local file record that the central directory does not list', async () => {
        const bytes = Buffer.from(
            zipSync({ 'or3.manifest.json': manifestBytes, 'a.txt': new TextEncoder().encode('hi') })
        );
        const findEocd = (buffer: Buffer): number => {
            for (let index = buffer.length - 22; index >= 0; index -= 1) {
                if (buffer.readUInt32LE(index) === 0x06054b50) return index;
            }
            throw new Error('no end-of-central-directory record');
        };
        const eocd = findEocd(bytes);
        const centralOffset = bytes.readUInt32LE(eocd + 16);
        const name = Buffer.from('ghost.mjs');
        const data = Buffer.from('export const ghost = 1;');
        const local = Buffer.alloc(30 + name.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        name.copy(local, 30);
        const spliced = Buffer.concat([
            bytes.subarray(0, centralOffset),
            local,
            data,
            bytes.subarray(centralOffset),
        ]);
        spliced.writeUInt32LE(centralOffset + local.length + data.length, findEocd(spliced) + 16);
        await expectCode(() => readPackageZip(spliced), 'length-invalid');
    });

    it('rejects local/central flag and data-descriptor disagreements', async () => {
        const bytes = Buffer.from(
            zipSync({ 'or3.manifest.json': manifestBytes, 'a.txt': new TextEncoder().encode('hi') })
        );
        const flagsTampered = Buffer.from(bytes);
        flagsTampered[6] |= 0x08;
        await expectCode(() => readPackageZip(flagsTampered), 'length-invalid');

        const streaming = buildRawZip([
            { name: 'or3.manifest.json', data: manifestBytes },
            { name: 'a.txt', data: new TextEncoder().encode('hi') },
        ]);
        await expect(() => readPackageZip(streaming)).not.toThrow();
        const descriptorTampered = Buffer.from(streaming);
        const centralOffset = descriptorTampered.readUInt32LE(
            (() => {
                for (let index = descriptorTampered.length - 22; index >= 0; index -= 1) {
                    if (descriptorTampered.readUInt32LE(index) === 0x06054b50) return index;
                }
                throw new Error('no end-of-central-directory record');
            })() + 16
        );
        const compressedSize = descriptorTampered.readUInt32LE(centralOffset + 20);
        const dataStart =
            30 +
            descriptorTampered.readUInt16LE(26) +
            descriptorTampered.readUInt16LE(28);
        descriptorTampered[dataStart + compressedSize + 4] ^= 0xff;
        await expectCode(() => readPackageZip(descriptorTampered), 'length-invalid');
    });

    it('refuses to extract into a destination that is not fresh and empty', async () => {
        const bytes = await writeDeterministicPackageZip(validFixture);
        const root = tempDir('or3-archive-root-');
        const outside = tempDir('or3-archive-outside-');
        const destination = resolve(root, 'dest');
        mkdirSync(destination);
        symlinkSync(outside, resolve(destination, 'evil'));
        await expectCode(
            () => readPackageZip(bytes, { extractDirectory: destination }),
            'length-invalid'
        );
        expect(existsSync(resolve(outside, 'client.mjs'))).toBe(false);

        const symlinkedDestination = resolve(root, 'dest-symlink');
        symlinkSync(outside, symlinkedDestination);
        await expectCode(
            () => readPackageZip(bytes, { extractDirectory: symlinkedDestination }),
            'symlink'
        );

        const emptyDestination = resolve(root, 'dest-empty');
        mkdirSync(emptyDestination);
        const read = await readPackageZip(bytes, { extractDirectory: emptyDestination });
        expect(read.extractedRoot).toBe(emptyDestination);
    });

    it('accepts streaming archives that use a trailing data descriptor', async () => {
        const read = await readPackageZip(
            buildRawZip([{ name: 'or3.manifest.json', data: manifestBytes }])
        );
        expect(read.entries).toBe(1);
        await expectCode(
            () =>
                readPackageZip(
                    buildRawZip([
                        { name: 'or3.manifest.json', data: manifestBytes },
                        { name: '../escape.mjs', data: new Uint8Array(1) },
                    ])
                ),
            'path-traversal'
        );
    });
});

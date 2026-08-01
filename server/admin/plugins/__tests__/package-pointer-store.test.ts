import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImmutablePluginPackageStore } from '../package-store';
import {
    PluginPackagePointerStore,
    type PackagePointerWriteStep,
    type PluginPackagePointer,
    type PluginPackagePointerTarget,
} from '../package-pointer-store';

const stateCompatibility = Object.freeze({
    version: 1,
    reads: Object.freeze({ minimum: 1, maximum: 1 }),
    rollback: 'safe' as const,
});

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-pointer-package-'));
    writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify({
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        version,
    }));
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

function target(
    stored: Awaited<ReturnType<ImmutablePluginPackageStore['installPackage']>>,
    recordedAt: number
): PluginPackagePointerTarget {
    return Object.freeze({
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt,
        stateCompatibility,
    });
}

function pointer(
    revision: number,
    current: PluginPackagePointerTarget | null,
    candidate: PluginPackagePointerTarget | null = null,
    previous: PluginPackagePointerTarget | null = null
): PluginPackagePointer {
    return { schemaVersion: 1, pluginId: 'alpha', revision, current, candidate, previous };
}

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-pointer-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const first = target(await packages.installPackage('alpha', source('1.0.0')), 1);
    const second = target(await packages.installPackage('alpha', source('2.0.0')), 2);
    return { root, packages, pointers, first, second };
}

describe('atomic plugin package pointers', () => {
    it.each([
        ['before-temp-write', 'current'] as const,
        ['after-temp-write', 'current'] as const,
        ['after-temp-fsync', 'current'] as const,
        ['after-rename', 'next'] as const,
        ['after-directory-fsync', 'next'] as const,
    ])('restart selects a complete tree after a fault at %s', async (faultStep, expected) => {
        const { root, packages, pointers, first, second } = await setup();
        await pointers.writePointer('alpha', pointer(1, first));
        await expect(pointers.writePointer('alpha', pointer(2, second, null, first), {
            fault(step: PackagePointerWriteStep) {
                if (step === faultStep) throw new Error(`crash:${step}`);
            },
        })).rejects.toThrow(`crash:${faultStep}`);

        const restarted = new PluginPackagePointerStore(root, packages);
        const selection = await restarted.readStartupSelection('alpha');
        expect(selection.status).toBe('ready');
        expect(selection.selected?.packageDigest).toBe(expected === 'current' ? first.packageDigest : second.packageDigest);
    });

    it('falls back to a verified previous tree when current is corrupt', async () => {
        const { packages, pointers, first, second } = await setup();
        await pointers.writePointer('alpha', pointer(1, first));
        await pointers.writePointer('alpha', pointer(2, second, null, first));
        const currentFile = resolve(packages.packagePath('alpha', second.packageDigest), 'client.mjs');
        chmodSync(currentFile, 0o644);
        writeFileSync(currentFile, 'corrupt');

        const selection = await pointers.readStartupSelection('alpha');
        expect(selection).toMatchObject({
            status: 'recovered',
            selectedSlot: 'previous',
            selected: { packageDigest: first.packageDigest },
            issues: expect.arrayContaining([expect.objectContaining({ code: 'current-unavailable' })]),
        });
    });

    it('never selects a candidate at startup and blocks invalid pointer JSON', async () => {
        const { root, pointers, second } = await setup();
        await pointers.writePointer('alpha', pointer(1, null, second));
        expect(await pointers.readStartupSelection('alpha')).toMatchObject({
            status: 'inactive',
            selectedSlot: null,
        });

        writeFileSync(resolve(root, '.active', 'alpha.json'), '{partial');
        expect(await pointers.readStartupSelection('alpha')).toMatchObject({
            status: 'blocked',
            selected: null,
            issues: [{ code: 'pointer-invalid' }],
        });
    });

    it('rejects a pointer whose manifest identity does not match the stored tree', async () => {
        const { pointers, first } = await setup();
        const invalid = {
            ...first,
            manifestDigest: `sha256-${'0'.repeat(64)}` as const,
        };
        await expect(pointers.writePointer('alpha', pointer(1, invalid))).rejects.toMatchObject({
            code: 'package-unavailable',
        });
    });

    it('writes strict single-line pointer JSON', async () => {
        const { root, pointers, first } = await setup();
        await pointers.writePointer('alpha', pointer(1, first));
        const text = readFileSync(resolve(root, '.active', 'alpha.json'), 'utf8');
        expect(text.endsWith('\n')).toBe(true);
        expect(JSON.parse(text)).toEqual(pointer(1, first));
    });

    it('lists only regular valid pointer identities for runtime discovery', async () => {
        const { root, pointers, first } = await setup();
        await pointers.writePointer('alpha', pointer(1, first));
        writeFileSync(resolve(root, '.active', 'invalid id.json'), '{}');
        writeFileSync(resolve(root, '.active', 'beta.tmp'), '{}');

        await expect(pointers.listPluginIds()).resolves.toEqual(['alpha']);
    });

    it('rejects stale or skipped pointer revisions without replacing current', async () => {
        const { pointers, first, second } = await setup();
        await pointers.writePointer('alpha', pointer(1, first));
        await expect(pointers.writePointer('alpha', pointer(1, second))).rejects.toMatchObject({
            code: 'pointer-invalid',
        });
        await expect(pointers.writePointer('alpha', pointer(3, second))).rejects.toMatchObject({
            code: 'pointer-invalid',
        });
        expect(await pointers.readStartupSelection('alpha')).toMatchObject({
            status: 'ready',
            selected: { packageDigest: first.packageDigest },
        });
    });
});

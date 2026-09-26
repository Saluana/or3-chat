import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImmutablePluginPackageStore } from '../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../admin/plugins/package-pointer-store';
import { bindCandidateOperation, resolvePluginPackage } from '../discovery';
import type { PluginAcquisitionOperation } from '~~/shared/plugins/acquisition/contracts';

const PLUGIN_ID = 'or3.discovery-test';

const mocks = vi.hoisted(() => ({
    listInstalledExtensions: vi.fn(),
    listOperations: vi.fn(),
}));

vi.mock('../../acquisition/operation-store', () => ({
    PluginAcquisitionOperationStore: class {
        list(...args: unknown[]) { return mocks.listOperations(...args); }
    },
}));

vi.mock('../../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: mocks.listInstalledExtensions,
}));

const stateCompatibility = Object.freeze({
    version: 1,
    reads: Object.freeze({ minimum: 1, maximum: 1 }),
    rollback: 'safe' as const,
});

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-discovery-package-'));
    writeFileSync(
        resolve(root, 'or3.manifest.json'),
        JSON.stringify({
            manifestVersion: 2,
            kind: 'plugin',
            id: PLUGIN_ID,
            version,
        })
    );
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-discovery-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const current = await packages.installPackage(PLUGIN_ID, source('1.0.0'));
    const candidate = await packages.installPackage(PLUGIN_ID, source('2.0.0'));
    return { root, packages, pointers, current, candidate };
}

function target(
    stored: Awaited<ReturnType<ImmutablePluginPackageStore['installPackage']>>
) {
    return {
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt: 1,
        stateCompatibility,
    };
}

/** Corrupt one byte of an installed, read-only package tree. */
function corruptPackage(packages: ImmutablePluginPackageStore, digest: string): void {
    const file = resolve(packages.packagePath(PLUGIN_ID, digest as never), 'client.mjs');
    chmodSync(file, 0o644);
    writeFileSync(file, 'corrupt');
}

function legacyExtension(id: string) {
    return { kind: 'plugin', id, path: `/legacy/${id}` };
}

beforeEach(() => {
    mocks.listInstalledExtensions.mockReset().mockResolvedValue([]);
    mocks.listOperations.mockReset().mockResolvedValue([]);
});

describe('candidate setup binding', () => {
    it('allows the same update operation in an enabled second workspace only', async () => {
        const digest = `sha256-${'a'.repeat(64)}` as `sha256-${string}`;
        mocks.listOperations.mockResolvedValue([{
            pluginId: PLUGIN_ID,
            workspaceId: 'ws-a',
            candidateDigest: digest,
            operationId: 'acq_update',
            status: 'paused',
        } satisfies Partial<PluginAcquisitionOperation>]);
        const settingsStore = {
            async get(workspaceId: string, key: string) {
                return key === 'plugins.enabled' && workspaceId === 'ws-b' ? JSON.stringify([PLUGIN_ID]) : null;
            },
            async set() {},
        };
        await expect(bindCandidateOperation({ pluginId: PLUGIN_ID, workspaceId: 'ws-b', candidateDigest: digest, settingsStore }))
            .resolves.toEqual({ ok: true, operationId: 'acq_update' });
        await expect(bindCandidateOperation({ pluginId: PLUGIN_ID, workspaceId: 'ws-c', candidateDigest: digest, settingsStore }))
            .resolves.toMatchObject({ ok: false, code: 'setup-operation-conflict' });
    });
});

describe('plugin package discovery slots', () => {
    it('prefers the pending candidate for setup and resolves it by default', async () => {
        const { root, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: target(candidate),
            previous: null,
        });

        const resolved = await resolvePluginPackage(PLUGIN_ID, root);
        expect(resolved).toMatchObject({
            status: 'candidate',
            selectedSlot: 'candidate',
            digest: candidate.digest,
            manifestDigest: candidate.verification.manifestDigest,
            pointerRevision: 1,
        });
    });

    it('resolves only the running selection for runtime settings', async () => {
        const { root, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: target(candidate),
            previous: null,
        });

        const resolved = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(resolved).toMatchObject({
            status: 'ready',
            selectedSlot: 'current',
            digest: current.digest,
        });
    });

    it('reports a candidate-only pointer as inactive for runtime reads but selectable for setup', async () => {
        const { root, pointers, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: null,
            candidate: target(candidate),
            previous: null,
        });

        const runtime = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(runtime).toMatchObject({
            status: 'inactive',
            path: null,
            digest: null,
            pointerRevision: 1,
        });
        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto).toMatchObject({ status: 'candidate', digest: candidate.digest });
        // A pointer owns the plugin identity; no legacy lookup may happen.
        expect(mocks.listInstalledExtensions).not.toHaveBeenCalled();
    });

    it('blocks setup on a recorded candidate that no longer verifies', async () => {
        const { root, packages, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: target(candidate),
            previous: null,
        });
        corruptPackage(packages, candidate.digest);

        // Setup must not silently configure the running package when the
        // recorded candidate is the thing being installed.
        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto).toMatchObject({
            status: 'blocked',
            path: null,
            digest: null,
        });
        expect(auto?.issues).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'candidate-unavailable' })])
        );
        // Runtime reads still resolve the running version.
        const runtime = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(runtime).toMatchObject({
            status: 'ready',
            selectedSlot: 'current',
            digest: current.digest,
        });
    });

    it('does not reconstruct recovery for a pointer with no current slot', async () => {
        const { root, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: null,
            candidate: target(candidate),
            previous: target(current),
        });

        // The verifier reports inactive (no selected target); a valid previous
        // slot alone must not become a running selection.
        const runtime = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(runtime).toMatchObject({ status: 'inactive', path: null, digest: null });
        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto).toMatchObject({ status: 'candidate', digest: candidate.digest });
    });

    it('honors recovery to the previous version for runtime reads and auto setup', async () => {
        const { root, packages, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(candidate),
            candidate: null,
            previous: target(current),
        });
        corruptPackage(packages, candidate.digest);

        const runtime = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(runtime).toMatchObject({
            status: 'recovered',
            selectedSlot: 'previous',
            digest: current.digest,
            manifestDigest: current.verification.manifestDigest,
        });
        expect(runtime?.issues).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'current-unavailable' })])
        );

        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto).toMatchObject({ status: 'recovered', digest: current.digest });
    });

    it('never falls through to a legacy extension when the V2 pointer is blocked', async () => {
        const { root, packages, pointers, current } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: null,
            previous: null,
        });
        corruptPackage(packages, current.digest);
        mocks.listInstalledExtensions.mockResolvedValue([legacyExtension(PLUGIN_ID)]);

        const runtime = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(runtime).toMatchObject({ status: 'blocked', path: null, digest: null });
        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto).toMatchObject({ status: 'blocked', path: null });
        expect(mocks.listInstalledExtensions).not.toHaveBeenCalled();
    });

    it('blocks a corrupt pointer instead of using a legacy extension with the same id', async () => {
        const { root } = await setup();
        const activeRoot = resolve(root, '.active');
        mkdirSync(activeRoot, { recursive: true });
        writeFileSync(resolve(activeRoot, `${PLUGIN_ID}.json`), '{partial');
        mocks.listInstalledExtensions.mockResolvedValue([legacyExtension(PLUGIN_ID)]);

        const resolved = await resolvePluginPackage(PLUGIN_ID, root);
        expect(resolved).toMatchObject({ status: 'blocked', path: null });
        expect(mocks.listInstalledExtensions).not.toHaveBeenCalled();
    });

    it('resolves a legacy extension only when no V2 pointer exists', async () => {
        const { root } = await setup();
        mocks.listInstalledExtensions.mockResolvedValue([legacyExtension(PLUGIN_ID)]);

        const resolved = await resolvePluginPackage(PLUGIN_ID, root);
        expect(resolved).toMatchObject({
            status: 'legacy',
            source: 'extension',
            path: `/legacy/${PLUGIN_ID}`,
            digest: null,
            manifestDigest: null,
        });
    });

    it('prefers the V2 selection when a legacy extension has the same id', async () => {
        const { root, pointers, current } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: null,
            previous: null,
        });
        mocks.listInstalledExtensions.mockResolvedValue([legacyExtension(PLUGIN_ID)]);

        const resolved = await resolvePluginPackage(PLUGIN_ID, root);
        expect(resolved).toMatchObject({
            status: 'ready',
            source: 'package',
            digest: current.digest,
        });
        expect(mocks.listInstalledExtensions).not.toHaveBeenCalled();
    });
});

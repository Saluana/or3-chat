import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeDeterministicPackageZip } from '@or3/plugin-sdk/package-archive';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import type { ReleaseMetadataDocument } from '~~/shared/plugins/acquisition/release-metadata';
import { pluginPackageServices } from '../../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../../admin/plugins/package-route-catalog';
import { verifyPackageTree } from '../../../../admin/plugins/package-tree';
import { setPluginEnabled } from '../../../../admin/plugins/workspace-plugin-store';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import { setupValuesKey } from '../../setup/settings-store';
import { PluginAcquisitionOperationStore } from '../operation-store';
import { RegistryClient } from '../registry-client';
import { signReleaseMetadataForTest } from '../release-verify';
import { PluginAcquisitionService, type AcquisitionServiceDeps } from '../acquisition-service';
import type { AcquisitionConfig, MarketplaceReleaseKey } from '../config';

const ORIGIN = 'https://market.example';
const RELEASE_ID = 'rel_alpha_1';
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) await forceRemove(root);
});

/** The immutable store chmods package trees read-only; undo that before cleanup. */
async function forceRemove(root: string): Promise<void> {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const target = join(root, entry.name);
        if (entry.isDirectory()) {
            await forceRemove(target);
        } else {
            await fs.chmod(target, 0o644).catch(() => undefined);
        }
    }
    await fs.chmod(root, 0o755).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function tempRoot(prefix = 'or3-acquisition-'): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

function memoryStore(): WorkspaceSettingsStore {
    const values = new Map<string, string>();
    return {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
    };
}

async function makeKey(): Promise<{ key: MarketplaceReleaseKey; privateKeyBase64: string }> {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
        'sign',
        'verify',
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    let binary = '';
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    return {
        key: { keyId: 'or3-release', publicJwk: { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x as string } },
        privateKeyBase64: btoa(binary),
    };
}

function manifest(version: string, stateReads = { minimum: 1, maximum: 1 }) {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        name: 'Alpha',
        version,
        capabilities: [],
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            server: { routes: [{ method: 'GET', path: 'health', handler: 'server/health.get.mjs' }] },
        },
        requestedGrants: [],
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: { version: 1, reads: stateReads, rollback: 'safe' as const },
    };
}

function setupDescriptor() {
    return {
        setupVersion: 1,
        settingsSchemaPath: 'or3.settings.schema.json',
        fields: [{ key: 'token', label: 'Token', kind: 'text', required: true, order: 1 }],
        connections: [],
        firstAction: { operationId: 'run', label: 'Run', usesSampleContext: false },
    };
}

function packageTree(input: { version: string; setup?: boolean; stateReads?: { minimum: number; maximum: number } }): string {
    const root = tempRoot('or3-package-');
    mkdirSync(join(root, 'server'), { recursive: true });
    writeFileSync(join(root, 'or3.manifest.json'), JSON.stringify(manifest(input.version, input.stateReads)));
    writeFileSync(join(root, 'server', 'health.get.mjs'), 'export default async () => ({ ok: true });\n');
    if (input.setup) writeFileSync(join(root, 'or3.setup.json'), JSON.stringify(setupDescriptor()));
    return root;
}

function baseDocument(overrides: Partial<ReleaseMetadataDocument> = {}): ReleaseMetadataDocument {
    return {
        schemaVersion: 1,
        releaseId: RELEASE_ID,
        pluginId: 'alpha',
        publisherNamespace: 'acme',
        version: '1.0.0',
        archiveSha256: `sha256-${'a'.repeat(64)}`,
        packageTreeSha256: `sha256-${'b'.repeat(64)}`,
        manifestSha256: `sha256-${'c'.repeat(64)}`,
        authoritySha256: `sha256-${'d'.repeat(64)}`,
        sourceSha256: `sha256-${'e'.repeat(64)}`,
        profile: 'or3-portable-client-v1',
        engines: { or3: '>=0.3.0', pluginApi: '>=2.0.0' },
        features: [],
        requestedGrants: [],
        reviewId: 'rev_1',
        license: 'MIT',
        publishedAt: new Date(Date.now() - 60_000).toISOString(),
        ...overrides,
    };
}

interface ReleaseFixture {
    readonly bytes: Uint8Array;
    readonly signed: unknown;
    readonly treeDigest: string;
    readonly key: MarketplaceReleaseKey;
    readonly privateKeyBase64: string;
}

async function release(input: {
    version: string;
    setup?: boolean;
    stateReads?: { minimum: number; maximum: number };
}): Promise<ReleaseFixture> {
    const generated = await makeKey();
    const tree = packageTree(input);
    const verification = await verifyPackageTree(tree);
    const bytes = await writeDeterministicPackageZip(tree);
    const archiveSha256 = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    const signed = await signReleaseMetadataForTest({
        document: baseDocument({
            version: input.version,
            archiveSha256: archiveSha256 as `sha256-${string}`,
            packageTreeSha256: verification.digest,
            manifestSha256: verification.manifestDigest,
        }),
        keyId: generated.key.keyId,
        privateKeyBase64: generated.privateKeyBase64,
    });
    return {
        bytes,
        signed,
        treeDigest: verification.digest,
        key: generated.key,
        privateKeyBase64: generated.privateKeyBase64,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function transportFor(
    fixture: ReleaseFixture,
    options: { failDownload?: () => boolean } = {}
): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const target = String(input);
        if (target.endsWith('/metadata')) return jsonResponse(fixture.signed);
        if (target.includes('/v1/artifacts/')) {
            if (options.failDownload?.()) throw new Error('connection reset');
            return new Response(new Uint8Array(fixture.bytes), {
                status: 200,
                headers: { 'content-length': String(fixture.bytes.byteLength) },
            });
        }
        return new Response('missing', { status: 404 });
    }) as typeof fetch;
}

function makeHarness(input: {
    fixture: ReleaseFixture;
    workspaceIds?: readonly string[];
    failDownload?: () => boolean;
    installEnabled?: boolean;
}) {
    const root = tempRoot('or3-extensions-');
    const settings = memoryStore();
    const services = pluginPackageServices(settings, root);
    const store = new PluginAcquisitionOperationStore(root);
    const config: AcquisitionConfig = {
        registryOrigin: ORIGIN,
        installEnabled: input.installEnabled ?? true,
        releaseKeys: [input.fixture.key],
        hostOr3Version: '0.3.0',
        hostPluginApiVersion: '2.0.0',
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
    };
    const registry = new RegistryClient({
        registryOrigin: ORIGIN,
        trustRoot: {
            releaseKeys: [input.fixture.key],
            hostOr3Version: '0.3.0',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: 0,
        },
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
        transport: transportFor(input.fixture, { failDownload: input.failDownload }),
        freeDiskBytes: async () => 1024 ** 3,
    });
    const deps: AcquisitionServiceDeps = {
        config,
        store,
        registry,
        services,
        routeCatalog: new PluginPackageRouteCatalog(services.packages, services.pointers),
        listWorkspaceIds: async () => input.workspaceIds ?? ['ws-1'],
        extensionsRoot: root,
    };
    return { service: new PluginAcquisitionService(deps), store, services, settings, root };
}

const request = {
    pluginId: 'alpha',
    workspaceId: 'ws-1',
    requesterUserId: 'user-1',
    instanceId: 'instance-1',
};

describe('reviewed acquisition pipeline (5.1, 5.4)', () => {
    it('resolves, verifies, records a candidate, checks health and promotes one release', async () => {
        const fixture = await release({ version: '1.0.0' });
        const harness = makeHarness({ fixture });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const operation = started.operation;
        expect(operation.status).toBe('completed');
        expect(operation.stage).toBe('receipt-recorded');
        expect(operation.release?.pluginId).toBe('alpha');
        expect(operation.release?.version).toBe('1.0.0');
        expect(operation.candidateDigest).toBe(fixture.treeDigest);
        expect(operation.downloadedBytes).toBe(fixture.bytes.byteLength);
        expect(operation.attempts).toBe(0);
        expect(operation.failure).toBeNull();
        expect(describeAcquisitionStatus(operation).percentComplete).toBe(100);

        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.current?.packageDigest).toBe(fixture.treeDigest);
        expect(pointer?.candidate).toBeNull();
        // The candidate write bumped the pointer to revision 1; promotion
        // followed the recorded revision and produced revision 2.
        expect(operation.expectedPointerRevision).toBe(1);
        expect(pointer?.revision).toBe(2);
    });

    it('records no operation when the instance is not allowed to install', async () => {
        const fixture = await release({ version: '1.0.0' });
        const harness = makeHarness({ fixture, installEnabled: false });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        expect(started.failure.code).toBe('registry-unconfigured');
        expect(await harness.store.list()).toEqual([]);
    });

    it('refuses a release whose version the signed metadata does not declare', async () => {
        const fixture = await release({ version: '1.0.0' });
        const harness = makeHarness({ fixture });

        const started = await harness.service.start({ ...request, version: '9.9.9' });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        expect(started.failure.code).toBe('release-identity-mismatch');
        expect(await harness.store.list()).toEqual([]);
    });
});

describe('recovery and cancellation (5.3)', () => {
    it('resumes an interrupted download under the same operation id', async () => {
        const fixture = await release({ version: '1.0.0' });
        let fail = true;
        const harness = makeHarness({ fixture, failDownload: () => fail });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const operationId = started.operation.operationId;
        expect(started.operation.status).toBe('failed');
        expect(started.operation.failure?.code).toBe('download-failed');
        expect(started.operation.failure?.retryable).toBe(true);
        expect(started.operation.stage).toBe('reserved');

        fail = false;
        const resumed = await harness.service.retry(operationId);
        expect(resumed.operationId).toBe(operationId);
        expect(resumed.status).toBe('completed');
        expect(resumed.attempts).toBe(1);
        expect(resumed.stage).toBe('receipt-recorded');
    });

    it('pauses a first install that needs setup and finishes after setup is saved', async () => {
        const fixture = await release({ version: '1.0.0', setup: true });
        const harness = makeHarness({ fixture });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const paused = started.operation;
        expect(paused.status).toBe('paused');
        expect(paused.stage).toBe('candidate-recorded');
        expect(paused.failure?.code).toBe('setup-required');
        expect(describeAcquisitionStatus(paused).needsSetup).toBe(true);

        // The candidate is recorded but the working pointer is untouched.
        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.candidate?.packageDigest).toBe(fixture.treeDigest);
        expect(pointer?.current).toBeNull();

        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'secret-value' })
        );
        const finished = await harness.service.retry(paused.operationId);
        expect(finished.status).toBe('completed');
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });

    it('cancels a paused operation without promoting', async () => {
        const fixture = await release({ version: '1.0.0', setup: true });
        const harness = makeHarness({ fixture });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');

        const canceled = await harness.service.cancel(started.operation.operationId);
        expect(canceled.status).toBe('canceled');
        expect(canceled.failure?.code).toBe('canceled');
        expect(describeAcquisitionStatus(canceled).canceled).toBe(true);

        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.current).toBeNull();
        expect(pointer?.candidate?.packageDigest).toBe(fixture.treeDigest);
    });
});

describe('instance-wide preflight and conditional promotion (5.5, 5.6)', () => {
    it('keeps an update blocked until an owner disables the incompatible workspace', async () => {
        const fixture = await release({ version: '1.0.0' });
        const harness = makeHarness({ fixture, workspaceIds: ['ws-1', 'ws-2'] });
        await setPluginEnabled(harness.settings, 'ws-1', 'alpha', true);
        await setPluginEnabled(harness.settings, 'ws-2', 'alpha', true);
        // ws-2 stores a state version the candidate cannot read.
        await harness.settings.set('ws-2', 'plugins.stateVersion.alpha', '2');

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('blocked');
        expect(started.operation.failure?.code).toBe('workspace-preflight-blocked');
        expect(started.operation.failure?.retryable).toBe(true);
        expect(started.operation.failure?.message).toContain('ws-2');
        expect((await harness.services.pointers.readPointer('alpha'))?.current).toBeNull();

        await setPluginEnabled(harness.settings, 'ws-2', 'alpha', false);
        const finished = await harness.service.retry(started.operation.operationId);
        expect(finished.status).toBe('completed');
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });

    it('refuses to promote when another admin has moved the candidate', async () => {
        const fixture = await release({ version: '1.0.0', setup: true });
        const harness = makeHarness({ fixture });

        const started = await harness.service.start({ ...request, version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        const paused = started.operation;
        expect(paused.status).toBe('paused');

        // A racing admin records a different candidate for the same plugin.
        const other = await release({ version: '1.0.1' });
        const otherTree = packageTree({ version: '1.0.1' });
        const otherStored = await harness.services.packages.installPackage('alpha', otherTree);
        const pointer = await harness.services.pointers.readPointer('alpha');
        await harness.services.pointers.writePointer('alpha', {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: (pointer?.revision ?? 0) + 1,
            current: pointer?.current ?? null,
            candidate: {
                packageDigest: otherStored.digest,
                manifestDigest: otherStored.verification.manifestDigest,
                recordedAt: 1,
                stateCompatibility: manifest('1.0.1').stateCompatibility,
            },
            previous: pointer?.previous ?? null,
        });
        void other;

        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'x' })
        );
        const result = await harness.service.retry(paused.operationId);
        expect(result.status).not.toBe('completed');
        expect(['health-check-failed', 'pointer-conflict']).toContain(result.failure?.code);

        const after = await harness.services.pointers.readPointer('alpha');
        expect(after?.current).toBeNull();
        expect(after?.candidate?.packageDigest).toBe(otherStored.digest);
    });
});

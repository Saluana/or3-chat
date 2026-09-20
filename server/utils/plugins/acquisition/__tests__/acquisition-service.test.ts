import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    describeAcquisitionStatus,
    type PluginAcquisitionReceipt,
} from '~~/shared/plugins/acquisition/contracts';
import { buildSetupPlan } from '~~/shared/plugins/setup/plan';
import { validateSetupValues } from '~~/shared/plugins/setup/values';
import { computeAuthorityHash, type EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../../admin/plugins/v2-host-capabilities';
import {
    pluginPackageServices,
    readPackageManifest,
} from '../../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../../admin/plugins/package-route-catalog';
import {
    getEnabledPlugins,
    setPluginEnabled,
    setPluginGrantReview,
} from '../../../../admin/plugins/workspace-plugin-store';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import { loadPackageDescriptors, toEffectiveAuthority } from '../../setup/load-descriptors';
import {
    readSetupValuesFor,
    setupValuesKey,
} from '../../setup/settings-store';
import {
    cleanupRoots,
    fakeRegistryTransport,
    makeKey,
    ORIGIN,
    PORTABLE_PROFILE,
    releaseFixture,
    tempRoot,
    type ReleaseFixture,
    type TestKey,
} from './fixtures';
import { signReleaseMetadataForTest } from '../release-verify';
import type { RegistryAdvisorySnapshot } from '~~/shared/plugins/acquisition/release-metadata';
import { PluginAcquisitionOperationStore } from '../operation-store';
import { RegistryClient } from '../registry-client';
import { PluginAcquisitionService, type AcquisitionServiceDeps } from '../acquisition-service';
import type { AcquisitionConfig } from '../config';

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

afterEach(async () => {
    await cleanupRoots();
});

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

/** The host's own setup readiness rules, over the candidate package. */
function setupPlanFor(root: string, settings: WorkspaceSettingsStore) {
    return async (
        pluginId: string,
        workspaceId: string,
        packageRoot: string,
        operationId?: string
    ) => {
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: root,
            packagePath: packageRoot,
        });
        if (!descriptors.policy || !descriptors.setup) return null;
        // Read the candidate's own digest-scoped document, falling back to the
        // unscoped document exactly like the host's setup state loader does.
        const stored = await readSetupValuesFor(settings, workspaceId, pluginId, {
            packageDigest: basename(packageRoot),
            ...(operationId === undefined ? {} : { operationId }),
        });
        const validated = validateSetupValues({
            fields: descriptors.setup.fields,
            values: stored,
        });
        return buildSetupPlan({
            setup: descriptors.setup,
            policy: descriptors.policy,
            values: validated.values,
            hostConnections: [],
        });
    };
}

function makeHarness(input: {
    fixture: ReleaseFixture;
    workspaceIds?: readonly string[];
    failDownload?: () => boolean;
    installEnabled?: boolean;
    acceptedTrustModes?: readonly string[];
    /** Share an instance root/settings store to model an update over time. */
    root?: string;
    settings?: WorkspaceSettingsStore;
    /** Model a paid release: public artifact path refuses, Library route serves. */
    coverageRequired?: boolean;
    onRequest?: (url: string) => void;
    resolveCoveredArtifact?: AcquisitionServiceDeps['resolveCoveredArtifact'];
    /** Replace the registry transport, e.g. to change the checkpoint mid-run. */
    transport?: typeof fetch;
    /** Additional keys the host trusts, e.g. a checkpoint signed by another key. */
    trustedKeys?: readonly TestKey[];
    /** Durable advisory state, so checkpoint persistence is observable. */
    registryState?: AcquisitionServiceDeps['registryState'];
}) {
    const root = input.root ?? tempRoot('or3-extensions-');
    const settings = input.settings ?? memoryStore();
    const services = pluginPackageServices(settings, root);
    const store = new PluginAcquisitionOperationStore(root);
    const workspaceIds = input.workspaceIds ?? ['ws-1'];
    const trustModes = input.acceptedTrustModes ?? ['isolated-client'];
    const supportedProfiles = trustModes.includes('isolated-client') ? [PORTABLE_PROFILE] : [];
    const trustedKeys = [
        input.fixture.key,
        ...(input.trustedKeys ?? []).map((entry) => entry.key),
    ];
    const config: AcquisitionConfig = {
        registryOrigin: ORIGIN,
        installEnabled: input.installEnabled ?? true,
        releaseKeys: [...trustedKeys],
        supportedTrustModes: [...trustModes],
        supportedProfiles,
        hostOr3Version: '0.3.0',
        hostPluginApiVersion: '2.0.0',
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
    };
    const registry = new RegistryClient({
        registryOrigin: ORIGIN,
        supportedProfiles,
        trustRoot: {
            releaseKeys: [...trustedKeys],
            supportedProfiles,
            hostOr3Version: '0.3.0',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: 0,
        },
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
        transport:
            input.transport ??
            fakeRegistryTransport({
                fixture: input.fixture,
                failDownload: input.failDownload,
                ...(input.coverageRequired === undefined
                    ? {}
                    : { coverageRequired: input.coverageRequired }),
                ...(input.onRequest === undefined ? {} : { onRequest: input.onRequest }),
            }),
        freeDiskBytes: async () => 1024 ** 3,
    });
    const deps: AcquisitionServiceDeps = {
        config,
        store,
        registry,
        services,
        routeCatalog: new PluginPackageRouteCatalog(services.packages, services.pointers),
        listWorkspaceIds: async () => workspaceIds,
        extensionsRoot: root,
        // A host that declares the portable profile must also declare the trust
        // mode, the required feature flag and the grant vocabulary the profile
        // uses; the pipeline never widens this on the package's behalf.
        hostCapabilities: {
            ...OR3_PLUGIN_V2_HOST_CAPABILITIES,
            supportedTrustModes: [...trustModes] as never,
            supportedGrants: ['network.http'],
            supportedFeatures: [PORTABLE_PROFILE],
        },
        clientCanary: async () => ({ status: 'passed' as const }),
        setupPlan: setupPlanFor(root, settings),
        ...(input.registryState === undefined ? {} : { registryState: input.registryState }),
        ...(input.resolveCoveredArtifact === undefined
            ? {}
            : { resolveCoveredArtifact: input.resolveCoveredArtifact }),
    };
    const service = new PluginAcquisitionService(deps);
    async function reviewGrants(): Promise<void> {
        for (const workspaceId of workspaceIds) {
            await setPluginGrantReview(settings, workspaceId, 'alpha', {
                // Registry-only consent: bound to the signed authority and the
                // approved grants, without a staged digest yet.
                candidate: {
                    requestedGrants: ['network.http'],
                    releaseId: input.fixture.signed.releaseId,
                    packageDigest: null,
                    authoritySha256: input.fixture.signed.authoritySha256,
                    authority: input.fixture.signed.authority ?? null,
                },
                approvedGrants: ['network.http'],
            });
        }
    }
    async function start(input: { version?: string; workspaceId?: string }) {
        await reviewGrants();
        const started = await service.start({
            pluginId: 'alpha',
            ...(input.version === undefined ? {} : { version: input.version }),
            workspaceId: input.workspaceId ?? 'ws-1',
            requesterUserId: 'user-1',
            instanceId: 'instance-1',
        });
        if (!started.ok) return started;
        return {
            ok: true as const,
            operation: await service.advance(started.operation.operationId),
        };
    }
    return { service, start, reviewGrants, store, services, settings, root };
}

describe('reviewed acquisition pipeline (5.1, 5.4)', () => {
    it('reports missing consent as a permission-review failure', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        const started = await harness.service.start({
            pluginId: 'alpha', version: '1.0.0', workspaceId: 'ws-1',
            requesterUserId: 'user-1', instanceId: 'instance-1',
        });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const stopped = await harness.service.advance(started.operation.operationId);
        expect(stopped.failure).toMatchObject({ code: 'grant-review-required', retryable: false });
        expect(await harness.services.pointers.readPointer('alpha')).toBeNull();
    });

    it('correlates unexpected failures without returning raw exception text', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        vi.spyOn(harness.services.candidates, 'prepare').mockRejectedValueOnce(new Error('secret-token private-document'));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const started = await harness.start({ version: '1.0.0' });
            expect(started.ok).toBe(true);
            if (!started.ok) return;
            expect(started.operation.failure?.code).toBe('internal-error');
            expect(started.operation.failure?.message).not.toContain('secret-token');
            expect(log).toHaveBeenCalledWith('[plugin-acquisition] step failed', expect.objectContaining({
                operationId: started.operation.operationId, exceptionType: 'Error',
            }));
            expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
        } finally {
            log.mockRestore();
        }
    });

    it('reports an actionable duplicate-install code without changing the installed pointer', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        await harness.start({ version: '1.0.0' });
        const pointer = await harness.services.pointers.readPointer('alpha');
        const repeated = await harness.start({ version: '1.0.0' });
        expect(repeated.ok).toBe(true);
        if (!repeated.ok) return;
        expect(repeated.operation.failure).toMatchObject({ code: 'already-installed', retryable: false });
        expect(await harness.services.pointers.readPointer('alpha')).toEqual(pointer);
    });

    it('resolves, verifies, records a candidate, checks health and promotes a portable release', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });

        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const operation = started.operation;
        expect(operation.status).toBe('completed');
        expect(operation.stage).toBe('receipt-recorded');
        expect(operation.release?.profile).toBe(PORTABLE_PROFILE);
        expect(operation.candidateDigest).toBe(fixture.treeDigest);
        expect(operation.authoritySha256).toBe(fixture.signed.authoritySha256);
        expect(operation.failure).toBeNull();
        expect(describeAcquisitionStatus(operation).percentComplete).toBe(100);

        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.current?.packageDigest).toBe(fixture.treeDigest);
        expect(pointer?.candidate).toBeNull();
        expect(operation.expectedPointerRevision).toBe(1);
        expect(pointer?.revision).toBe(2);

        // A completed install is usable: the runtime gate refuses a disabled
        // plugin, so a first install enables it for the installing workspace.
        expect(await getEnabledPlugins(harness.settings, 'ws-1')).toEqual(['alpha']);
    });

    it('leaves enablement alone for an update, so a deliberate disable survives', async () => {
        const root = tempRoot('or3-extensions-');
        const settings = memoryStore();
        const first = await releaseFixture({ version: '1.0.0' });
        const installed = await makeHarness({ fixture: first, root, settings }).start({
            version: '1.0.0',
        });
        expect(installed.ok).toBe(true);
        expect(await getEnabledPlugins(settings, 'ws-1')).toEqual(['alpha']);

        // An owner disables it; the update below must not silently re-enable it.
        await setPluginEnabled(settings, 'ws-1', 'alpha', false);
        const upgrade = await releaseFixture({ version: '1.1.0' });
        const updated = await makeHarness({ fixture: upgrade, root, settings }).start({
            version: '1.1.0',
        });
        expect(updated.ok).toBe(true);
        if (!updated.ok) return;
        expect(updated.operation.status).toBe('completed');
        const pointer = await makeHarness({ fixture: upgrade, root, settings }).services.pointers
            .readPointer('alpha');
        expect(pointer?.previous).not.toBeNull();
        expect(await getEnabledPlugins(settings, 'ws-1')).toEqual([]);
    });

    it('returns the durable operation id before the pipeline runs', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        await harness.reviewGrants();
        const started = await harness.service.start({
            pluginId: 'alpha',
            version: '1.0.0',
            workspaceId: 'ws-1',
            requesterUserId: 'user-1',
            instanceId: 'instance-1',
        });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        // Recorded and monitorable, but no work has been done for it yet.
        expect(started.operation.status).toBe('pending');
        expect(started.operation.stage).toBe('resolved');
        expect(await harness.service.status(started.operation.operationId)).toMatchObject({
            operationId: started.operation.operationId,
        });

        const finished = await harness.service.advance(started.operation.operationId);
        expect(finished.status).toBe('completed');
    });

    it('records no operation when the instance is not allowed to install', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture, installEnabled: false });
        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        expect(started.failure.code).toBe('registry-unconfigured');
        expect(await harness.store.list()).toEqual([]);
    });

    it('refuses a release whose signed metadata does not declare the requested version', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '9.9.9' });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        // The registry serves the version that exists; the signed document not
        // declaring the requested version is the refusal.
        expect(started.failure.code).toBe('release-identity-mismatch');
        expect(await harness.store.list()).toEqual([]);
    });

    it('refuses the portable profile when the host cannot run isolated clients', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture, acceptedTrustModes: ['trusted-host'] });
        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        expect(started.failure.code).toBe('release-profile-unsupported');
        expect(await harness.store.list()).toEqual([]);
    });

    it('refuses a package whose manifest contradicts the signed profile', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', disguisedTrustedHost: true });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.operation.status).toBe('failed');
        expect(started.operation.failure?.code).toBe('package-profile-mismatch');
        expect(started.operation.failure?.message).toContain('portable');
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current ?? null
        ).toBeNull();
    });

    it('refuses a package whose effective authority differs from the signed digest', async () => {
        const fixture = await releaseFixture({
            version: '1.0.0',
            authoritySha256: `sha256-${'a'.repeat(64)}`,
        });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.operation.failure?.code).toBe('authority-mismatch');
    });

    it('rebuilds a new-envelope authority from the staged package before promotion', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const manifest = await readPackageManifest(fixture.treePath);
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: fixture.treePath,
            packagePath: fixture.treePath,
        });
        if (!descriptors.policy || !descriptors.setup) throw new Error('fixture descriptors missing');
        const derived = toEffectiveAuthority({
            manifest,
            policy: descriptors.policy,
            setup: descriptors.setup,
        });
        const tampered: EffectiveAuthority = {
            ...derived,
            destinations: [
                ...derived.destinations,
                {
                    host: 'unexpected.example',
                    methods: ['GET'],
                    pathPrefixes: ['/'],
                    connection: 'unexpected',
                },
            ],
        };
        const authoritySha256 = await computeAuthorityHash(tampered);
        const signed = await signReleaseMetadataForTest({
            document: {
                ...fixture.signed,
                authority: tampered,
                authoritySha256,
            },
            keyId: fixture.key.keyId,
            privateKeyBase64: fixture.privateKeyBase64,
        });
        const harness = makeHarness({ fixture: { ...fixture, signed } });
        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.operation.status).toBe('failed');
        expect(started.operation.failure?.code).toBe('authority-mismatch');
        expect((await harness.services.pointers.readPointer('alpha'))?.current ?? null).toBeNull();
    });
});

describe('recovery and cancellation (5.3)', () => {
    it('resumes an interrupted download under the same operation id', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        let fail = true;
        const harness = makeHarness({ fixture, failDownload: () => fail });

        const started = await harness.start({ version: '1.0.0' });
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

    it('pauses a first install whose setup is incomplete and re-checks readiness on retry', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const harness = makeHarness({ fixture });

        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const paused = started.operation;
        expect(paused.status).toBe('paused');
        expect(paused.stage).toBe('candidate-recorded');
        expect(paused.failure?.code).toBe('setup-required');
        const pausedView = describeAcquisitionStatus(paused);
        expect(pausedView.needsSetup).toBe(true);
        expect(pausedView.resumable).toBe(true);
        // A setup pause carries a retryable pause failure: the operator must see
        // a way to continue it, not a dead operation.
        expect(pausedView.retryable).toBe(true);
        expect(pausedView.workspaceId).toBe('ws-1');

        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.candidate?.packageDigest).toBe(fixture.treeDigest);
        expect(pointer?.current).toBeNull();

        // An immediate retry cannot promote with nothing saved: readiness is
        // re-derived from the host's own plan, not from the pause itself.
        const retried = await harness.service.retry(paused.operationId);
        expect(retried.status).toBe('paused');
        expect(retried.failure?.code).toBe('setup-required');
        expect((await harness.services.pointers.readPointer('alpha'))?.current).toBeNull();

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

    it('cancels a paused operation and releases its candidate pointer', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');

        const canceled = await harness.service.cancel(started.operation.operationId);
        expect(canceled.status).toBe('canceled');
        expect(canceled.failure?.code).toBe('canceled');
        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.current).toBeNull();
        // The canceled operation's candidate is released so later setup
        // resolves the running version instead of a dead candidate.
        expect(pointer?.candidate).toBeNull();
    });

    it('restages the candidate when retrying a canceled setup pause', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');

        const canceled = await harness.service.cancel(started.operation.operationId);
        expect(canceled.status).toBe('canceled');
        expect((await harness.services.pointers.readPointer('alpha'))?.candidate).toBeNull();

        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'secret-value' })
        );
        const restarted = await harness.service.retry(started.operation.operationId);
        expect(restarted.stage).toBe('receipt-recorded');
        expect(restarted.status).toBe('completed');
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });

    it('blocks a global promotion when another enabled workspace lacks setup', async () => {
        const root = tempRoot('or3-extensions-');
        const settings = memoryStore();
        await settings.set('ws-1', setupValuesKey('alpha'), JSON.stringify({ token: 'ready' }));
        const first = await releaseFixture({ version: '1.0.0', requiredField: true });
        const installed = await makeHarness({ fixture: first, root, settings }).start({
            version: '1.0.0',
        });
        expect(installed.ok).toBe(true);
        await setPluginEnabled(settings, 'ws-2', 'alpha', true);

        const update = await releaseFixture({ version: '1.1.0', requiredField: true });
        const attempted = await makeHarness({
            fixture: update,
            root,
            settings,
            workspaceIds: ['ws-1', 'ws-2'],
        }).start({ version: '1.1.0' });
        expect(attempted.ok).toBe(true);
        if (!attempted.ok) return;
        expect(attempted.operation.status).toBe('blocked');
        expect(attempted.operation.failure?.code).toBe('workspace-preflight-blocked');
        expect(attempted.operation.failure?.message).toContain('ws-2');
        expect(
            (await makeHarness({ fixture: update, root, settings }).services.pointers.readPointer(
                'alpha'
            ))?.current?.packageDigest
        ).toBe(first.treeDigest);
    });

    it('recovers the receipt when a crash left the promotion committed but unrecorded', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('completed');

        // A second operation for the same release, recorded at `health-checked`
        // exactly as a crash between the pointer write and the receipt would
        // have left it.
        const recovered = await harness.store.create({
            pluginId: 'alpha',
            version: '1.0.0',
            workspaceId: 'ws-1',
            requesterUserId: 'user-1',
            instanceId: 'instance-1',
            stage: 'health-checked',
            release: { ...started.operation.release! },
        });
        const staged = await harness.store.update(recovered.operationId, recovered.revision, {
            candidateDigest: fixture.treeDigest,
            expectedPointerRevision: 1,
        });
        const finished = await harness.service.advance(staged.operationId);
        expect(finished.status).toBe('completed');
        expect(finished.stage).toBe('receipt-recorded');

        // Cancellation after the pointer moved never reports "canceled".
        const canceled = await harness.service.cancel(finished.operationId);
        expect(canceled.status).toBe('completed');
    });
});

describe('resume revalidation across security revisions (finding 32)', () => {
    it('rejects equivocation at the accepted revision and accepts a higher one', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const snapshot = (revision: number, sequence: number): RegistryAdvisorySnapshot => ({
            schemaVersion: 2,
            revision,
            sequence,
            advisories: [],
            keyStatuses: [
                {
                    keyId: fixture.key.keyId,
                    status: 'active',
                    effectiveAt: new Date(Date.now() - 60_000).toISOString(),
                },
            ],
        });
        // The checkpoint the registry serves can move between resumes.
        let active = fakeRegistryTransport({ fixture, snapshot: snapshot(1, 9) });
        const switching: typeof fetch = (input, init) => active(input, init);
        const harness = makeHarness({ fixture, transport: switching });

        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('paused');
        expect(started.operation.failure?.code).toBe('setup-required');
        expect(started.operation.acceptedSecurityRevision).toBe(1);
        expect(started.operation.advisoryCheckpointSha256).toBeTruthy();

        // Same revision, different digest: the snapshot shifted under the
        // recorded operation, which is equivocation rather than progress.
        active = fakeRegistryTransport({ fixture, snapshot: snapshot(1, 10) });
        const equivocated = await harness.service.retry(started.operation.operationId);
        expect(equivocated.status).toBe('blocked');
        expect(equivocated.failure?.code).toBe('advisory-unverified');

        // A strictly higher revision is a newer security state: the resume
        // continues and records the new revision and digest.
        active = fakeRegistryTransport({ fixture, snapshot: snapshot(2, 10) });
        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'secret-value' })
        );
        const resumed = await harness.service.retry(started.operation.operationId);
        expect(resumed.status).toBe('completed');
        expect(resumed.acceptedSecurityRevision).toBe(2);
    });

    it('persists the authenticated checkpoint before a revoked release key is refused', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        // A second key signs the checkpoint while the fixture key (which signed
        // the release) is marked compromised in the same snapshot: a compromise
        // sweep with a still-signing checkpoint key.
        const checkpointKey = await makeKey('or3-checkpoint-key');
        const accepted: unknown[] = [];
        const registryState = {
            async acceptAdvisorySequence(sequence: number) {
                accepted.push({ sequence });
            },
            async acceptAdvisoryCheckpoint(checkpoint: {
                revision: number;
                sequence: number;
                snapshotSha256: string;
                issuedAt: string;
                expiresAt: string;
            }) {
                accepted.push(checkpoint);
            },
        };
        const revokedAt = new Date(Date.now() - 30_000).toISOString();
        const harness = makeHarness({
            fixture,
            trustedKeys: [checkpointKey],
            registryState,
            transport: fakeRegistryTransport({
                fixture,
                checkpointKey,
                keyStatuses: [
                    {
                        keyId: fixture.key.keyId,
                        status: 'compromised',
                        effectiveAt: revokedAt,
                    },
                    {
                        keyId: checkpointKey.key.keyId,
                        status: 'active',
                        effectiveAt: revokedAt,
                    },
                ],
            }),
        });
        await harness.reviewGrants();
        const started = await harness.service.start({
            pluginId: 'alpha',
            version: '1.0.0',
            workspaceId: 'ws-1',
            requesterUserId: 'user-1',
            instanceId: 'instance-1',
        });
        expect(started.ok).toBe(false);
        if (started.ok) return;
        expect(started.failure.code).toBe('release-key-untrusted');
        // The refusal was applied only after the authenticated revision (and
        // digest) became durable host state, so a replay of the earlier
        // checkpoint can no longer be accepted.
        expect(accepted).toHaveLength(1);
        expect(accepted[0]).toMatchObject({ revision: 1, sequence: 9 });
    });

    it('migrates a legacy operation by authenticating the v2 checkpoint instead of comparing v1 evidence', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const snapshot: RegistryAdvisorySnapshot = {
            schemaVersion: 2,
            revision: 0,
            sequence: 9,
            advisories: [],
            keyStatuses: [
                {
                    keyId: fixture.key.keyId,
                    status: 'active',
                    effectiveAt: new Date(Date.now() - 60_000).toISOString(),
                },
            ],
        };
        const harness = makeHarness({
            fixture,
            transport: fakeRegistryTransport({ fixture, snapshot }),
        });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('paused');
        expect(started.operation.failure?.code).toBe('setup-required');
        expect(started.operation.acceptedSecurityRevision).toBe(0);

        // Rewrite the durable record to the pre-0028 shape: no revision field and
        // the v1 digest, which cannot be compared with a v2 digest. The sequence
        // floor survives; only the incomparable digest evidence is discarded.
        const path = join(
            harness.store.operationsDirectory(),
            `${started.operation.operationId}.json`
        );
        const legacy = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        delete legacy.acceptedSecurityRevision;
        legacy.advisoryCheckpointSha256 = `sha256-${'0'.repeat(64)}`;
        await writeFile(path, JSON.stringify(legacy), 'utf8');

        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'secret-value' })
        );
        const resumed = await harness.service.retry(started.operation.operationId);
        expect(resumed.status).toBe('completed');
        expect(resumed.acceptedSecurityRevision).toBe(0);
    });
});

describe('operational drills (6.7)', () => {
    it('a registry download outage fails retryably, promotes nothing and recovers on retry', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        // The drill flips the outage on and off, as a real registry would.
        let outage = true;
        const harness = makeHarness({ fixture, failDownload: () => outage });

        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('failed');
        expect(started.operation.failure?.retryable).toBe(true);
        // Nothing was promoted and no selected version was replaced.
        expect((await harness.services.pointers.readPointer('alpha')) ?? null).toBeNull();
        expect((await harness.services.pointers.readStartupSelection('alpha')).selected).toBeNull();

        outage = false;
        const recovered = await harness.service.retry(started.operation.operationId);
        expect(recovered.status).toBe('completed');
        expect(recovered.failure).toBeNull();
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });

    it('a rotated release key is refused until the host trusts it', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        // A different key signs the same document: a rotation the host has not
        // been configured for must not be accepted.
        const rotated = await makeKey('or3-release-rotated');
        const harness = makeHarness({ fixture });
        const foreign = new RegistryClient({
            registryOrigin: ORIGIN,
            supportedProfiles: [PORTABLE_PROFILE],
            trustRoot: {
                releaseKeys: [rotated.key],
                supportedProfiles: [PORTABLE_PROFILE],
                hostOr3Version: '0.3.0',
                hostPluginApiVersion: '2.0.0',
                acceptedAdvisorySequence: 0,
            },
            maxArtifactBytes: MAX_ARTIFACT_BYTES,
            reserveBytes: 0,
            transport: fakeRegistryTransport({ fixture }),
            freeDiskBytes: async () => 1024 ** 3,
        });
        expect(
            await foreign.resolveRelease({ expectation: { pluginId: 'alpha', version: '1.0.0' } })
        ).toMatchObject({ ok: false, failure: { code: 'release-key-untrusted' } });
        // The host's configured key still resolves the same release, so a
        // rotation only ever affects what the operator has not adopted yet.
        const trusted = await harness.start({ version: '1.0.0' });
        if (!trusted.ok) throw new Error('expected the trusted key to resolve');
        expect(trusted.operation.status).toBe('completed');
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });
});

describe('instance-wide preflight and conditional promotion (5.5, 5.6)', () => {
    it('keeps an update blocked until an owner disables the incompatible workspace', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture, workspaceIds: ['ws-1', 'ws-2'] });
        await setPluginEnabled(harness.settings, 'ws-1', 'alpha', true);
        await setPluginEnabled(harness.settings, 'ws-2', 'alpha', true);
        await harness.settings.set('ws-2', 'plugins.stateVersion.alpha', '2');

        const started = await harness.start({ version: '1.0.0' });
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
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');
        expect(started.operation.status).toBe('paused');

        // A racing admin records a different candidate for the same plugin.
        const other = await releaseFixture({ version: '1.0.1' });
        const otherStored = await harness.services.packages.installPackage(
            'alpha',
            other.treePath
        );
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
                stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
            },
            previous: pointer?.previous ?? null,
        });

        await harness.settings.set(
            'ws-1',
            setupValuesKey('alpha'),
            JSON.stringify({ token: 'x' })
        );
        const result = await harness.service.retry(started.operation.operationId);
        expect(result.status).not.toBe('completed');
        expect(['health-check-failed', 'pointer-conflict']).toContain(result.failure?.code);

        const after = await harness.services.pointers.readPointer('alpha');
        expect(after?.current).toBeNull();
        expect(after?.candidate?.packageDigest).toBe(otherStored.digest);
    });
});

describe('covered releases acquire through the acting user Library link', () => {
    it('downloads from the linked route when the public artifact path refuses', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const requests: string[] = [];
        const harness = makeHarness({
            fixture,
            coverageRequired: true,
            onRequest: (url) => requests.push(url),
            resolveCoveredArtifact: async (input) => ({
                ok: true,
                artifactPath: `/api/v1/library/releases/${input.releaseId}/artifact`,
                headers: { 'x-or3-library-token': 'linked-token' },
                alreadyAcquired: false,
                receipt: {
                    payload: {
                        schemaVersion: 1,
                        receiptId: 'acq_fixture1234',
                        marketplaceUserId: 'user-1',
                        release: {
                            releaseId: input.expectedRelease.releaseId,
                            pluginId: input.expectedRelease.pluginId,
                            version: input.expectedRelease.version,
                            archiveSha256: input.expectedRelease.archiveSha256,
                            packageTreeSha256: input.expectedRelease.packageTreeSha256,
                            manifestSha256: input.expectedRelease.manifestSha256,
                            authoritySha256: input.expectedRelease.authoritySha256,
                        },
                        coverage: {
                            kind: 'plus',
                            grantId: 'grant_fixture',
                            until: '2027-01-01T00:00:00.000Z',
                        },
                        issuedAt: '2026-09-18T01:00:00.000Z',
                    },
                    algorithm: 'ed25519',
                    keyId: 'receipt-fixture',
                    signature: 'signature',
                } satisfies PluginAcquisitionReceipt,
            }),
        });

        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.operation.status).toBe('completed');
        expect(requests.some((url) => url.includes('/api/v1/library/releases/'))).toBe(true);
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current?.packageDigest
        ).toBe(fixture.treeDigest);
    });

    it('stops retryably with coverage-required when no Library link covers it', async () => {
        const fixture = await releaseFixture({ version: '1.0.0' });
        const harness = makeHarness({ fixture, coverageRequired: true });

        const started = await harness.start({ version: '1.0.0' });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        expect(started.operation.status).toBe('failed');
        expect(started.operation.failure?.code).toBe('coverage-required');
        expect(started.operation.failure?.retryable).toBe(true);
        expect(
            (await harness.services.pointers.readPointer('alpha'))?.current ?? null
        ).toBeNull();
    });

    it('rejects traversal, query-bearing and wrong-release Library artifact paths', async () => {
        for (const artifactPath of [
            '/api/v1/library/releases/rel_other/artifact',
            '/api/v1/library/releases/rel_other/../rel_other/artifact',
            '/api/v1/library/releases/rel_other/artifact?redirect=1',
        ]) {
            const fixture = await releaseFixture({ version: `1.0.${artifactPath.length}` });
            const harness = makeHarness({
                fixture,
                coverageRequired: true,
                resolveCoveredArtifact: async () => ({
                    ok: true,
                    artifactPath,
                    headers: { 'x-or3-library-token': 'linked-token' },
                    alreadyAcquired: false,
                    receipt: {
                        payload: {
                            schemaVersion: 1,
                            receiptId: 'acq_fixture1234',
                            marketplaceUserId: 'user-1',
                            release: {
                                releaseId: fixture.signed.releaseId,
                                pluginId: fixture.signed.pluginId,
                                version: fixture.signed.version,
                                archiveSha256: fixture.signed.archiveSha256,
                                packageTreeSha256: fixture.signed.packageTreeSha256,
                                manifestSha256: fixture.signed.manifestSha256,
                                authoritySha256: fixture.signed.authoritySha256,
                            },
                            coverage: {
                                kind: 'plus',
                                grantId: 'grant_fixture',
                                until: '2027-01-01T00:00:00.000Z',
                            },
                            issuedAt: '2026-09-18T01:00:00.000Z',
                        },
                        algorithm: 'ed25519',
                        keyId: 'receipt-fixture',
                        signature: 'signature',
                    } satisfies PluginAcquisitionReceipt,
                }),
            });
            const started = await harness.start({ version: fixture.version });
            expect(started.ok).toBe(true);
            if (!started.ok) continue;
            expect(started.operation.failure?.code).toBe('coverage-required');
        }
    });
});

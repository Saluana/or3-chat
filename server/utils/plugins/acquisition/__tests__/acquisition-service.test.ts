import { afterEach, describe, expect, it } from 'vitest';
import { describeAcquisitionStatus } from '~~/shared/plugins/acquisition/contracts';
import { buildSetupPlan } from '~~/shared/plugins/setup/plan';
import { validateSetupValues } from '~~/shared/plugins/setup/values';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../../../../admin/plugins/v2-host-capabilities';
import { pluginPackageServices } from '../../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../../admin/plugins/package-route-catalog';
import {
    setPluginEnabled,
    setPluginGrantReview,
} from '../../../../admin/plugins/workspace-plugin-store';
import type { WorkspaceSettingsStore } from '../../../../admin/stores/types';
import { loadPackageDescriptors } from '../../setup/load-descriptors';
import { setupValuesKey } from '../../setup/settings-store';
import {
    cleanupRoots,
    fakeRegistryTransport,
    makeKey,
    ORIGIN,
    PORTABLE_PROFILE,
    releaseFixture,
    tempRoot,
    type ReleaseFixture,
} from './fixtures';
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
    return async (pluginId: string, workspaceId: string, packageRoot: string) => {
        const descriptors = await loadPackageDescriptors({
            extensionsBaseDir: root,
            packagePath: packageRoot,
        });
        if (!descriptors.policy || !descriptors.setup) return null;
        const raw = await settings.get(workspaceId, setupValuesKey(pluginId));
        const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
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
}) {
    const root = tempRoot('or3-extensions-');
    const settings = memoryStore();
    const services = pluginPackageServices(settings, root);
    const store = new PluginAcquisitionOperationStore(root);
    const workspaceIds = input.workspaceIds ?? ['ws-1'];
    const trustModes = input.acceptedTrustModes ?? ['isolated-client'];
    const supportedProfiles = trustModes.includes('isolated-client') ? [PORTABLE_PROFILE] : [];
    const config: AcquisitionConfig = {
        registryOrigin: ORIGIN,
        installEnabled: input.installEnabled ?? true,
        releaseKeys: [input.fixture.key],
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
            releaseKeys: [input.fixture.key],
            supportedProfiles,
            hostOr3Version: '0.3.0',
            hostPluginApiVersion: '2.0.0',
            acceptedAdvisorySequence: 0,
        },
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
        reserveBytes: 0,
        transport: fakeRegistryTransport({
            fixture: input.fixture,
            failDownload: input.failDownload,
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
    };
    const service = new PluginAcquisitionService(deps);
    async function reviewGrants(): Promise<void> {
        for (const workspaceId of workspaceIds) {
            await setPluginGrantReview(settings, workspaceId, 'alpha', {
                requestedGrants: ['network.http'],
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

    it('cancels a paused operation without promoting', async () => {
        const fixture = await releaseFixture({ version: '1.0.0', requiredField: true });
        const harness = makeHarness({ fixture });
        const started = await harness.start({ version: '1.0.0' });
        if (!started.ok) throw new Error('expected a recorded operation');

        const canceled = await harness.service.cancel(started.operation.operationId);
        expect(canceled.status).toBe('canceled');
        expect(canceled.failure?.code).toBe('canceled');
        const pointer = await harness.services.pointers.readPointer('alpha');
        expect(pointer?.current).toBeNull();
        expect(pointer?.candidate?.packageDigest).toBe(fixture.treeDigest);
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

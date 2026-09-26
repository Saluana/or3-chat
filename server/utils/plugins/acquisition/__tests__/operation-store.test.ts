import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    MAX_OPERATION_RECORDS_PER_PLUGIN,
    PluginAcquisitionOperationError,
    PluginAcquisitionOperationStore,
    parseAcquisitionOperation,
} from '../operation-store';
import type { PluginAcquisitionReleaseIdentity } from '~~/shared/plugins/acquisition/contracts';
import { AdvisoryPluginOperationLock } from '../../../../admin/plugins/package-operation-lock';

const roots: string[] = [];

async function makeStore(now: () => number = () => 1_000) {
    const root = await mkdtemp(join(tmpdir(), 'or3-acquisition-'));
    roots.push(root);
    return { store: new PluginAcquisitionOperationStore(root, now), root };
}

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const release: PluginAcquisitionReleaseIdentity = {
    releaseId: 'rel_1',
    pluginId: 'acme.sample',
    version: '1.0.0',
    archiveSha256: `sha256-${'a'.repeat(64)}`,
    packageTreeSha256: `sha256-${'b'.repeat(64)}`,
    manifestSha256: `sha256-${'c'.repeat(64)}`,
    authoritySha256: `sha256-${'d'.repeat(64)}`,
    profile: 'or3-portable-client-v1',
    sourceSha256: `sha256-${'e'.repeat(64)}`,
    license: 'MIT',
    publishedAt: '2026-09-01T00:00:00.000Z',
};

function createInput(overrides: Partial<Parameters<PluginAcquisitionOperationStore['create']>[0]> = {}) {
    return {
        pluginId: 'acme.sample',
        version: '1.0.0',
        workspaceId: 'ws_1',
        requesterUserId: 'user_admin',
        instanceId: 'host-a',
        release,
        ...overrides,
    };
}

describe('acquisition operation records (5.1)', () => {
    it('records one operation with its exact release, requester and target', async () => {
        const { store, root } = await makeStore();
        const created = await store.create(createInput());
        expect(created).toMatchObject({
            schemaVersion: 1,
            revision: 1,
            stage: 'requested',
            status: 'pending',
            pluginId: 'acme.sample',
            workspaceId: 'ws_1',
            requesterUserId: 'user_admin',
            instanceId: 'host-a',
            attempts: 0,
            cancelRequested: false,
        });
        expect(created.release.releaseId).toBe('rel_1');
        expect(created.operationId).toMatch(/^acq_[a-z0-9]{8,}$/);

        // The record survives a fresh store instance over the same root.
        const reopened = new PluginAcquisitionOperationStore(root);
        expect((await reopened.read(created.operationId))?.release.releaseId).toBe('rel_1');
    });

    it('allows only one active operation per plugin', async () => {
        const { store } = await makeStore();
        await store.create(createInput());
        await expect(store.create(createInput())).rejects.toMatchObject({
            code: 'operation-conflict',
        });
        // Another plugin is unaffected.
        await expect(store.create(createInput({ pluginId: 'acme.other' }))).resolves.toBeTruthy();
    });

    it('advances by compare-and-swap and refuses a stale revision', async () => {
        const { store } = await makeStore();
        const created = await store.create(createInput());
        const advanced = await store.update(created.operationId, created.revision, {
            stage: 'resolved',
            status: 'running',
            acceptedAdvisorySequence: 3,
        });
        expect(advanced).toMatchObject({ revision: 2, stage: 'resolved', status: 'running' });

        // A tab that still holds revision 1 must not overwrite the newer record.
        await expect(
            store.update(created.operationId, created.revision, { stage: 'downloaded' })
        ).rejects.toMatchObject({ code: 'operation-conflict' });
        expect((await store.read(created.operationId))?.stage).toBe('resolved');
    });

    it('resumes a recorded stage instead of restarting after a restart', async () => {
        const { store, root } = await makeStore();
        const created = await store.create(createInput());
        await store.update(created.operationId, created.revision, {
            stage: 'downloaded',
            status: 'running',
            downloadedBytes: 4096,
            stagingObject: 'staging/acme.sample/1.0.0.partial',
            downloadUrlExpiresAt: 9_999_999_999_999,
        });
        const reopened = new PluginAcquisitionOperationStore(root);
        const resumed = await reopened.requireRecord(created.operationId);
        expect(resumed).toMatchObject({ stage: 'downloaded', downloadedBytes: 4096 });
    });

    it('retries a failed operation without losing its identity', async () => {
        const { store } = await makeStore();
        const created = await store.create(createInput());
        await store.update(created.operationId, created.revision, {
            status: 'failed',
            stage: 'downloaded',
            failure: {
                code: 'download-failed',
                stage: 'downloaded',
                message: 'connection reset',
                retryable: true,
            },
            completedAt: 2_000,
        });
        const retried = await store.retry(created.operationId);
        expect(retried).toMatchObject({
            status: 'pending',
            failure: null,
            attempts: 1,
            completedAt: null,
            stage: 'downloaded',
        });
        expect(retried.release).toEqual(release);
    });

    it('refuses to retry a completed operation and to reopen a canceled one', async () => {
        const { store } = await makeStore();
        const completed = await store.create(createInput());
        await store.update(completed.operationId, completed.revision, {
            stage: 'receipt-recorded',
            status: 'completed',
            completedAt: 5_000,
        });
        await expect(store.retry(completed.operationId)).rejects.toMatchObject({
            code: 'operation-conflict',
        });

        const canceled = await store.create(createInput({ pluginId: 'acme.other' }));
        await store.update(canceled.operationId, canceled.revision, {
            status: 'canceled',
            failure: {
                code: 'canceled',
                stage: 'requested',
                message: 'Canceled by the operator.',
                retryable: false,
            },
            completedAt: 5_000,
        });
        await expect(store.retry(canceled.operationId)).rejects.toMatchObject({
            code: 'operation-conflict',
        });
    });

    it('records a cancel request without losing the record', async () => {
        const { store } = await makeStore();
        const created = await store.create(createInput());
        const canceled = await store.requestCancel(created.operationId);
        expect(canceled.cancelRequested).toBe(true);
        expect(canceled.status).toBe('pending');
        // Cancelling an already terminal operation is a no-op.
        await store.update(created.operationId, canceled.revision, { status: 'completed' });
        const again = await store.requestCancel(created.operationId);
        expect(again.status).toBe('completed');
    });

    it('keeps the newest records per plugin and never removes an active one', async () => {
        const { store, root } = await makeStore();
        for (let index = 0; index < MAX_OPERATION_RECORDS_PER_PLUGIN + 3; index += 1) {
            const record = await store.create(
                createInput({ operationId: `acq_${String(index).padStart(16, '0')}` })
            );
            await store.update(record.operationId, record.revision, {
                status: 'completed',
                stage: 'receipt-recorded',
                completedAt: 1_000 + index,
            });
        }
        const active = await store.create(createInput({ operationId: 'acq_active0000000000' }));
        expect(await store.gc()).toBeGreaterThan(0);
        const files = (await readdir(store.operationsDirectory())).filter((entry) =>
            entry.endsWith('.json')
        );
        expect(files.length).toBeLessThanOrEqual(MAX_OPERATION_RECORDS_PER_PLUGIN + 1);
        expect(await store.read(active.operationId)).not.toBeNull();
        expect(root).toBeTruthy();
    });

    it('treats a corrupt record as absent and rejects invalid ids', async () => {
        const { store } = await makeStore();
        await store.create(createInput({ operationId: 'acq_valid0000000000' }));
        await writeFile(join(store.operationsDirectory(), 'acq_broken000000000.json'), '{not json');

        expect(await store.read('acq_broken000000000')).toBeNull();
        expect(parseAcquisitionOperation({ schemaVersion: 99 })).toBeNull();
        await expect(store.read('../escape')).rejects.toBeInstanceOf(PluginAcquisitionOperationError);
        await expect(
            store.create(createInput({ pluginId: '../escape' }))
        ).rejects.toMatchObject({ code: 'operation-invalid' });
    });
});

describe('store concurrency and retention (5.1)', () => {
    it('creates only one record per plugin when two creations race', async () => {
        const { store } = await makeStore();
        const results = await Promise.allSettled([
            store.create(createInput()),
            store.create(createInput()),
        ]);
        const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);
        expect((await store.list()).length).toBe(1);
    });

    it('refuses a retry for the same plugin while another run is active', async () => {
        const { store } = await makeStore();
        const first = await store.create(createInput());
        const running = await store.update(first.operationId, first.revision, {
            status: 'running',
        });
        expect(await store.findActiveForPlugin('acme.sample')).toMatchObject({
            operationId: running.operationId,
        });
        await expect(store.create(createInput())).rejects.toMatchObject({
            code: 'operation-conflict',
        });
    });

    it('refuses a second runner for the same plugin and lets it run again afterwards', async () => {
        const { store } = await makeStore();
        const record = await store.create(createInput());
        let started: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            started = resolve;
        });
        const held = store.withRunnerLock(record.pluginId, async () => {
            started();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await gate;
        await expect(store.retry(record.operationId)).rejects.toMatchObject({
            code: 'operation-conflict',
        });
        await held;
        const retried = await store.retry(record.operationId);
        expect(retried.status).toBe('pending');
        expect(retried.attempts).toBe(1);
    });

    it('keeps only operation records and stages nothing for a permanent failure', async () => {
        const { store, root } = await makeStore();
        const record = await store.create(createInput());
        const staging = join(root, '.operations', 'staging', record.operationId);
        await writeFile(
            join(root, '.operations', 'registry-state.json'),
            JSON.stringify({ schemaVersion: 1, acceptedAdvisorySequence: 4, updatedAt: 1 })
        );
        await mkdir(staging, { recursive: true });
        await writeFile(join(staging, 'package.or3pkg'), 'bytes');
        expect(await store.list()).toHaveLength(1);

        const failed = await store.update(record.operationId, record.revision, {
            status: 'failed',
            failure: {
                code: 'package-policy-mismatch',
                stage: 'verified',
                message: 'refused',
                retryable: false,
            },
        });
        expect(failed.status).toBe('failed');
        expect(await readdir(staging).catch(() => [])).toEqual([]);
    });
});

it('does not expire a living runner and fences cleanup by owner token', async () => {
    const {store, root} = await makeStore();
    await store.withRunnerLock('acme.sample', async (assertOwned) => {
        const path = join(root, '.operations/runners/acme.sample.lock/owner.json');
        const owner = JSON.parse(await readFile(path, 'utf8'));
        await writeFile(path, JSON.stringify({ ...owner, heartbeatAt: Date.now() - 60_000 }));
        expect(await store.isRunnerActive('acme.sample')).toBe(true);
        await expect(new PluginAcquisitionOperationStore(root).withRunnerLock('acme.sample', async () => null)).rejects.toMatchObject({ code: 'operation-conflict' });
        await assertOwned();
        await writeFile(path, JSON.stringify({ ...owner, ownerId: 'successor' }));
        await expect(assertOwned()).rejects.toMatchObject({ code: 'operation-conflict' });
    });
    const path = join(root, '.operations/runners/acme.sample.lock/owner.json');
    expect(JSON.parse(await readFile(path, 'utf8')).ownerId).toBe('successor');
});
it('blocks a new runner on the pre-lease PID file at the shared path', async () => {
    const { store, root } = await makeStore();
    const path = join(root, '.operations/runners/acme.sample.lock');
    await mkdir(join(root, '.operations/runners'), { recursive: true });
    await writeFile(path, String(process.pid));
    expect(await store.isRunnerActive('acme.sample')).toBe(true);
    await expect(store.withRunnerLock('acme.sample', async () => null)).rejects.toMatchObject({ code: 'operation-conflict' });
    await rm(path);
    await expect(store.withRunnerLock('acme.sample', async () => 'ok')).resolves.toBe('ok');
});
it('blocks a runner held by the transitional nested lease layout', async () => {
    const { store, root } = await makeStore();
    const oldLease = await new AdvisoryPluginOperationLock(join(root, '.operations/runners')).acquire('acme.sample');
    expect(await store.isRunnerActive('acme.sample')).toBe(true);
    await expect(store.withRunnerLock('acme.sample', async () => null)).rejects.toMatchObject({ code: 'operation-conflict' });
    await oldLease.release();
    await expect(store.withRunnerLock('acme.sample', async () => 'ok')).resolves.toBe('ok');
});
it('merges cancellation into completed stage evidence but rejects other competing changes', async () => {
    const {store} = await makeStore();
    const record = await store.create(createInput());
    await store.requestCancel(record.operationId);
    const progressed = await store.recordProgress(record, {stage: 'candidate-recorded', candidateDigest: release.packageTreeSha256});
    expect(progressed.cancelRequested).toBe(true);
    expect(progressed.candidateDigest).toBe(release.packageTreeSha256);
    await expect(store.recordProgress(record, {stage: 'verified'})).rejects.toMatchObject({code: 'operation-conflict'});
});

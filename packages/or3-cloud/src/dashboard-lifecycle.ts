import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';
import { RestartController, RestartError } from '../../../shared/server/restarts/controller';
import { createRestartConfigurationSource } from '../../../shared/server/restarts/configuration';
import { handleRestartRequest } from '../../../shared/server/restarts/http';
import { acquireDeploymentLease, readLeaseOwner } from './deployment/lease';
import { deploymentPaths } from './deployment/paths';
import { loadManaged, assertNoPending } from './deployment/state-store';
import { assertRunningAppImage, assertSafeComposeBinding, composeArgs } from './runtime/compose';
import { run } from './runtime/command-runner';
import { containerNodeCommand } from './runtime/health';
import { restartCommand } from './commands/lifecycle';

/** Bundled with the exact installed operator. Restart never downloads a CLI. */
export async function createManagedLifecycle(directory: string) {
    const initial = await loadManaged(directory);
    if (!initial.state.deploymentId) throw new RestartError('deployment_identity_missing');
    const stateDirectory = join(directory, '.or3-cloud', 'restarts');
    const configuration = await createRestartConfigurationSource(join(directory, '.env'), stateDirectory,
        async () => parse(await readFile(join(directory, '.env'), 'utf8')));
    const owners = new Map<string, string>();
    const runtimeIdentity = JSON.stringify([initial.state.deploymentId, initial.state.image, initial.state.volumeName]);
    const snapshot = async () => {
        const loaded = await loadManaged(directory);
        if (JSON.stringify([loaded.state.deploymentId, loaded.state.image, loaded.state.volumeName]) !== runtimeIdentity) throw new RestartError('deployment_identity_changed');
        assertNoPending(loaded.state);
        if (['pending', 'needs-attention'].includes(loaded.state.lastReceipt?.operatorHandoff ?? '')) throw new RestartError('operator_handoff_unresolved');
        return loaded;
    };
    async function inspect(deadline = performance.now() + 7_000) {
        const loaded = await snapshot();
        const container = await run('docker', composeArgs(directory, loaded.state.mode, ['ps', '-q', 'or3']), directory, undefined, Math.min(3_000, deadline - performance.now()));
        if (!container.ok || !/^[0-9a-f]{12,64}$/.test(container.stdout.trim())) throw new RestartError('application_not_ready');
        const result = await run('docker', ['inspect', container.stdout.trim()], directory, undefined, Math.min(3_000, deadline - performance.now()));
        if (!result.ok) throw new RestartError('application_not_ready');
        const info = z.array(z.object({ Image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            Config: z.object({ Labels: z.record(z.string(), z.string()).nullish() }).passthrough(),
            Mounts: z.array(z.object({ Destination: z.string(), Name: z.string().optional(), Type: z.string() }).passthrough()),
        }).passthrough()).nonempty().parse(JSON.parse(result.stdout))[0];
        if (info.Config?.Labels?.['io.or3.cloud.deployment-id'] !== initial.state.deploymentId
            || !info.Mounts.some(mount => mount.Destination === '/data' && mount.Type === 'volume' && mount.Name === initial.state.volumeName)) throw new RestartError('deployment_identity_changed');
        return { loaded, imageId: String(info.Image) };
    }
    let originalImageId: string | undefined;
    async function probe(deadline = performance.now() + 10_000) {
        const inspected = await inspect(deadline);
        if (originalImageId && originalImageId !== inspected.imageId) throw new RestartError('deployment_identity_changed');
        const result = await run('docker', composeArgs(directory, inspected.loaded.state.mode, ['exec', '-T', 'or3', ...containerNodeCommand(
            "fetch('http://127.0.0.1:3000/api/ready',{signal:AbortSignal.timeout(3000)}).then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ready')process.exit(1)}).catch(()=>process.exit(1))",
        )]), directory, undefined, Math.min(4_000, deadline - performance.now()));
        if (!result.ok) throw new RestartError('application_not_ready');
    }
    const controller = new RestartController(stateDirectory, {
        mode: 'managed', identity: initial.state.deploymentId, runtimeIdentity, ...configuration,
        async acquire(requestId) {
            await snapshot();
            const release = await acquireDeploymentLease(directory, 'dashboard-restart', requestId);
            try {
                const owner = await readLeaseOwner(deploymentPaths(directory).lease);
                if (!owner || owner.jobId !== requestId) throw new RestartError('lease_lost');
                owners.set(requestId, owner.nonce);
                const inspected = await inspect();
                await assertSafeComposeBinding(directory, inspected.loaded.state.mode, inspected.loaded.env, performance.now() + 5_000);
                await assertRunningAppImage(directory, inspected.loaded.state.mode, inspected.loaded.state.image, performance.now() + 5_000);
                originalImageId = inspected.imageId;
                return async () => { owners.delete(requestId); await release(); };
            } catch (error) { owners.delete(requestId); await release(); throw error; }
        },
        async assertOwnership(requestId) {
            const owner = await readLeaseOwner(deploymentPaths(directory).lease);
            if (!owner || owner.nonce !== owners.get(requestId) || owner.jobId !== requestId) throw new RestartError('lease_lost');
            await snapshot();
        },
        async replace(operation, request, deadline) {
            const owner = await readLeaseOwner(deploymentPaths(directory).lease);
            if (!owner || owner.nonce !== owners.get(operation.requestId)) throw new RestartError('lease_lost');
            await restartCommand(directory, { applySaved: request.target.kind === 'saved', deadline: Math.min(deadline, performance.now() + 45_000) });
        },
        probe,
    });
    await controller.initialize();
    let probing = false;
    const observer = setInterval(() => {
        if (probing) return;
        probing = true;
        void probe().catch(() => {}).finally(() => { probing = false; });
    }, 2_000);
    observer.unref();
    return { controller, handle: handleRestartRequest, dispose() { clearInterval(observer); controller.dispose(); } };
}

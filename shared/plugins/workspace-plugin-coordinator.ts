import type { PluginRuntimeManifestResponse } from './runtime-manifest';
import type { PluginDescriptor } from './runtime-descriptor';
import { SerializedReconcileCoordinator } from './lifecycle-coordinator';

export interface WorkspacePluginContext {
    readonly workspaceId: string | null;
    readonly sessionKey: string | null;
}

export interface WorkspacePluginAdapter {
    readonly name: string;
    stop(): Promise<void>;
    reconcile(manifest: PluginRuntimeManifestResponse, isCurrent: () => boolean): Promise<void>;
}

/** Common approval/workspace gate; adapters retain their execution-specific checks. */
export function eligibleWorkspacePluginDescriptors(
    manifest: PluginRuntimeManifestResponse,
    workspaceId: string
): readonly PluginDescriptor[] {
    if (manifest.workspaceId !== workspaceId) throw new Error('Runtime manifest workspace does not match the active session');
    const descriptors: PluginDescriptor[] = [];
    for (const id of new Set(manifest.enabledPluginIds)) {
        const entry = manifest.runtime[id];
        if (entry?.loadAllowed !== true || entry.descriptorStatus !== 'ready') continue;
        const descriptor = entry.descriptor;
        if (!descriptor || descriptor.id !== id || descriptor.workspaceId !== workspaceId) continue;
        if (descriptor.manifestVersion === 1 && descriptor.trust === 'trusted-host' && descriptor.artifact?.kind === 'bundled-v1') {
            descriptors.push(descriptor);
        } else if (descriptor.manifestVersion === 2 && descriptor.source === 'package' && descriptor.artifact?.kind === 'package-v2') {
            const client = descriptor.artifact.client;
            if (!client || !descriptor.artifact.clientEntry || !Array.isArray(descriptor.effectiveGrants)) continue;
            if ((descriptor.trust === 'trusted-host' && client.isolation === 'host') ||
                (descriptor.trust === 'isolated-client' && (client.isolation === 'iframe' || client.isolation === 'worker'))) {
                descriptors.push(descriptor);
            }
        }
    }
    return descriptors;
}

function acceptManifest(input: unknown, workspaceId: string): PluginRuntimeManifestResponse {
    if (!input || typeof input !== 'object') throw new Error('Invalid runtime manifest');
    const manifest = input as PluginRuntimeManifestResponse;
    if (typeof manifest.revision !== 'string' || !manifest.revision ||
        !Array.isArray(manifest.enabledPluginIds) || manifest.enabledPluginIds.some((id) => typeof id !== 'string') ||
        !Array.isArray(manifest.installedPluginIds) || manifest.installedPluginIds.some((id) => typeof id !== 'string') ||
        !manifest.runtime || typeof manifest.runtime !== 'object' || Array.isArray(manifest.runtime)) {
        throw new Error('Invalid runtime manifest');
    }
    return { ...manifest, enabledPluginIds: eligibleWorkspacePluginDescriptors(manifest, workspaceId).map((descriptor) => descriptor.id) };
}

/** One owner for manifest requests and cross-adapter workspace/session transitions. */
export class WorkspacePluginCoordinator {
    readonly #adapters = new Set<WorkspacePluginAdapter>();
    readonly #queue: SerializedReconcileCoordinator<{ generation: number; context: WorkspacePluginContext; controller: AbortController }>;
    #generation = 0;
    #context: WorkspacePluginContext = { workspaceId: null, sessionKey: null };
    #controller = new AbortController();
    #cleanup: Promise<void> = Promise.resolve();
    #cleanupFailed = false;
    #disposed = false;

    constructor(private readonly options: {
        fetchManifest(signal: AbortSignal): Promise<unknown>;
        onError(error: unknown): void;
    }) {
        this.#queue = new SerializedReconcileCoordinator(async ({ value }) => {
            // Let synchronous focus/admin/watch bursts collapse before fetching.
            await Promise.resolve();
            const current = () => !this.#disposed && value.generation === this.#generation && !value.controller.signal.aborted;
            if (!current()) return;
            try {
                await this.#cleanup;
                if (!current() || !value.context.workspaceId) return;
                const input = await this.options.fetchManifest(value.controller.signal);
                if (!current()) return;
                const manifest = acceptManifest(input, value.context.workspaceId);
                for (const adapter of this.#adapters) {
                    if (!current()) return;
                    try {
                        await adapter.reconcile(manifest, () => current() && this.#adapters.has(adapter));
                    } catch (error) {
                        if (current()) this.options.onError(new Error(`${adapter.name} reconciliation failed`, { cause: error }));
                    }
                }
            } catch (error) {
                if (current()) this.options.onError(error);
            }
        });
    }

    register(adapter: WorkspacePluginAdapter): () => Promise<void> {
        this.#adapters.add(adapter);
        return async () => {
            this.#adapters.delete(adapter);
            await adapter.stop();
        };
    }

    refresh(context: WorkspacePluginContext): Promise<void> {
        if (this.#disposed) return Promise.resolve();
        const changed = context.workspaceId !== this.#context.workspaceId || context.sessionKey !== this.#context.sessionKey;
        this.#context = { ...context };
        ++this.#generation;
        this.#controller.abort('manifest-superseded');
        this.#controller = new AbortController();
        if (changed || this.#cleanupFailed) {
            this.#cleanupFailed = false;
            // Invoke immediately: runner stop() invalidates in-flight activation
            // before the serialized queue waits for that activation to settle.
            const cleanup = this.#stopAdapters().catch((error) => {
                if (this.#cleanup === cleanup) this.#cleanupFailed = true;
                throw error;
            });
            this.#cleanup = cleanup;
            void this.#cleanup.catch(() => {}); // The drain reports the failure.
        }
        return this.#queue.request({ generation: this.#generation, context: this.#context, controller: this.#controller });
    }

    async #stopAdapters(): Promise<void> {
        const results = await Promise.allSettled(Array.from(this.#adapters, (adapter) => adapter.stop()));
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Workspace plugin teardown failed');
    }

    async stop(): Promise<void> {
        await this.refresh({ workspaceId: null, sessionKey: null });
        await this.#cleanup;
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        ++this.#generation;
        this.#controller.abort('coordinator-disposed');
        await this.#stopAdapters();
        this.#adapters.clear();
    }
}

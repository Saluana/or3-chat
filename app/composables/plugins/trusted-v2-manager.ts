import { shallowReactive } from 'vue';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

export interface TrustedV2Activation {
    dispose(): Promise<void>;
}

export interface TrustedV2ObservedActivation {
    readonly pluginId: string;
    readonly version: string;
    readonly packageDigest: string;
    readonly workspaceId: string;
    readonly observedAt: string;
}

export interface TrustedV2ManagerOptions {
    activate(
        descriptor: PackageV2PluginDescriptor,
        generation: number,
        signal: AbortSignal,
        isCurrent: () => boolean
    ): Promise<TrustedV2Activation>;
    onError?(pluginId: string, error: unknown): void;
}

function desiredDescriptors(
    manifest: PluginRuntimeManifestResponse,
    workspaceId: string
): Map<string, PackageV2PluginDescriptor> {
    const desired = new Map<string, PackageV2PluginDescriptor>();
    if (manifest.workspaceId !== workspaceId) return desired;
    for (const id of manifest.enabledPluginIds) {
        const entry = manifest.runtime[id];
        if (entry?.loadAllowed === false || entry?.descriptorStatus !== 'ready') continue;
        const descriptor = entry.descriptor;
        if (
            descriptor.manifestVersion !== 2 ||
            descriptor.trust !== 'trusted-host' ||
            descriptor.workspaceId !== workspaceId ||
            !descriptor.artifact.clientEntry ||
            descriptor.artifact.client?.isolation !== 'host'
        ) continue;
        desired.set(id, descriptor);
    }
    return desired;
}

/** Serializes trusted package setup and teardown across manifest revisions. */
export class TrustedV2ClientManager {
    readonly #options: TrustedV2ManagerOptions;
    readonly #active = new Map<string, {
        descriptor: PackageV2PluginDescriptor;
        activation: TrustedV2Activation;
    }>();
    readonly #observations = shallowReactive(new Map<string, TrustedV2ObservedActivation>());
    #generation = 0;
    #controller = new AbortController();
    #queue: Promise<void> = Promise.resolve();

    constructor(options: TrustedV2ManagerOptions) {
        this.#options = options;
    }

    get observedActivations(): ReadonlyMap<string, TrustedV2ObservedActivation> {
        return this.#observations;
    }

    reconcile(manifest: PluginRuntimeManifestResponse, workspaceId: string): Promise<void> {
        const wanted = desiredDescriptors(manifest, workspaceId);
        const generation = ++this.#generation;
        this.#controller.abort('manifest-replaced');
        const controller = new AbortController();
        this.#controller = controller;
        const isCurrent = () => generation === this.#generation && !controller.signal.aborted;
        return this.#enqueue(async () => {
            const cleanupErrors: unknown[] = [];
            for (const [id, current] of this.#active) {
                const next = wanted.get(id);
                if (
                    next?.descriptorKey === current.descriptor.descriptorKey &&
                    next.workspaceId === current.descriptor.workspaceId
                ) continue;
                try {
                    await current.activation.dispose();
                    this.#active.delete(id);
                    this.#observations.delete(id);
                } catch (error) {
                    cleanupErrors.push(error);
                    try { this.#options.onError?.(id, error); } catch { /* Continue disposing the remaining plugins. */ }
                }
            }
            if (cleanupErrors.length) throw cleanupErrors[0];
            for (const [id, descriptor] of wanted) {
                if (!isCurrent()) return;
                if (this.#active.has(id)) continue;
                try {
                    const activation = await this.#options.activate(
                        descriptor, generation, controller.signal,
                        isCurrent
                    );
                    if (!isCurrent()) {
                        await activation.dispose();
                        return;
                    }
                    this.#active.set(id, { descriptor, activation });
                    this.#observations.set(id, {
                        pluginId: id,
                        version: descriptor.version,
                        packageDigest: descriptor.artifact.packageDigest,
                        workspaceId: descriptor.workspaceId,
                        observedAt: new Date().toISOString(),
                    });
                } catch (error) {
                    if (isCurrent()) this.#options.onError?.(id, error);
                }
            }
        });
    }

    stopAll(): Promise<void> {
        ++this.#generation;
        this.#controller.abort('workspace-ended');
        return this.#enqueue(async () => {
            const cleanupErrors: unknown[] = [];
            for (const [id, current] of this.#active) {
                try {
                    await current.activation.dispose();
                    this.#active.delete(id);
                    this.#observations.delete(id);
                } catch (error) {
                    cleanupErrors.push(error);
                    try { this.#options.onError?.(id, error); } catch { /* Continue disposing the remaining plugins. */ }
                }
            }
            if (cleanupErrors.length) throw cleanupErrors[0];
        });
    }

    #enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.#queue.then(task);
        this.#queue = run.catch(() => {});
        return run;
    }
}

let installedManager: TrustedV2ClientManager | null = null;
const noActivations: ReadonlyMap<string, TrustedV2ObservedActivation> = new Map();

/** Workspace DB teardown waits for trusted package cleanup before switching. */
export function installTrustedV2ClientManager(manager: TrustedV2ClientManager): void {
    installedManager = manager;
}

/** Browser-local evidence that the exact trusted package completed setup. */
export function useTrustedV2Activations(): ReadonlyMap<string, TrustedV2ObservedActivation> {
    return installedManager?.observedActivations ?? noActivations;
}

export async function stopAllTrustedV2ClientsAndAwait(): Promise<void> {
    await installedManager?.stopAll();
}

import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { BundledV1PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import { BundledV1Loader } from '~~/shared/plugins/bundled-v1-loader';
import {
    BundledV1PluginManager,
    type BundledV1ManagerDesiredState,
    type ManagedBundledV1Instance,
} from '~~/shared/plugins/bundled-v1-manager';
import {
    createManagedWorkspacePluginRuntime,
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
    type Or3WorkspacePlugin,
} from './workspace-runtime';

export const WORKSPACE_PLUGIN_RECONCILE_EVENT = 'or3:workspace-plugin-reconcile';

export type WorkspacePluginReconcileReason =
    | 'workspace-session-change'
    | 'local-admin-change'
    | 'focus-refresh'
    | 'manifest-revision-change'
    | 'boot';

export interface WorkspacePluginReconcileEventDetail {
    readonly reason: Extract<
        WorkspacePluginReconcileReason,
        'local-admin-change' | 'manifest-revision-change'
    >;
}

export function requestWorkspacePluginReconcile(
    reason: WorkspacePluginReconcileEventDetail['reason'] = 'local-admin-change'
): void {
    if (!import.meta.client) return;
    window.dispatchEvent(
        new CustomEvent<WorkspacePluginReconcileEventDetail>(WORKSPACE_PLUGIN_RECONCILE_EVENT, {
            detail: { reason },
        })
    );
}

export function parseWorkspacePluginModule(
    mod: unknown,
    pluginId: string
): Or3WorkspacePlugin | null {
    const raw = ((mod as { default?: unknown })?.default ?? mod) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const plugin = raw as Partial<Or3WorkspacePlugin>;
    if (typeof plugin.register !== 'function') return null;
    const resolvedId =
        typeof plugin.id === 'string' && plugin.id.trim().length > 0 ? plugin.id : pluginId;
    if (resolvedId !== pluginId) return null;
    return { id: pluginId, register: plugin.register.bind(plugin) };
}

export interface CreateBundledV1WorkspaceManagerOptions {
    readonly loader: BundledV1Loader;
    readonly getWorkspaceId: () => string | null | undefined;
    readonly fetchManifest: (signal: AbortSignal) => Promise<PluginRuntimeManifestResponse>;
}

type ManagerRuntimeGlobals = typeof globalThis & {
    __or3BundledV1WorkspaceManager?: BundledV1PluginManager;
};

export function getBundledV1WorkspaceManager(): BundledV1PluginManager | null {
    return (globalThis as ManagerRuntimeGlobals).__or3BundledV1WorkspaceManager ?? null;
}

function desiredStateFromManifest(
    manifest: PluginRuntimeManifestResponse,
    workspaceId: string
): BundledV1ManagerDesiredState {
    if (manifest.workspaceId !== workspaceId) {
        throw new Error('Runtime manifest workspace does not match the active session');
    }
    const descriptors: BundledV1PluginDescriptor[] = [];
    for (const pluginId of manifest.enabledPluginIds) {
        const runtime = manifest.runtime[pluginId];
        if (runtime?.loadAllowed !== false && runtime?.descriptorStatus === 'ready') {
            descriptors.push(runtime.descriptor);
        }
    }
    descriptors.sort((left, right) => left.id.localeCompare(right.id));
    return { descriptors, revision: manifest.revision };
}

export function createBundledV1WorkspaceManager(
    options: CreateBundledV1WorkspaceManagerOptions
): BundledV1PluginManager {
    const manager = new BundledV1PluginManager({
        async fetchDesired(signal) {
            const workspaceId = options.getWorkspaceId();
            if (!workspaceId) return { descriptors: [], revision: 'no-workspace' };
            const manifest = await options.fetchManifest(signal);
            return desiredStateFromManifest(manifest, workspaceId);
        },
        async load(descriptor, signal): Promise<ManagedBundledV1Instance> {
            const resolution = options.loader.resolve(descriptor.id);
            if (
                resolution.status !== 'ready' ||
                resolution.artifact.hostBuildId !== descriptor.artifact.hostBuildId ||
                resolution.moduleKey !== descriptor.artifact.moduleKey
            ) {
                throw new Error('Bundled V1 artifact no longer matches the desired descriptor');
            }
            const mod = await resolution.load();
            if (signal.aborted) throw signal.reason;
            const plugin = parseWorkspacePluginModule(mod, descriptor.id);
            if (!plugin) throw new Error('Invalid plugin module export or plugin id mismatch');
            const runtime = createManagedWorkspacePluginRuntime();
            let registered = false;
            return {
                async register() {
                    await plugin.register(runtime.api);
                    if (signal.aborted) throw signal.reason;
                    const registration = registerWorkspacePluginInstance(
                        descriptor.id,
                        'extension',
                        async () => {
                            await runtime.dispose();
                        }
                    );
                    if (!registration.accepted) {
                        throw new Error(
                            `Plugin registration rejected by active ${registration.replacedSource ?? 'unknown'} owner`
                        );
                    }
                    registered = true;
                },
                async stop(reason) {
                    if (registered) {
                        registered = false;
                        unregisterWorkspacePluginInstance(descriptor.id);
                    }
                    return runtime.dispose(reason);
                },
            };
        },
    });
    (globalThis as ManagerRuntimeGlobals).__or3BundledV1WorkspaceManager = manager;
    return manager;
}

export function isWorkspaceManagerCanary(input: {
    readonly enabled: boolean;
    readonly workspaceIds: readonly string[];
    readonly workspaceId: string | null | undefined;
}): boolean {
    if (!input.enabled || !input.workspaceId) return false;
    return input.workspaceIds.length === 0 || input.workspaceIds.includes(input.workspaceId);
}

/** Captures an immutable boot decision; later config mutations cannot switch kernels. */
export function createWorkspaceManagerCanarySelector(flags: {
    readonly enabled: boolean;
    readonly workspaceIds: readonly string[];
}): (workspaceId: string | null | undefined) => boolean {
    const enabled = flags.enabled;
    const workspaceIds = Object.freeze([...flags.workspaceIds]);
    return (workspaceId) =>
        isWorkspaceManagerCanary({ enabled, workspaceIds, workspaceId });
}

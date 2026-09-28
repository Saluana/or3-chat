import * as Sdk from '@or3/plugin-sdk';
import type { PluginContext, PluginGrant, Or3PluginDefinition } from '@or3/plugin-sdk';
import * as Vue from 'vue';
import { watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useHooks } from '~/core/hooks/useHooks';
import { createTrustedHostContext } from '~/composables/plugins/trusted-host-context';
import { applyTrustedEditorExtensions } from '~/composables/plugins/trusted-editor';
import {
    TrustedV2ClientManager,
    installTrustedV2ClientManager,
} from '~/composables/plugins/trusted-v2-manager';
import { WORKSPACE_PLUGIN_RECONCILE_EVENT } from '~/composables/plugins/bundled-v1-manager-runtime';
import { createProductionModuleV2Loader } from '~~/shared/plugins/host-esm-facade-runtime';
import { buildPluginPackageAssetUrl } from '~~/shared/plugins/module-v2-loader';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

const AGENT_BRIDGE_GRANTS: readonly PluginGrant[] = [
    'ui.sidebar.register', 'ui.pane.register', 'ui.command-palette.register',
    'commands.register', 'panes.open', 'activity.register', 'workspace.read',
    'storage.read', 'storage.write', 'secrets.read', 'secrets.write', 'secrets.use',
    'files.read', 'files.write', 'network.http', 'network.stream',
];
const WORKFLOW_BRIDGE_GRANTS: readonly PluginGrant[] = [
    'ui.sidebar.register', 'ui.pane.register', 'ui.command-palette.register',
    'chat.message.renderer', 'chat.editor.extension', 'tools.register.client',
    'tools.model.register', 'activity.register', 'posts.read', 'posts.write',
    'hooks.register',
];

function requireGrants(descriptor: PackageV2PluginDescriptor, required: readonly PluginGrant[]): void {
    const granted = new Set(descriptor.effectiveGrants);
    const missing = required.filter((grant) => !granted.has(grant));
    if (missing.length) throw new Error(`Approved grants missing: ${missing.join(', ')}`);
}

async function pluginContext(
    descriptor: PackageV2PluginDescriptor,
    base: PluginContext,
    trusted: ReturnType<typeof createTrustedHostContext>,
    runWithContext: <T>(callback: () => T) => T | Promise<T>,
    setDestinationAuthorizer: (authorize: (url: string, destination: string) => Promise<boolean>) => void
): Promise<PluginContext> {
    if (descriptor.id === 'or3-external-agents') {
        requireGrants(descriptor, AGENT_BRIDGE_GRANTS);
        const { createExternalAgentHostBridge } = await import('~/composables/plugins/external-agent-host-bridge');
        const bridge = await runWithContext(() => createExternalAgentHostBridge());
        setDestinationAuthorizer(bridge.authorizeDestination);
        return Object.freeze({
            ...base,
            externalAgentHost: bridge,
        }) as PluginContext;
    }
    if (descriptor.id === 'or3-workflows') {
        requireGrants(descriptor, WORKFLOW_BRIDGE_GRANTS);
        const { createWorkflowHostBridge } = await import('~/composables/plugins/workflow-host-bridge');
        return Object.freeze({
            ...base,
            ui: Object.freeze({
                ...base.ui,
                workflowHostIntegrations: {
                    ...(await runWithContext(() => createWorkflowHostBridge())),
                    registerRenderer: trusted.renderers.register,
                    registerEditor: trusted.editor.register,
                },
            }),
        }) as PluginContext;
    }
    return base;
}

function pluginDefinition(module: unknown, descriptor: PackageV2PluginDescriptor): Or3PluginDefinition {
    const definition = (module as { default?: unknown })?.default as Or3PluginDefinition | undefined;
    if (
        !definition || typeof definition.setup !== 'function' ||
        definition.manifest?.manifestVersion !== 2 ||
        definition.manifest.id !== descriptor.id ||
        definition.manifest.version !== descriptor.version ||
        definition.manifest.trust !== 'trusted-host'
    ) {
        throw new Error('Loaded plugin definition does not match its reviewed descriptor');
    }
    return definition;
}

async function attachStylesheet(
    module: unknown,
    descriptor: PackageV2PluginDescriptor,
    signal: AbortSignal
): Promise<() => void> {
    const stylesheet = (module as { __or3PluginStylesheet?: unknown })?.__or3PluginStylesheet;
    if (stylesheet === undefined) return () => {};
    const entry = descriptor.artifact.clientEntry!;
    const expected = `./${entry.split('/').at(-1)?.replace(/\.[^.]+$/, '.css')}`;
    if (stylesheet !== expected) throw new Error('Invalid plugin stylesheet path');
    const directory = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
    const href = buildPluginPackageAssetUrl({
        pluginId: descriptor.id,
        packageDigest: descriptor.artifact.packageDigest,
        entryPath: `${directory}${stylesheet.slice(2)}`,
    });
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            link.removeEventListener('load', loaded);
            link.removeEventListener('error', failed);
            signal.removeEventListener('abort', aborted);
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('Plugin stylesheet failed to load')); };
        const aborted = () => { cleanup(); reject(new Error('Plugin activation cancelled')); };
        link.addEventListener('load', loaded);
        link.addEventListener('error', failed);
        signal.addEventListener('abort', aborted, { once: true });
        document.head.append(link);
        if (signal.aborted) aborted();
    }).catch((error) => {
        link.remove();
        throw error;
    });
    return () => link.remove();
}

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig();
    if (
        config.public.ssrAuthEnabled !== true ||
        config.public.admin?.pluginRuntimeLoaderEnabled === false ||
        config.public.admin?.pluginRuntimeV2Enabled !== true
    ) return;

    const loader = createProductionModuleV2Loader({
        assetUrl: buildPluginPackageAssetUrl,
        hostExternals: { vue: Vue, '@or3/plugin-sdk': Sdk },
    });
    const session = useSessionContext();
    const hostHooks = useHooks();
    const onEditorFilter = hostHooks.on as unknown as (
        name: string,
        callback: (existing: unknown[]) => unknown[],
        options: { kind: 'filter' }
    ) => () => void;
    onEditorFilter(
        'ui.chat.editor:filter:extensions',
        (existing) => applyTrustedEditorExtensions(existing as object[]),
        { kind: 'filter' }
    );
    const manager = new TrustedV2ClientManager({
        async activate(descriptor, generation, signal, isCurrent) {
            const resolution = loader.resolve({
                descriptor, generation, signal, isGenerationCurrent: isCurrent,
                requiresTrustedHostUi: true,
            });
            if (resolution.status !== 'ready') {
                throw new Error(`${resolution.code}: ${resolution.message}`);
            }
            const loaded = await resolution.load();
            if (loaded.status !== 'loaded') throw new Error(`Plugin load ${loaded.reason}`);
            const definition = pluginDefinition(loaded.module, descriptor);
            let authorizeDestination = async (_url: string, _destination: string) => false;
            const trusted = await nuxtApp.runWithContext(() => createTrustedHostContext({
                pluginId: descriptor.id,
                version: descriptor.version,
                workspaceId: descriptor.workspaceId,
                generation,
                grants: descriptor.effectiveGrants as PluginGrant[],
                mediation: {
                    authorizeDestination: (url, destination) => authorizeDestination(url, destination),
                },
                subscribeWorkspaceChanges(listener) {
                    const stop = watch(
                        () => session.data.value?.session?.workspace?.id,
                        (id, previousId) => {
                            if (id && previousId && id !== previousId) {
                                void listener({ previousId, id, reason: 'host' });
                            }
                        }
                    );
                    return { dispose: stop };
                },
                subscribeHook(name, kind, callback, options) {
                    const on = hostHooks.on as unknown as (
                        name: string,
                        callback: (...args: unknown[]) => unknown,
                        options: { kind: 'action' | 'filter'; priority?: number }
                    ) => () => void;
                    const off = on(name, callback, { kind, priority: options?.priority });
                    options?.signal?.addEventListener('abort', off, { once: true });
                    return () => {
                        options?.signal?.removeEventListener('abort', off);
                        off();
                    };
                },
            }));
            let removeStyles = () => {};
            try {
                const context = await pluginContext(
                    descriptor, trusted.context, trusted,
                    (callback) => nuxtApp.runWithContext(callback),
                    (authorize) => { authorizeDestination = authorize; }
                );
                if (!isCurrent()) throw new Error('Plugin activation cancelled');
                removeStyles = await attachStylesheet(loaded.module, descriptor, signal);
                if (!isCurrent()) throw new Error('Plugin activation cancelled');
                await definition.setup(context);
                if (!isCurrent()) throw new Error('Plugin activation cancelled');
                return {
                    async dispose() {
                        await trusted.dispose('plugin-disabled');
                        removeStyles();
                    },
                };
            } catch (error) {
                await trusted.dispose(error);
                removeStyles();
                throw error;
            }
        },
        onError(id, error) {
            console.error(`[trusted-v2-clients] activation failed for ${id}`, error);
        },
    });
    installTrustedV2ClientManager(manager);
    let fetchGeneration = 0;
    const reconcile = async (workspaceChanged = false) => {
        const fetchId = ++fetchGeneration;
        // Own the transition here: teardown must precede activation for the
        // destination workspace, even when portable cleanup is still pending.
        if (workspaceChanged) {
            try {
                await manager.stopAll();
            } catch (error) {
                console.error('[trusted-v2-clients] workspace teardown failed', error);
                return;
            }
        }
        if (fetchId !== fetchGeneration) return;
        const workspaceId = session.data.value?.session?.workspace?.id;
        if (!workspaceId) {
            await manager.stopAll();
            return;
        }
        try {
            const manifest = await $fetch<PluginRuntimeManifestResponse>('/api/plugins/runtime-manifest', {
                cache: 'no-store',
            });
            if (fetchId !== fetchGeneration) return;
            await manager.reconcile(manifest, workspaceId);
        } catch (error) {
            if (fetchId === fetchGeneration) {
                console.error('[trusted-v2-clients] manifest reconciliation failed', error);
            }
        }
    };
    watch(() => session.data.value?.session?.workspace?.id, () => { void reconcile(true); }, { immediate: true });
    window.addEventListener(WORKSPACE_PLUGIN_RECONCILE_EVENT, () => { void reconcile(); });
    window.addEventListener('focus', () => { void reconcile(); });
    window.addEventListener('beforeunload', () => { void manager.stopAll(); });
});

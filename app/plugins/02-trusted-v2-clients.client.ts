import * as Sdk from '@or3/plugin-sdk';
import type { PluginJsonValue, PluginGrant, Or3PluginDefinition } from '@or3/plugin-sdk';
import * as Vue from 'vue';
import { watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useHooks } from '~/core/hooks/useHooks';
import { getDb } from '~/db/client';
import { migrateLegacyPluginData } from '~/composables/plugins/legacy-plugin-data';
import { createTrustedRuntimeServices } from '~/composables/plugins/trusted-runtime-services';
import { createTrustedHostContext } from '~/composables/plugins/trusted-host-context';
import { applyTrustedEditorExtensions } from '~/composables/plugins/trusted-editor';
import {
    TrustedV2ClientManager,
    installTrustedV2ClientManager,
} from '~/composables/plugins/trusted-v2-manager';
import { getWorkspacePluginCoordinator } from '~/composables/plugins/workspace-plugin-coordinator';
import { createProductionModuleV2Loader } from '~~/shared/plugins/host-esm-facade-runtime';
import { buildPluginPackageAssetUrl } from '~~/shared/plugins/module-v2-loader';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

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
    const offEditorFilter = onEditorFilter(
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
            const manifestDefaults: Record<string, PluginJsonValue> = {};
            if (definition.manifest.settings.schema) {
                const response = await fetch(buildPluginPackageAssetUrl({ pluginId: descriptor.id, packageDigest: descriptor.artifact.packageDigest, entryPath: definition.manifest.settings.schema }), { signal, credentials: 'same-origin' });
                if (!response.ok) throw new Error('Plugin settings schema unavailable');
                const schema = await response.json() as { properties?: Record<string, { default?: PluginJsonValue }> };
                for (const [key, property] of Object.entries(schema.properties ?? {})) {
                    if (property.default !== undefined) manifestDefaults[key] = property.default;
                }
            }
            const trusted = await nuxtApp.runWithContext(() => createTrustedHostContext({
                pluginId: descriptor.id,
                version: descriptor.version,
                workspaceId: descriptor.workspaceId,
                generation, signal,
                features: ['or3-trusted-host-v1', 'chat.send.prepare-commit-v1', 'or3-trusted-ui-kit-v1', 'or3-trusted-host-v2', 'or3-trusted-chat-records-v1'],
                requestedFeatures: definition.manifest.features.required,
                runtimeServices: createTrustedRuntimeServices,
                settingDefaults: manifestDefaults,
                emitHook: (name, payload) => (hostHooks.doAction as unknown as (name: string, payload: unknown) => Promise<void>)(name, payload),
                grants: descriptor.effectiveGrants as PluginGrant[],
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
                for (const feature of definition.manifest.features.required) trusted.context.features.require(feature);
                const activationDb = getDb();
                await migrateLegacyPluginData({ pluginId: descriptor.id, stateVersion: definition.manifest.stateCompatibility.version, db: activationDb, current: () => isCurrent() && getDb() === activationDb && !signal.aborted });
                if (!isCurrent()) throw new Error('Plugin activation cancelled');
                removeStyles = await attachStylesheet(loaded.module, descriptor, signal);
                if (!isCurrent()) throw new Error('Plugin activation cancelled');
                await definition.setup(trusted.context);
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
    const unregister = getWorkspacePluginCoordinator().register({
        name: 'trusted-v2',
        stop: () => manager.stopAll(),
        reconcile: (manifest) => manager.reconcile(manifest, manifest.workspaceId!),
    });
    if (import.meta.hot) import.meta.hot.dispose(() => {
        offEditorFilter();
        void unregister();
    });
});

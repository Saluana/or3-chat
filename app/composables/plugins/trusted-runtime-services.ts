import { createRuntimeUuid } from '~~/shared/runtime-id';
import { buildPluginSettingDefaults } from '~~/server/admin/config/plugin-setting-defaults';
import { watch } from 'vue';
import { useAppConfig, useRuntimeConfig, useToast } from '#imports';
import { pluginError, pluginOk, type PluginHostClients, type PluginGrant, type PluginJsonValue } from '@or3/plugin-sdk';
import { createTrustedUiKit } from './trusted-ui-kit';
import { useOr3Config } from '~/composables/useOr3Config';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { useUserApiKey } from '~/core/auth/useUserApiKey';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { DEFAULT_HEADERS } from '~~/shared/openrouter/request-options';
import { setActiveSidebarPage } from '~/composables/sidebar/useActiveSidebarPage';
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
import { registerWorkspaceProfile } from '~/core/workspace-profiles/registry';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { programmaticPrefill } from '~/composables/chat/useChatInputBridge';
import { ensureBackgroundJobTracker } from '~/utils/chat/useAi-internal/backgroundJobs';
import { abortBackgroundJob, pollJobStatus, isBackgroundStreamingEnabled } from '~/utils/chat/openrouterStream';
import { getActiveWorkspaceId, type Or3DB } from '~/db/client';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';
import { resolveChatProject } from '~/db/project-workspace';

/** Resolve Nuxt services once during activation; callbacks retain their authority. */
export function createTrustedRuntimeServices(input: {
    pluginId: string; db: Or3DB; messageTypes?: ReadonlySet<string>; allow(grant: PluginGrant): void; current(): boolean;
    cleanup(callback: () => void): void;
}) {
    const runtime = useRuntimeConfig(); const config = useOr3Config();
    const toast = useToast(); const session = useSessionContext(); const { apiKey } = useUserApiKey();
    const models = useModelStore(); const registry = useToolRegistry();
    const run = async <T>(grant: PluginGrant, callback: () => Promise<T>) => {
        try { input.allow(grant); const result = await callback(); input.allow(grant); return pluginOk(result); }
        catch (error) { const e = error as { code?: string; message?: string }; return pluginError((e.code || 'host-unavailable') as Parameters<typeof pluginError>[0], e.message || 'Host operation failed'); }
    };
    const connectEnabled = () => runtime.public.ssrAuthEnabled === true && runtime.public.connect.enabled === true;
    const connections: PluginHostClients['workspace']['connections'] = {
        status: () => run('workspace.connections.read', async () => {
            if (!connectEnabled()) throw Object.assign(new Error('Connect is disabled'), { code: 'unsupported' });
            return { enabled: true, pairingUrl: runtime.public.connect.publicUrl };
        }),
        list: () => run('workspace.connections.read', async () => {
            if (!connectEnabled()) throw Object.assign(new Error('Connect is disabled'), { code: 'unsupported' });
            const response = await fetch('/api/connect/environments', { credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(`Connect environments failed (${response.status})`);
            const data = await response.json() as { environments: Array<{ id: string; name: string; baseUrl: string; accessToken: string; driver: string; runtime: string; hostname: string; basePath: string }> };
            return data.environments.map(row => ({ id: row.id, label: row.name, provider: row.driver, status: 'configured' as const, capabilities: [], baseUrl: row.baseUrl, credential: row.accessToken, metadata: { runtime: row.runtime, hostname: row.hostname, basePath: row.basePath } }));
        }),
        remove: id => run('workspace.connections.manage', async () => {
            if (!connectEnabled()) throw Object.assign(new Error('Connect is disabled'), { code: 'unsupported' });
            const response = await fetch('/api/connect/environments/remove', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Or3-Connect-Intent': 'remove' }, body: JSON.stringify({ environmentId: id }) });
            if (!response.ok) throw new Error(`Connect removal failed (${response.status})`);
            window.dispatchEvent(new CustomEvent('connections.changed', { detail: { revision: Date.now() } }));
        }),
        manage: async () => pluginError('unsupported', 'Use connections.remove'),
    };
    const ai: PluginHostClients['ai'] = {
        models: () => run('ai.models', async () => {
            if (!models.catalog.value.length) await models.fetchModels({ ttlMs: 60 * 60 * 1000 });
            const favorites = new Set(models.favoriteModels.value.map(model => model.id));
            return { configured: Boolean(apiKey.value), models: models.catalog.value.map(model => ({ id: model.id, label: model.name || model.id, priced: Boolean(model.pricing), favorite: favorites.has(model.id), metadata: model as unknown as Record<string, unknown> })), limits: { maxOutputTokens: 0, spendLimitUsd: 0, maxConcurrentCalls: 0, deadlineMs: 0 } };
        }),
        provider: originInput => run('ai.provider', async () => {
            if (!apiKey.value) throw Object.assign(new Error('Sign in to OpenRouter'), { code: 'not-signed-in' });
            const origin = originInput && Object.freeze({ ...originInput });
            if (origin && [origin.threadId, origin.messageId, origin.streamId].some(id => typeof id !== 'string' || !id))
                throw Object.assign(new Error('Invalid request origin'), { code: 'invalid-input' });
            const controller = new AbortController(); input.cleanup(() => controller.abort());
            const scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
                threadId: origin?.threadId ?? 'plugin-provider', messageId: origin?.messageId ?? null,
                callId: input.pluginId, requestId: input.pluginId, abortSignal: controller.signal });
            const authorize = async () => {
                input.allow('ai.provider'); scope.assertCurrent('write');
                if (!input.current() || scope.db !== input.db) throw new Error('Plugin workspace changed');
                if (!origin) return;
                await input.db.transaction('r', ['messages', 'threads', 'projects'], async () => {
                    scope.assertCurrent('write');
                    const row = await input.db.messages.get(origin.messageId);
                    const thread = await input.db.threads.get(origin.threadId);
                    if (!row || row.deleted || row.role !== 'assistant' || row.thread_id !== origin.threadId
                        || row.stream_id !== origin.streamId || !thread || thread.deleted
                        || (input.messageTypes && !input.messageTypes.has((row.data as { type?: string })?.type ?? '')))
                        throw new Error('The originating plugin message is no longer available.');
                    if (await resolveChatProject(input.db, origin.threadId))
                        throw new Error('This plugin cannot capture project context. Use a normal project chat.');
                    scope.assertCurrent('write');
                });
            };
            await authorize();
            const [{ HTTPClient }, { createOpenRouterClient }] = await Promise.all([
                import('@openrouter/sdk/lib/http.js'),
                import('~~/shared/openrouter/client'),
            ]);
            await authorize();
            if (!apiKey.value) throw Object.assign(new Error('Sign in to OpenRouter'), { code: 'not-signed-in' });
            const httpClient = new HTTPClient({ fetcher: async (request, init) => {
                await authorize();
                if (!origin && await input.db.projects.filter(project => !project.deleted).count())
                    throw new Error('Request origin is required in workspaces with projects. Update the plugin.');
                scope.assertCurrent('write');
                return fetch(request, { ...init, signal: init?.signal
                    ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
            } });
            return { client: createOpenRouterClient({ apiKey: apiKey.value, httpClient }), apiKey: apiKey.value, headers: DEFAULT_HEADERS };
        }),
        requestSignIn() { input.allow('ai.provider'); window.dispatchEvent(new CustomEvent('openrouter:login')); return pluginOk(undefined); },
        onModelsChange(listener) { input.allow('ai.models'); const stop = watch([models.favoriteModels, models.catalog], () => { if (input.current()) listener(); }, { deep: true }); input.cleanup(stop); return { dispose: stop }; },
        complete: async () => pluginError('unsupported', 'Use the trusted provider client'),
    };
    const tools: PluginHostClients['tools'] = {
        list: () => run('tools.use', async () => registry.listTools.value.map(tool => ({ definition: tool.definition, enabled: tool.enabled.value, workflowPolicy: tool.workflowPolicy }))),
        execute: (name, args, options) => run('tools.use', async () => {
            if (options?.signal?.aborted) throw Object.assign(new Error('Tool cancelled'), { code: 'aborted' });
            const result = await registry.executeTool(name, JSON.stringify(args), { subject: session.data.value?.session?.user?.id ?? null, workspaceId: session.data.value?.session?.workspace?.id ?? null, threadId: null, messageId: null, callId: createRuntimeUuid(), requestId: createRuntimeUuid(), abortSignal: options?.signal ?? new AbortController().signal });
            if (result.error) throw new Error(result.error); return result.result ?? '';
        }),
    };
    const jobs: PluginHostClients['jobs'] = {
        available: () => run('jobs.background', async () => runtime.public.backgroundStreaming.enabled === true && isBackgroundStreamingEnabled(true) && Boolean(session.data.value?.session?.authenticated && session.data.value.session.user?.id)),
        track: value => run('jobs.background', async () => { ensureBackgroundJobTracker({ ...value, userId: session.data.value?.session?.user?.id || '', originDb: input.db, initialContent: '', useSse: true }); }),
        abort: id => run('jobs.background', async () => { await abortBackgroundJob(id); }),
        status: id => run('jobs.background', async () => (await pollJobStatus(id)).status),
    };
    return {
        kit: createTrustedUiKit(), ai, tools, jobs, connections,
        settingDefaults: { ...buildPluginSettingDefaults(config.features.workflows, useAppConfig() as { workflowSlashCommands?: { enabled?: boolean } })[input.pluginId], ...(runtime.public.pluginSettingDefaults as Record<string, Record<string, PluginJsonValue>> | undefined)?.[input.pluginId] },
        limits: { maxFilesPerMessage: config.limits.maxFilesPerMessage, maxFileSizeBytes: config.limits.maxFileSizeBytes },
        toast: ((value) => { input.allow('ui.toast'); toast.add({ title: value.message, description: value.description, duration: value.durationMs, color: value.tone === 'danger' ? 'error' : value.tone === 'neutral' ? 'neutral' : value.tone }); return pluginOk(undefined); }) as PluginHostClients['ui']['toast'],
        sidebar: {
            show: (id: string) => run('ui.sidebar.register', async () => { if (!await setActiveSidebarPage(id)) throw Object.assign(new Error('Sidebar page is not registered'), { code: 'not-found' }); }),
            closeIfMobile() { input.allow('ui.sidebar.register'); closeSidebarIfMobile(); return pluginOk(undefined); },
        },
        registerProfile(profile: unknown) { input.allow('ui.workspace-profile.register'); const handle = registerWorkspaceProfile(profile, { source: { kind: 'plugin', id: input.pluginId } }); input.cleanup(() => handle.dispose()); return handle; },
        prefill: (text: string, paneId?: string) => run('chat.editor.extension', async () => {
            const api = getGlobalMultiPaneApi(); const id = paneId ?? api?.panes.value[api.activePaneIndex.value]?.id;
            if (!id || programmaticPrefill(id, text).status !== 'ready') throw Object.assign(new Error('Composer unavailable'), { code: 'host-unavailable' });
        }),
        async confirmOrigins(origins: readonly string[], purpose: string) {
            // Browser confirmation is host-owned and cannot be replaced by package UI.
            return window.confirm(`Allow ${input.pluginId} to connect?\n\n${purpose}\n\n${origins.join('\n')}`);
        },
    };
}

import { shallowRef, toValue, watch, onScopeDispose, type MaybeRefOrGetter } from 'vue';
import { getDb, getWorkspaceGeneration, getActiveWorkspaceId, subscribeActiveWorkspaceDb } from '~/db/client';
import { resolveThreadProjection } from '~/utils/chat/compaction/history';
import { storedMessagesToCanonicalTranscript, projectTranscriptForOpenRouter } from '~/utils/chat/transcript';
import { buildSystemPromptMessage } from '~/utils/chat/useAi-internal/messageBuild';
import { countTokensApprox } from '~/utils/chat/tokens';
import { useAiSettings } from './useAiSettings';
import { useModelStore } from './useModelStore';
import { admitChatContext, type ContextAdmission, type CountableChatMessage } from '~~/shared/chat/context-budget';
import { estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { buildOpenRouterRequestBody } from '~/utils/chat/openrouterStream';
import { useRuntimeConfig } from '#imports';

/** Read-only advisory preview. It never resolves media bytes or invokes send hooks. */
export function useContextPreview(options: {
    threadId: MaybeRefOrGetter<string | undefined>;
    model: MaybeRefOrGetter<string>;
    text: MaybeRefOrGetter<string>;
    extraText?: MaybeRefOrGetter<string>;
    hasMedia?: MaybeRefOrGetter<boolean>;
    promptSelection?: MaybeRefOrGetter<string | null | undefined>;
    revision?: MaybeRefOrGetter<unknown>;
    reasoning?: MaybeRefOrGetter<import('~/utils/chat/openrouterStream').OpenRouterReasoningConfig | undefined>;
}) {
    const state = shallowRef<{ admission?: ContextAdmission; pending: boolean; unavailable?: string }>({ pending: false });
    const preferences = useAiSettings(); const models = useModelStore();
    const tools = useToolRegistry(); const runtime = useRuntimeConfig();
    const workspaceRevision = shallowRef(getWorkspaceGeneration());
    let sequence = 0; let timer: ReturnType<typeof setTimeout> | undefined; let controller: AbortController | undefined;
    const memo = new Map<string, number>();
    const countText = async (text: string) => {
        const cached = memo.get(text); if (cached !== undefined) return cached;
        const count = await countTokensApprox(text); memo.set(text, count); return count;
    };
    const unsubscribe = subscribeActiveWorkspaceDb(() => { memo.clear(); workspaceRevision.value = getWorkspaceGeneration(); });
    const stop = watch(() => [toValue(options.threadId), toValue(options.model), toValue(options.text),
        toValue(options.extraText), toValue(options.hasMedia), toValue(options.promptSelection),
        toValue(options.revision), toValue(options.reasoning), tools.listTools.value.map((tool) => [tool.definition, tool.enabled.value]),
        preferences.settings.value, workspaceRevision.value], () => {
        const token = ++sequence; controller?.abort(); if (timer) clearTimeout(timer);
        state.value = { ...state.value, pending: true };
        timer = setTimeout(() => { void refresh(token); }, 120);
    }, { immediate: true });
    async function refresh(token: number) {
        const db = getDb(); const generation = getWorkspaceGeneration();
        const threadId = toValue(options.threadId); const model = toValue(options.model);
        const text = [toValue(options.text), toValue(options.extraText)].filter(Boolean).join('\n\n');
        const hasMedia = toValue(options.hasMedia); const promptSelection = toValue(options.promptSelection);
        controller = new AbortController(); const signal = controller.signal;
        const current = () => !signal.aborted && sequence === token && getDb() === db && getWorkspaceGeneration() === generation;
        try {
            await preferences.ensureLoaded(); if (!current()) return;
            const settings = { ...preferences.settings.value };
            const projection = threadId ? await resolveThreadProjection(threadId, db) : undefined;
            if (!current()) return;
            const messages: CountableChatMessage[] = projection
                ? projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript(projection.messages)) : [];
            const system = await buildSystemPromptMessage({ threadId, promptSelection,
                activePromptContent: null, masterPrompt: settings.masterSystemPrompt });
            if (system) messages.unshift({ role: system.role, content: system.content as CountableChatMessage['content'] });
            if (text || hasMedia) messages.push({ role: 'user', content: hasMedia
                ? [{ type: 'text', text }, { type: 'image_url' }] : text });
            const readiness = await models.resolveContextModel(model, { signal }); if (!current()) return;
            if (!readiness.ok) { state.value = { pending: false, admission: readiness }; return; }
            let usage: unknown;
            for (const row of [...(projection?.messages ?? [])].reverse()) {
                if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
                    usage = (row.data as Record<string, unknown>).usage; if (usage) break;
                }
            }
            const catalogModel = models.catalog.value.find((row) => row.id === readiness.modelId)
                ?? models.favoriteModels.value.find((row) => row.id === readiness.modelId);
            const enabled = !catalogModel?.supported_parameters || catalogModel.supported_parameters.includes('tools')
                ? tools.getEnabledDefinitions({ workspaceId: getActiveWorkspaceId(), threadId: threadId ?? null }) : [];
            const definitions = runtime.public.backgroundStreamingEnabled === true ? enabled : enabled.filter((tool) => tool.runtime !== 'server');
            const body = buildOpenRouterRequestBody({ model, orMessages: messages as Parameters<typeof buildOpenRouterRequestBody>[0]['orMessages'],
                modalities: ['text'], tools: definitions.length ? definitions : undefined, reasoning: toValue(options.reasoning) });
            const { messages: wireMessages, ...configuration } = body;
            const estimate = await estimateMeasuredChatRequest({ model, messages: wireMessages, tools: body.tools,
                modalities: body.modalities, configuration, usage, countText });
            if (current()) state.value = { pending: false, admission: admitChatContext({ model: readiness.metadata,
                inputTokens: estimate.input_tokens, estimate, userMaxContextTokens: settings.maxContextTokens, source: readiness.source }) };
            // Evict prior revisions, preserving all contributions used by the current estimate.
            // No conversation-length limit is applied: the memo is merely a reusable text-count cache.
            const used = new Set(messages.flatMap((row) => typeof row.content === 'string' ? [row.content]
                : (row.content ?? []).flatMap((part) => typeof part.text === 'string' ? [part.text] : [])));
            for (const key of memo.keys()) if (!used.has(key)) memo.delete(key);
        } catch {
            if (current()) state.value = { pending: false, unavailable: 'Context estimate unavailable. Refresh models or retry when this conversation has synced.' };
        }
    }
    onScopeDispose(() => { sequence++; controller?.abort(); if (timer) clearTimeout(timer); stop(); unsubscribe(); memo.clear(); });
    return { state, refresh: async () => {
        const token = ++sequence; controller?.abort(); state.value = { ...state.value, pending: true };
        try { await models.refreshModels(); } catch { /* Readiness below supplies the recoverable state. */ }
        if (sequence === token) await refresh(token);
    } };
}

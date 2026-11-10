/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 */

import { defineNuxtPlugin } from '#app';
import { useAppConfig, useHooks } from '#imports';
import { useOr3Config, isMentionSourceEnabled } from '~/composables/useOr3Config';
import type { OpenRouterMessage } from '~/core/hooks/hook-types';
import type * as MentionIndexApi from './ChatMentions/useChatMentions';
import mentionsIndex, { resetIndex, setMentionsConfig } from './ChatMentions/useChatMentions';
import type { createMentionSuggestion } from './ChatMentions/suggestions';
import type MentionExtension from '@tiptap/extension-mention';
import { getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import { registerBuiltinMentionFilter } from '~/utils/chat/mention-filter-identity';

type MentionsConfig = {
    enabled?: boolean;
    maxPerGroup?: number;
    maxContextBytes?: number;
    debounceMs?: number;
};

type MentionsModule = {
    Mention: typeof MentionExtension;
    initMentionsIndex: typeof MentionIndexApi.initMentionsIndex;
    searchMentions: typeof MentionIndexApi.searchMentions;
    collectMentions: typeof MentionIndexApi.collectMentions;
    resolveMention: typeof MentionIndexApi.resolveMention;
    resetIndex: typeof MentionIndexApi.resetIndex;
    createMentionSuggestion: typeof createMentionSuggestion;
};

type MessagesPayload =
    | { messages: OpenRouterMessage[]; editorDoc?: Record<string, unknown> | null }
    | { messages: OpenRouterMessage[] }[];

function isNonNullObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeMessagesPayload(
    payload: MessagesPayload
): OpenRouterMessage[] {
    if (Array.isArray(payload)) {
        // Array of { messages: ... } objects
        return payload.flatMap((p) => p.messages);
    }
    if ('messages' in payload && Array.isArray(payload.messages)) {
        return payload.messages;
    }
    return [];
}

export default defineNuxtPlugin((nuxtApp) => {
    // Check OR3 config feature flag (master toggle)
    const or3Config = useOr3Config();
    if (!or3Config.features.mentions.enabled) {
        if (import.meta.dev) {
            console.log('[mentions] Plugin disabled via OR3 config');
        }
        return;
    }

    // Determine which mention sources are enabled
    const documentsEnabled = isMentionSourceEnabled('documents');
    const conversationsEnabled = isMentionSourceEnabled('conversations');

    // If both sources are disabled, no point in initializing
    if (!documentsEnabled && !conversationsEnabled) {
        if (import.meta.dev) {
            console.log('[mentions] All mention sources disabled, skipping initialization');
        }
        return;
    }

    const appConfig = useAppConfig();
    const mentionsConfig: MentionsConfig =
        ((appConfig as Record<string, unknown>)?.mentions as MentionsConfig) ||
        {};

    // Apply application defaults once.
    setMentionsConfig({
        maxPerGroup: mentionsConfig?.maxPerGroup || 5,
        maxContextBytes: mentionsConfig?.maxContextBytes || 50_000,
        enabledSources: {
            documents: documentsEnabled,
            conversations: conversationsEnabled,
        },
    });

    const hooks = useHooks();
    let indexRequested = false;
    let mentionsModule: MentionsModule | null = null;
    let mentionsModulePromise: Promise<MentionsModule | null> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let stopMentionFilter: (() => void) | undefined;
    const refreshDisposers: Array<() => void> = [];
    let disposed = false;
    // Workspace switches and sync batches keep an already-used index warm.
    const refreshMentions = () => {
        resetIndex();
        if (!indexRequested) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { if (!disposed) void mentionsModule?.initMentionsIndex(); }, 120);
    };
    // Local item writes (document autosaves, chat and file updates) only
    // invalidate. The next search, including an open picker, which subscribes
    // to invalidation, rebuilds instead of rescanning after every edit.
    const invalidateMentions = () => { resetIndex(); };
    const stopWorkspace = subscribeActiveWorkspaceDb(refreshMentions);
    const disposeRefresh = () => {
        disposed = true;
        resetIndex();
        clearTimeout(refreshTimer); stopWorkspace(); stopMentionFilter?.(); stopMentionFilter = undefined;
        for (const off of refreshDisposers.splice(0)) off();
    };
    nuxtApp.vueApp.onUnmount(disposeRefresh);
    let extensionsRegistered = false; // Prevent duplicate registrations

    // Lazy load the mentions module
    function loadMentionsModule(): Promise<MentionsModule | null> {
        if (disposed) return Promise.resolve(null);
        if (mentionsModule) return Promise.resolve(mentionsModule);
        if (mentionsModulePromise) return mentionsModulePromise;

        const pending = initializeMentionsModule();
        mentionsModulePromise = pending;
        const clearPending = () => {
            if (mentionsModulePromise === pending) {
                mentionsModulePromise = null;
            }
        };
        void pending.then(clearPending, clearPending);

        return pending;
    }

    async function initializeMentionsModule(): Promise<MentionsModule | null> {
        try {
            const [
                MentionModule,
                { createMentionSuggestion },
            ] = await Promise.all([
                import('@tiptap/extension-mention'),
                import('./ChatMentions/suggestions'),
            ]);

            const {
                initMentionsIndex,
                searchMentions,
                collectMentions,
                resolveMention,
                resetIndex,
            } = mentionsIndex;

            if (disposed) return null;

            mentionsModule = {
                Mention: MentionModule.default,
                initMentionsIndex,
                async searchMentions(query) {
                    indexRequested = true;
                    const generation = getWorkspaceGeneration();
                    await initMentionsIndex();
                    if (disposed || generation !== getWorkspaceGeneration()) return [];
                    return searchMentions(query);
                },
                collectMentions,
                resolveMention,
                resetIndex,
                createMentionSuggestion,
            };

            return mentionsModule;
        } catch (error) {
            console.error('[mentions] Failed to load module:', error);
            return null;
        }
    }

    // Lazy load and provide the extension when an editor requests it
    refreshDisposers.push(hooks.on(
        'editor:request-extensions',
        async () => {
            const module = await loadMentionsModule();
            if (!module) return;

            // Only register the extension filter once
            if (extensionsRegistered) return;
            extensionsRegistered = true;

            // Extend Mention to persist source/id/label
            const MentionWithAttrs = module.Mention.extend({
                addAttributes() {
                    return {
                        id: { default: null },
                        label: { default: null },
                        source: { default: null },
                    };
                },
            });

            const MentionExtension = MentionWithAttrs.configure({
                HTMLAttributes: { class: 'mention' },
                renderText({
                    node,
                }: {
                    node: { attrs: Record<string, unknown> };
                }) {
                    const attrs = node.attrs || {};
                    const label =
                        typeof attrs.label === 'string' ? attrs.label : '';
                    const id = typeof attrs.id === 'string' ? attrs.id : '';
                    return `@${label || id}`;
                },
                suggestion: module.createMentionSuggestion(
                    module.searchMentions,
                    mentionsConfig?.debounceMs ?? 120
                ),
            });

            // Provide the Mention extension via extensions filter
            refreshDisposers.push(hooks.on('ui.chat.editor:filter:extensions', (existing) => {
                const list = Array.isArray(existing) ? existing : [];
                return [...list, MentionExtension];
            }));
        },
        { kind: 'action' }
    ));

    // Inject current context from the request-owned editor snapshot.
    stopMentionFilter = registerBuiltinMentionFilter(
        hooks,
        async (payload: MessagesPayload) => {
            const generation = getWorkspaceGeneration();
            const module = mentionsModule || (await loadMentionsModule());
            if (!module || disposed || generation !== getWorkspaceGeneration()) return payload;

            const originalMessages = normalizeMessagesPayload(payload);

            if (!originalMessages.length) {
                return { messages: originalMessages };
            }

            const lastUser = [...originalMessages]
                .reverse()
                .find((m) => m.role === 'user');

            const editorContent = !Array.isArray(payload) && 'editorDoc' in payload
                ? payload.editorDoc
                : lastUser &&
                isNonNullObject(lastUser) &&
                'editorContent' in lastUser
                    ? (lastUser as Record<string, unknown>).editorContent
                    : null;
            if (!editorContent) {
                return { messages: originalMessages };
            }

            if (!isNonNullObject(editorContent)) {
                return { messages: originalMessages };
            }

            const mentions = module.collectMentions(editorContent as unknown as Parameters<typeof module.collectMentions>[0]);
            if (mentions.length === 0) {
                return { messages: originalMessages };
            }

            const resolved = await Promise.all(
                mentions.map(module.resolveMention)
            );
            if (disposed || generation !== getWorkspaceGeneration() || !resolved.some(Boolean)) {
                return { messages: originalMessages };
            }

            // Build XML-wrapped context with mention metadata
            const escapeXml = (s: string) =>
                s
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');

            const contextMessages: OpenRouterMessage[] = mentions
                .map((m, idx): OpenRouterMessage | null => {
                    const content = resolved[idx];
                    if (!content) return null;
                    const xml = `<context type="mention" source="${
                        m.source
                    }" id="${escapeXml(m.id)}">\n${escapeXml(
                        content
                    )}\n</context>`;
                    return {
                        role: 'system',
                        content: [{ type: 'text', text: xml }],
                    };
                })
                .filter((m): m is OpenRouterMessage => m !== null);

            const merged: OpenRouterMessage[] = [
                ...contextMessages,
                ...originalMessages,
            ];

            return { messages: merged };
        }
    );

    // Invalidation also refreshes an already-open picker without another keystroke.
    for (const name of [
        'sync.bootstrap:action:complete', 'sync.pull:action:applied', 'sync.rescan:action:completed',
    ] as const) {
        refreshDisposers.push(hooks.on(name, refreshMentions, { kind: 'action' }));
    }
    for (const name of [
        'db.posts.create:action:after', 'db.posts.upsert:action:after',
        'db.posts.delete:action:soft:after', 'db.posts.delete:action:hard:after',
        'db.documents.create:action:after', 'db.documents.update:action:after',
        'db.documents.delete:action:soft:after', 'db.documents.delete:action:hard:after',
        'db.threads.create:action:after', 'db.threads.upsert:action:after', 'db.threads.fork:action:after',
        'db.threads.delete:action:soft:after', 'db.threads.delete:action:hard:after',
        'db.files.create:action:after', 'db.files.restore:action:after',
        'db.files.delete:action:soft:after', 'db.files.delete:action:hard:after',
    ] as const) {
        refreshDisposers.push(hooks.on(name, invalidateMentions, { kind: 'action' }));
    }

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            disposeRefresh();
            if (typeof window !== 'undefined') {
                delete (window as { __MENTIONS_EXTENSION__?: unknown })
                    .__MENTIONS_EXTENSION__;
            }
        });
    }
});

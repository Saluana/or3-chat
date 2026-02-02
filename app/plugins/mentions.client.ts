/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 */

import { defineNuxtPlugin } from '#app';
import { useAppConfig, useHooks } from '#imports';
import { useOr3Config, isMentionSourceEnabled } from '~/composables/useOr3Config';
import type {
    OpenRouterMessage,
    DbCreatePayload,
    DbUpdatePayload,
    DbDeletePayload,
    DocumentEntity,
    ThreadEntity,
} from '~/core/hooks/hook-types';
import type * as MentionIndexApi from './ChatMentions/useChatMentions';
import type { createMentionSuggestion } from './ChatMentions/suggestions';
import type MentionExtension from '@tiptap/extension-mention';

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
    upsertDocument: typeof MentionIndexApi.upsertDocument;
    upsertThread: typeof MentionIndexApi.upsertThread;
    removeDocument: typeof MentionIndexApi.removeDocument;
    removeThread: typeof MentionIndexApi.removeThread;
    resetIndex: typeof MentionIndexApi.resetIndex;
    createMentionSuggestion: typeof createMentionSuggestion;
};

type MessagesPayload =
    | { messages: OpenRouterMessage[] }
    | { messages: OpenRouterMessage[] }[];

// DB payload types imported from hook-types

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

function safeId(payload: {
    entity?: { id?: string };
    updated?: { id?: string };
    id?: string;
}): string | null {
    if (typeof payload.id === 'string') return payload.id;
    if (payload.entity && typeof payload.entity.id === 'string')
        return payload.entity.id;
    if (payload.updated && typeof payload.updated.id === 'string')
        return payload.updated.id;
    return null;
}

export default defineNuxtPlugin(() => {
    // Check OR3 config feature flag (master toggle)
    const or3Config = useOr3Config();
    if (!or3Config.features.mentions.enabled) {
        console.log('[mentions] Plugin disabled via OR3 config');
        return;
    }

    // Determine which mention sources are enabled
    const documentsEnabled = isMentionSourceEnabled('documents');
    const conversationsEnabled = isMentionSourceEnabled('conversations');

    // If both sources are disabled, no point in initializing
    if (!documentsEnabled && !conversationsEnabled) {
        console.log('[mentions] All mention sources disabled, skipping initialization');
        return;
    }

    const appConfig = useAppConfig();
    const mentionsConfig: MentionsConfig =
        ((appConfig as Record<string, unknown>)?.mentions as MentionsConfig) ||
        {};

    const hooks = useHooks();
    let indexInitialized = false;
    let mentionsModule: MentionsModule | null = null;
    let lastEditorContent: Record<string, unknown> | null = null; // captured TipTap JSON before send
    let extensionsRegistered = false; // Prevent duplicate registrations

    // Lazy load the mentions module
    async function loadMentionsModule(): Promise<MentionsModule | null> {
        if (mentionsModule) return mentionsModule;

        try {
            const [
                MentionModule,
                mentionsIndexModule,
                { createMentionSuggestion },
            ] = await Promise.all([
                import('@tiptap/extension-mention'),
                import('./ChatMentions/useChatMentions'),
                import('./ChatMentions/suggestions'),
            ]);

            const {
                initMentionsIndex,
                searchMentions,
                collectMentions,
                resolveMention,
                upsertDocument,
                upsertThread,
                removeDocument,
                removeThread,
                resetIndex,
                setMentionsConfig,
            } = mentionsIndexModule.default;

            // Apply runtime configuration (requirement 8.1)
            setMentionsConfig({
                maxPerGroup: mentionsConfig?.maxPerGroup || 5,
                maxContextBytes: mentionsConfig?.maxContextBytes || 50_000,
                enabledSources: {
                    documents: documentsEnabled,
                    conversations: conversationsEnabled,
                },
            });

            mentionsModule = {
                Mention: MentionModule.default,
                initMentionsIndex,
                searchMentions,
                collectMentions,
                resolveMention,
                upsertDocument,
                upsertThread,
                removeDocument,
                removeThread,
                resetIndex,
                createMentionSuggestion,
            };

            // Initialize index once
            if (!indexInitialized) {
                await initMentionsIndex();
                indexInitialized = true;
            }

            return mentionsModule;
        } catch (error) {
            console.error('[mentions] Failed to load module:', error);
            return null;
        }
    }

    // 1) Capture editor JSON before send (avoids string-only later)
    hooks.on(
        'ui.chat.editor:action:before_send',
        (editorJson: unknown) => {
            try {
                lastEditorContent = isNonNullObject(editorJson)
                    ? editorJson
                    : null;
            } catch {
                lastEditorContent = null;
            }
        },
        { kind: 'action' }
    );

    // 2) Lazy load and provide extension when editor requests it
    hooks.on(
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
                    mentionsConfig?.debounceMs || 120
                ),
            });

            // Provide the Mention extension via extensions filter
            hooks.on('ui.chat.editor:filter:extensions', (existing) => {
                const list = Array.isArray(existing) ? existing : [];
                return [...list, MentionExtension];
            });
        },
        { kind: 'action' }
    );

    // 3) Inject context via filter before send (registered once at plugin init)
    hooks.on(
        'ai.chat.messages:filter:before_send',
        async (payload: MessagesPayload) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (!module) return payload;

            const originalMessages = normalizeMessagesPayload(payload);

            if (!originalMessages.length) {
                return { messages: originalMessages };
            }

            const lastUser = [...originalMessages]
                .reverse()
                .find((m) => m.role === 'user');

            const editorContent =
                lastUser &&
                isNonNullObject(lastUser) &&
                'editorContent' in lastUser
                    ? (lastUser as Record<string, unknown>).editorContent ??
                      lastEditorContent
                    : lastEditorContent;
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
            const contextBlocks = resolved.filter(
                (c): c is string => c !== null
            );

            if (contextBlocks.length === 0) {
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
                    const label = m.label || '';
                    const xml = `<context type="mention" source="${
                        m.source
                    }" id="${m.id}" label="${escapeXml(label)}">\n${escapeXml(
                        content
                    )}\n</context>`;
                    return {
                        role: 'system',
                        content: [{ type: 'text', text: xml }],
                    };
                })
                .filter((m): m is OpenRouterMessage => m !== null);

            // Clear captured content after use to avoid stale data
            lastEditorContent = null;

            const merged: OpenRouterMessage[] = [
                ...contextMessages,
                ...originalMessages,
            ];

            return { messages: merged };
        }
    );

    // 4) Wire DB hooks for incremental index updates (registered once at plugin init)
    // These are intentionally fire-and-forget async operations
    /* eslint-disable @typescript-eslint/no-floating-promises */
    // Documents
    hooks.on(
        'db.documents.create:action:after',
        (payload: DbCreatePayload<DocumentEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                const id = safeId(payload);
                if (module && id && payload.entity) {
                    module.upsertDocument(payload.entity);
                }
            })();
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.documents.update:action:after',
        (payload: DbUpdatePayload<DocumentEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module && payload.updated)
                    module.upsertDocument(payload.updated);
            })();
        },
        { kind: 'action' }
    );
    hooks.on(
        'db.documents.delete:action:soft:after',
        (payload: DbDeletePayload<DocumentEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module) module.removeDocument(payload);
            })();
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.documents.delete:action:hard:after',
        (payload: DbDeletePayload<DocumentEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module) module.removeDocument(payload);
            })();
        },
        { kind: 'action' }
    );

    // Threads
    hooks.on(
        'db.threads.create:action:after',
        (payload: DbCreatePayload<ThreadEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module && payload.entity) {
                    // Normalize title: convert null to undefined to match ThreadRow type
                    const threadRow = { ...payload.entity, title: payload.entity.title ?? undefined };
                    module.upsertThread(threadRow);
                }
            })();
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.upsert:action:after',
        (payload: DbCreatePayload<ThreadEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module && payload.entity) {
                    // Normalize title: convert null to undefined to match ThreadRow type
                    const threadRow = { ...payload.entity, title: payload.entity.title ?? undefined };
                    module.upsertThread(threadRow);
                }
            })();
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.delete:action:soft:after',
        (payload: DbDeletePayload<ThreadEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module) module.removeThread(payload);
            })();
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.delete:action:hard:after',
        (payload: DbDeletePayload<ThreadEntity>) => {
            void (async () => {
                const module = mentionsModule || (await loadMentionsModule());
                if (module) module.removeThread(payload);
            })();
        },
        { kind: 'action' }
    );
    /* eslint-enable @typescript-eslint/no-floating-promises */

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            if (mentionsModule) {
                mentionsModule.resetIndex();
            }
            if (typeof window !== 'undefined') {
                delete (window as { __MENTIONS_EXTENSION__?: unknown })
                    .__MENTIONS_EXTENSION__;
            }
        });
    }
});

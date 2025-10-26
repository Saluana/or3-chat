/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 */

import { defineNuxtPlugin } from '#app';

export default defineNuxtPlugin(async () => {
    const hooks = useHooks();
    let indexInitialized = false;
    let mentionsModule: any = null;
    let lastEditorContent: any = null; // captured TipTap JSON before send

    // 1) Capture editor JSON before send (avoids string-only later)
    hooks.on(
        'ui.chat.editor:action:before_send',
        (editorJson: any) => {
            try {
                lastEditorContent = editorJson || null;
            } catch {
                lastEditorContent = null;
            }
        },
        { kind: 'action' }
    );

    // 2) Lazy load mentions module when editor requests it
    hooks.on(
        'editor:request-extensions',
        async () => {
            try {
                const [
                    MentionModule,
                    mentionsIndexModule,
                    { createMentionSuggestion },
                ] = await Promise.all([
                    import('@tiptap/extension-mention'),
                    import('./ChatMentions/index'),
                    import('./ChatMentions/suggestions'),
                ]);

                const Mention = MentionModule.default;
                const {
                    initMentionsIndex,
                    searchMentions,
                    collectMentions,
                    resolveMention,
                    upsertDocument,
                    updateDocument,
                    upsertThread,
                    resetIndex,
                } = mentionsIndexModule.default;

                mentionsModule = {
                    Mention,
                    initMentionsIndex,
                    searchMentions,
                    collectMentions,
                    resolveMention,
                    upsertDocument,
                    updateDocument,
                    upsertThread,
                    resetIndex,
                    createMentionSuggestion,
                };

                // Extend Mention to persist source/id/label
                const MentionWithAttrs = Mention.extend({
                    addAttributes() {
                        return {
                            id: { default: null },
                            label: { default: null },
                            source: { default: null },
                        } as any;
                    },
                });

                const MentionExtension = MentionWithAttrs.configure({
                    HTMLAttributes: { class: 'mention' },
                    renderText({ node }) {
                        return `@${node.attrs.label || node.attrs.id}`;
                    },
                    suggestion: createMentionSuggestion(searchMentions),
                });

                // Initialize index once
                if (!indexInitialized) {
                    await initMentionsIndex();
                    indexInitialized = true;
                }

                // Provide the Mention extension via extensions filter
                hooks.on(
                    'ui.chat.editor:filter:extensions',
                    (existing: any[]) => {
                        const list = Array.isArray(existing) ? existing : [];
                        return [...list, MentionExtension];
                    }
                );

                // 3) Inject context via filter before send
                hooks.on(
                    'ai.chat.messages:filter:before_send',
                    async (payload: any) => {
                        if (!mentionsModule) return payload;

                        const isArray = Array.isArray(payload);
                        const originalMessages: any[] = isArray
                            ? (payload as any[])
                            : Array.isArray(payload?.messages)
                            ? (payload.messages as any[])
                            : [];

                        if (!originalMessages.length) {
                            return { messages: originalMessages };
                        }

                        const lastUser = [...originalMessages]
                            .reverse()
                            .find((m: any) => m.role === 'user');

                        const editorContent =
                            lastUser?.editorContent ?? lastEditorContent;
                        if (!editorContent) {
                            return { messages: originalMessages };
                        }

                        const mentions =
                            mentionsModule.collectMentions(editorContent);
                        if (mentions.length === 0) {
                            return { messages: originalMessages };
                        }

                        const resolved = await Promise.all(
                            mentions.map(mentionsModule.resolveMention)
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

                        const contextMessages = mentions
                            .map((m: any, idx: number) => {
                                const content = resolved[idx];
                                if (!content) return null;
                                const xml = `<context type="mention" source="${
                                    m.source
                                }" id="${m.id}" label="${escapeXml(
                                    m.label || ''
                                )}">\n${escapeXml(content)}\n</context>`;
                                return {
                                    role: 'system',
                                    content: xml,
                                    id: `mention-context-${idx}`,
                                };
                            })
                            .filter(Boolean) as any[];

                        // Clear captured content after use to avoid stale data
                        lastEditorContent = null;

                        const merged = [
                            ...contextMessages,
                            ...originalMessages,
                        ];

                        return { messages: merged };
                    }
                );

                // Wire DB hooks for incremental index updates
                hooks.on(
                    'db.documents.create:action:after',
                    mentionsModule.upsertDocument,
                    { kind: 'action' }
                );

                hooks.on(
                    'db.documents.upsert:action:after',
                    mentionsModule.updateDocument,
                    { kind: 'action' }
                );

                hooks.on(
                    'db.threads.create:action:after',
                    mentionsModule.upsertThread,
                    { kind: 'action' }
                );

                hooks.on(
                    'db.threads.upsert:action:after',
                    mentionsModule.upsertThread,
                    { kind: 'action' }
                );
            } catch (error) {
                console.error('[mentions] Failed to load module:', error);
            }
        },
        { kind: 'action' }
    );

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            if (mentionsModule) {
                mentionsModule.resetIndex();
            }
            if (typeof window !== 'undefined') {
                delete (window as any).__MENTIONS_EXTENSION__;
            }
        });
    }
});

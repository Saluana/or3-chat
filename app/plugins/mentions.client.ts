/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 */

import { defineNuxtPlugin } from '#app';

export default defineNuxtPlugin(async () => {
    console.log('[mentions] Plugin registering hooks...');

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
                const summary = lastEditorContent
                    ? {
                          type: typeof lastEditorContent,
                          rootType: (lastEditorContent as any)?.type,
                          hasContent: Array.isArray(
                              (lastEditorContent as any)?.content
                          ),
                          contentLen: Array.isArray(
                              (lastEditorContent as any)?.content
                          )
                              ? (lastEditorContent as any).content.length
                              : 0,
                      }
                    : { type: 'null' };
                console.log(
                    '[mentions] Captured editor JSON before_send',
                    summary
                );
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
            console.log('[mentions] Lazy loading mentions module...');

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

                console.log('[mentions] Checking exports:', {
                    hasMention: !!Mention,
                    hasInit: typeof initMentionsIndex === 'function',
                    hasSearch: typeof searchMentions === 'function',
                    hasSuggestion:
                        typeof createMentionSuggestion === 'function',
                });

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

                console.log('[mentions] Module loaded, creating extension...');

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

                // Register extension globally for editor pickup
                if (typeof window !== 'undefined') {
                    (window as any).__MENTIONS_EXTENSION__ = MentionExtension;
                    console.log(
                        '[mentions] Extension registered on window.__MENTIONS_EXTENSION__'
                    );
                }

                // Initialize index once
                if (!indexInitialized) {
                    console.log('[mentions] Initializing search index...');
                    await initMentionsIndex();
                    indexInitialized = true;
                }

                // 3) Inject context via filter before send
                hooks.on(
                    'ai.chat.messages:filter:before_send',
                    async (payload: any) => {
                        console.log(
                            '[mentions] ai.chat.messages:filter:before_send triggered with payload type:',
                            Array.isArray(payload) ? 'array' : typeof payload,
                            Array.isArray(payload?.messages)
                                ? 'object-with-messages'
                                : 'object-no-messages'
                        );
                        if (!mentionsModule) return payload;

                        const isArray = Array.isArray(payload);
                        const originalMessages: any[] = isArray
                            ? (payload as any[])
                            : Array.isArray(payload?.messages)
                            ? (payload.messages as any[])
                            : [];

                        console.log(
                            '[mentions] Extracted messages length:',
                            originalMessages.length
                        );

                        if (!originalMessages.length) {
                            return { messages: originalMessages };
                        }

                        const lastUser = [...originalMessages]
                            .reverse()
                            .find((m: any) => m.role === 'user');
                        console.log('[mentions] Found last user message:', {
                            hasLastUser: !!lastUser,
                            hasEditorContent: !!lastUser?.editorContent,
                            contentType: typeof lastUser?.content,
                        });

                        const editorContent =
                            lastUser?.editorContent ?? lastEditorContent;
                        if (!editorContent) {
                            console.warn(
                                '[mentions] No editorContent available on user message or captured state.'
                            );
                            return { messages: originalMessages };
                        }

                        console.log('[mentions] Using editorContent summary:', {
                            type: typeof editorContent,
                            rootType: (editorContent as any)?.type,
                            hasContent: Array.isArray(
                                (editorContent as any)?.content
                            ),
                            contentLen: Array.isArray(
                                (editorContent as any)?.content
                            )
                                ? (editorContent as any).content.length
                                : 0,
                        });

                        const mentions =
                            mentionsModule.collectMentions(editorContent);
                        console.log('[mentions] Collected mentions:', mentions);
                        if (mentions.length === 0) {
                            console.log(
                                '[mentions] No mentions found in editorContent.'
                            );
                            return { messages: originalMessages };
                        }

                        const resolved = await Promise.all(
                            mentions.map(mentionsModule.resolveMention)
                        );
                        const contextBlocks = resolved.filter(
                            (c): c is string => c !== null
                        );
                        console.log(
                            '[mentions] Resolved mentions to context blocks count:',
                            contextBlocks.length
                        );

                        if (contextBlocks.length === 0) {
                            console.warn(
                                '[mentions] Mention resolution returned no context strings.'
                            );
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
                        console.log(
                            '[mentions] Injecting context messages, final messages length:',
                            merged.length
                        );

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

                console.log('[mentions] Fully initialized');
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

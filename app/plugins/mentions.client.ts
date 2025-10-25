/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 *
 * Enables @-mentions of documents and chats in the editor.
 * - Lazy loads on editor:request-extensions hook
 * - Orama index for fast search
 * - TipTap Mention extension with Vue component dropdown
 * - Context injection via ai.chat.messages:filter:input hook
 * - Incremental index updates via DB hooks
 */

import { defineNuxtPlugin } from '#app';

export default defineNuxtPlugin(async (nuxtApp) => {
    console.log('[mentions] Plugin registering hooks...');

    const hooks = useHooks();
    let indexInitialized = false;
    let mentionsModule: any = null;

    // Lazy load mentions module when editor requests it
    hooks.on(
        'editor:request-extensions',
        async () => {
            console.log('[mentions] Lazy loading mentions module...');

            try {
                // Import modules - index.ts now has default export
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

                // Create Mention extension with Vue component renderer
                const MentionExtension = Mention.configure({
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

                // Register context injection hook (only once)
                hooks.on(
                    'ai.chat.messages:filter:input',
                    async (messages: any[]) => {
                        if (!mentionsModule) return messages;

                        const lastUser = [...messages]
                            .reverse()
                            .find((m: any) => m.role === 'user');
                        if (!lastUser?.editorContent) return messages;

                        const mentions = mentionsModule.collectMentions(
                            lastUser.editorContent
                        );
                        if (mentions.length === 0) return messages;

                        const resolved = await Promise.all(
                            mentions.map(mentionsModule.resolveMention)
                        );
                        const contextBlocks = resolved.filter(
                            (c): c is string => c !== null
                        );

                        if (contextBlocks.length === 0) return messages;

                        const contextMessages = contextBlocks.map(
                            (content, idx) => ({
                                role: 'system',
                                content,
                                id: `mention-context-${idx}`,
                            })
                        );

                        return [...contextMessages, ...messages];
                    }
                );

                // Wire DB hooks for incremental index updates
                hooks.on(
                    'db.documents.create:action:after',
                    mentionsModule.upsertDocument,
                    {
                        kind: 'action',
                    }
                );

                hooks.on(
                    'db.documents.upsert:action:after',
                    mentionsModule.updateDocument,
                    {
                        kind: 'action',
                    }
                );

                hooks.on(
                    'db.threads.create:action:after',
                    mentionsModule.upsertThread,
                    {
                        kind: 'action',
                    }
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

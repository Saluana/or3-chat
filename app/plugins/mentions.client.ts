/**
 * Mentions Plugin - Nuxt Registration (Lazy Loaded)
 */

import { defineNuxtPlugin } from '#app';

export default defineNuxtPlugin(async () => {
    const appConfig = useAppConfig();
    const mentionsConfig = (appConfig as any)?.mentions || {};

    // Check feature flag (requirement 8.2)
    if (mentionsConfig.enabled === false) {
        console.log('[mentions] Plugin disabled via feature flag');
        return;
    }

    const hooks = useHooks();
    let indexInitialized = false;
    let mentionsModule: any = null;
    let lastEditorContent: any = null; // captured TipTap JSON before send
    let extensionsRegistered = false; // Prevent duplicate registrations

    // Lazy load the mentions module
    async function loadMentionsModule() {
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
                updateDocument,
                upsertThread,
                updateThread,
                removeDocument,
                removeThread,
                resetIndex,
                setMentionsConfig,
            } = mentionsIndexModule.default;

            // Apply runtime configuration (requirement 8.1)
            setMentionsConfig({
                maxPerGroup: mentionsConfig.maxPerGroup || 5,
                maxContextBytes: mentionsConfig.maxContextBytes || 50_000,
            });

            mentionsModule = {
                Mention: MentionModule.default,
                initMentionsIndex,
                searchMentions,
                collectMentions,
                resolveMention,
                upsertDocument,
                updateDocument,
                upsertThread,
                updateThread,
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
        (editorJson: any) => {
            try {
                lastEditorContent = editorJson || null;
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
                    } as any;
                },
            });

            const MentionExtension = MentionWithAttrs.configure({
                HTMLAttributes: { class: 'mention' },
                renderText({ node }: { node: any }) {
                    return `@${node.attrs.label || node.attrs.id}`;
                },
                suggestion: module.createMentionSuggestion(
                    module.searchMentions,
                    mentionsConfig.debounceMs || 120
                ),
            });

            // Provide the Mention extension via extensions filter
            hooks.on('ui.chat.editor:filter:extensions', (existing: any[]) => {
                const list = Array.isArray(existing) ? existing : [];
                return [...list, MentionExtension];
            });
        },
        { kind: 'action' }
    );

    // 3) Inject context via filter before send (registered once at plugin init)
    hooks.on('ai.chat.messages:filter:before_send', async (payload: any) => {
        const module = mentionsModule || (await loadMentionsModule());
        if (!module) return payload;

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

        const editorContent = lastUser?.editorContent ?? lastEditorContent;
        if (!editorContent) {
            return { messages: originalMessages };
        }

        const mentions = module.collectMentions(editorContent);
        if (mentions.length === 0) {
            return { messages: originalMessages };
        }

        const resolved = await Promise.all(mentions.map(module.resolveMention));
        const contextBlocks = resolved.filter((c): c is string => c !== null);

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
                const xml = `<context type="mention" source="${m.source}" id="${
                    m.id
                }" label="${escapeXml(m.label || '')}">\n${escapeXml(
                    content
                )}\n</context>`;
                return {
                    role: 'system',
                    content: xml,
                    id: `mention-context-${idx}`,
                };
            })
            .filter(Boolean) as any[];

        // Clear captured content after use to avoid stale data
        lastEditorContent = null;

        const merged = [...contextMessages, ...originalMessages];

        return { messages: merged };
    });

    // 4) Wire DB hooks for incremental index updates (registered once at plugin init)
    // Documents
    hooks.on(
        'db.documents.create:action:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.upsertDocument(payload.entity);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.documents.update:action:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.updateDocument(payload.updated);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.documents.delete:action:soft:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.removeDocument(payload);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.documents.delete:action:hard:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.removeDocument(payload);
        },
        { kind: 'action' }
    );

    // Threads
    hooks.on(
        'db.threads.create:action:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.upsertThread(payload.entity);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.upsert:action:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.updateThread(payload.entity);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.delete:action:soft:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.removeThread(payload);
        },
        { kind: 'action' }
    );

    hooks.on(
        'db.threads.delete:action:hard:after',
        async (payload: any) => {
            const module = mentionsModule || (await loadMentionsModule());
            if (module) module.removeThread(payload);
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

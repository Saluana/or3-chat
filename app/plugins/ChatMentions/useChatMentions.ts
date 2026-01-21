import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';

// ============================================================================
// Types
// ============================================================================
export interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
    score?: number;
}

interface IndexRecord {
    id: string;
    title: string;
    source: string;
    snippet: string;
}

// ============================================================================
// Constants (initialized from runtime config)
// ============================================================================
let MAX_PER_GROUP = 5;
let MAX_CONTEXT_BYTES = 50_000;
let ENABLED_SOURCES: { documents: boolean; conversations: boolean } = {
    documents: true,
    conversations: true,
};

export function setMentionsConfig(config: {
    maxPerGroup?: number;
    maxContextBytes?: number;
    enabledSources?: { documents?: boolean; conversations?: boolean };
}) {
    if (config.maxPerGroup !== undefined) MAX_PER_GROUP = config.maxPerGroup;
    if (config.maxContextBytes !== undefined)
        MAX_CONTEXT_BYTES = config.maxContextBytes;
    if (config.enabledSources) {
        if (config.enabledSources.documents !== undefined)
            ENABLED_SOURCES.documents = config.enabledSources.documents;
        if (config.enabledSources.conversations !== undefined)
            ENABLED_SOURCES.conversations = config.enabledSources.conversations;
    }
}

// ============================================================================
// Orama Index
// ============================================================================
let mentionsDb: any = null;
let indexReady = false;

export async function initMentionsIndex() {
    try {
        const { db } = await import('~/db');

        // IMPORTANT: Do not include 'id' in the schema to avoid clashes with Orama's identity field.
        // We'll still pass our own IDs to Orama (so hit.id === our id), but we won't index/store it as a document field.
        mentionsDb = await createDb({
            title: 'string',
            source: 'string',
            snippet: 'string',
        });

        const docs = await db.posts
            .where('postType')
            .equals('doc')
            .and((p: any) => !p.deleted)
            .toArray();
        // Some existing rows use numeric flags; fall back to filtering to avoid Dexie key errors
        const threads = await db.threads
            .filter((t: any) => !t.deleted)
            .toArray();

        const records: IndexRecord[] = [
            ...docs.map((d: any) => ({
                id: d.id,
                title: d.title || 'Untitled',
                source: 'document' as const,
                snippet: '',
            })),
            ...threads.map((t: any) => ({
                id: t.id,
                title: t.title || 'Untitled Chat',
                source: 'chat' as const,
                snippet: '',
            })),
        ];

        await buildIndex(mentionsDb, records);
        indexReady = true;
    } catch (error) {
        console.error('[mentions] Index init failed:', error);
    }
}

export async function searchMentions(query: string): Promise<MentionItem[]> {
    if (!indexReady || !mentionsDb) {
        return [];
    }

    try {
        // Fetch a larger pool, then fairly cap per-group to ensure threads appear
        const results = await searchWithIndex(mentionsDb, query, 50, {
            returning: ['id', 'title', 'source', 'snippet'],
        });

        // Some Orama versions don't project all fields on hits' document.
        // Use hit.id for identity and enrich missing fields via getByID when needed.
        const { getByID } = await import('@orama/orama');

        const enriched = await Promise.all(
            results.hits.map(async (hit: any) => {
                let id: string | null = hit?.id ?? hit?.document?.id ?? null;
                let source: 'document' | 'chat' | null =
                    hit?.document?.source ?? null;
                let title: string = hit?.document?.title ?? '';
                let subtitle: string | undefined =
                    hit?.document?.snippet || undefined;

                if (!id || !source || !title) {
                    try {
                        const stored = await getByID(mentionsDb, hit?.id ?? id);
                        if (stored) {
                            id = id ?? stored.id ?? hit?.id ?? null;
                            source = (source ?? stored.source ?? null);
                            title = title || stored.title || '';
                            subtitle =
                                subtitle ?? (stored.snippet || undefined);
                        }
                    } catch {
                        // Best effort enrichment; ignore failures
                    }
                }

                // Fallback: if still missing id or source, try resolving via our Dexie DB by title
                if ((!id || !source) && title) {
                    try {
                        const { db } = await import('~/db');
                        const row = await db.posts
                            .where('postType')
                            .equals('doc')
                            .and(
                                (r: any) =>
                                    !r.deleted && (r.title || '') === title
                            )
                            .first();
                        if (row) {
                            id = id ?? row.id;
                            source = (source ?? 'document') as any;
                        }
                    } catch {}
                }

                return {
                    id,
                    source,
                    label: title,
                    subtitle,
                    score: hit.score,
                } as Partial<MentionItem> & { score?: number };
            })
        );

        // Normalize and group
        const items: MentionItem[] = enriched.filter(
            (i): i is MentionItem =>
                !!i.id && (i.source === 'document' || i.source === 'chat')
        );

        const docs = ENABLED_SOURCES.documents
            ? items.filter((i) => i.source === 'document').slice(0, MAX_PER_GROUP)
            : [];
        const chats = ENABLED_SOURCES.conversations
            ? items.filter((i) => i.source === 'chat').slice(0, MAX_PER_GROUP)
            : [];

        return [...docs, ...chats];
    } catch (error) {
        console.error('[mentions] Search failed:', error);
        return [];
    }
}

// ============================================================================
// Context Resolution
// ============================================================================
export function collectMentions(doc: any): MentionItem[] {
    const mentions: MentionItem[] = [];
    const seen = new Set<string>();

    function walk(node: any) {
        if (node.type === 'mention' && node.attrs) {
            const key = `${node.attrs.source}:${node.attrs.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                mentions.push({
                    id: node.attrs.id,
                    source: node.attrs.source,
                    label: node.attrs.label,
                });
            }
        }
        if (node.content) {
            node.content.forEach(walk);
        }
    }

    walk(doc);
    return mentions;
}

function truncateBytes(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return text;

    const truncated = bytes.slice(0, maxBytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(truncated) + '\n...[truncated]';
}

export async function resolveMention(
    mention: MentionItem
): Promise<string | null> {
    try {
        const { db } = await import('~/db');

        if (mention.source === 'document') {
            const doc = await db.posts.get(mention.id);
            if (!doc || doc.postType !== 'doc' || doc.deleted) return null;

            let content;
            try {
                content =
                    typeof doc.content === 'string'
                        ? JSON.parse(doc.content)
                        : doc.content;
            } catch {
                return null;
            }

            const getText = (node: any): string => {
                if (node.type === 'text') return node.text || '';
                if (node.content) return node.content.map(getText).join('');
                return '';
            };

            const text = getText(content);
            return `(Referenced Document: ${mention.label})\n${truncateBytes(
                text,
                MAX_CONTEXT_BYTES
            )}`;
        } else {
            const messages = await db.messages
                .where('thread_id')
                .equals(mention.id)
                .sortBy('index');

            if (!messages.length) return null;

            const transcript = messages
                .map((m: any) => {
                    const content =
                        typeof m.data?.content === 'string'
                            ? m.data.content
                            : JSON.stringify(m.data?.content || '');
                    return `${m.role}: ${content}`;
                })
                .join('\n');

            return `(Referenced Chat: ${mention.label})\n${truncateBytes(
                transcript,
                MAX_CONTEXT_BYTES
            )}`;
        }
    } catch (error) {
        console.warn(
            `[mentions] Failed to resolve ${mention.source} ${mention.id}:`,
            error
        );
        return null;
    }
}

// ============================================================================
// Index Updates
// ============================================================================
export async function upsertDocument(doc: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { insert, update } = await import('@orama/orama');
        const record = {
            id: doc.id,
            title: doc.title || 'Untitled',
            source: 'document',
            snippet: '',
        };

        try {
            // Try insert first - note: Orama uses the id field from the record
            await insert(mentionsDb, record);
        } catch (insertError: any) {
            // If insert fails (duplicate ID), try update
            if (
                insertError?.message?.includes('already exists') ||
                insertError?.message?.includes('duplicate')
            ) {
                try {
                    await update(mentionsDb, doc.id, record);
                } catch (updateError) {
                    console.warn(
                        '[mentions] Failed to update document:',
                        updateError
                    );
                }
            } else {
                throw insertError;
            }
        }
    } catch (e) {
        console.warn('[mentions] Failed to index document:', e);
    }
}

export async function updateDocument(doc: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { update } = await import('@orama/orama');
        await update(mentionsDb, doc.id, {
            title: doc.title || 'Untitled',
        });
    } catch (e) {
        // Ignore if document doesn't exist yet
    }
}

export async function upsertThread(thread: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { insert, update } = await import('@orama/orama');
        const record = {
            id: thread.id,
            title: thread.title || 'Untitled Chat',
            source: 'chat',
            snippet: '',
        };
        try {
            // Try insert first
            await insert(mentionsDb, record);
        } catch (insertError: any) {
            // If insert fails (duplicate ID), try update
            if (
                insertError?.message?.includes('already exists') ||
                insertError?.message?.includes('duplicate')
            ) {
                try {
                    await update(mentionsDb, thread.id, record);
                } catch (updateError) {
                    console.warn(
                        '[mentions] Failed to update thread:',
                        updateError
                    );
                }
            } else {
                throw insertError;
            }
        }
    } catch (e) {
        console.warn('[mentions] Failed to index thread:', e);
    }
}

export async function updateThread(thread: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { update } = await import('@orama/orama');
        await update(mentionsDb, thread.id, {
            title: thread.title || 'Untitled Chat',
        });
    } catch (e) {
        // Ignore if thread doesn't exist yet
    }
}

export async function removeDocument(payload: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { remove } = await import('@orama/orama');
        const docId = payload.id || payload.entity?.id;
        if (docId) {
            await remove(mentionsDb, docId);
        }
    } catch (e) {
        console.warn('[mentions] Failed to remove document from index:', e);
    }
}

export async function removeThread(payload: any) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { remove } = await import('@orama/orama');
        const threadId = payload.id || payload.entity?.id;
        if (threadId) {
            await remove(mentionsDb, threadId);
        }
    } catch (e) {
        console.warn('[mentions] Failed to remove thread from index:', e);
    }
}

export function resetIndex() {
    mentionsDb = null;
    indexReady = false;
}

// Default export for easier dynamic imports
export default {
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
};

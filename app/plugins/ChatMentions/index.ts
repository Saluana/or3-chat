import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';

// ============================================================================
// Types
// ============================================================================
export interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
}

interface IndexRecord {
    id: string;
    title: string;
    source: string;
    snippet: string;
}

// ============================================================================
// Constants
// ============================================================================
const MAX_PER_GROUP = 5;
const MAX_CONTEXT_BYTES = 50_000;

// ============================================================================
// Orama Index
// ============================================================================
let mentionsDb: any = null;
let indexReady = false;

export async function initMentionsIndex() {
    console.log('[mentions] Initializing Orama index...');
    try {
        const { db } = await import('~/db');

        mentionsDb = await createDb({
            id: 'string',
            title: 'string',
            source: 'string',
            snippet: 'string',
        });
        console.log('[mentions] Orama DB created');

        const docs = await db.posts
            .where('postType')
            .equals('doc')
            .and((p: any) => !p.deleted)
            .toArray();
        const threads = await db.threads.where('deleted').equals(0).toArray();

        console.log(
            `[mentions] Found ${docs.length} documents and ${threads.length} threads`
        );

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
        console.log('[mentions] Index ready with', records.length, 'items');
    } catch (error) {
        console.error('[mentions] Index init failed:', error);
    }
}

export async function searchMentions(query: string): Promise<MentionItem[]> {
    if (!indexReady || !mentionsDb) return [];

    try {
        const results = await searchWithIndex(mentionsDb, query, 10);
        return results.hits
            .map((hit: any) => ({
                id: hit.document.id,
                source: hit.document.source,
                label: hit.document.title,
                subtitle: hit.document.snippet || undefined,
            }))
            .slice(0, MAX_PER_GROUP * 2);
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
        const { insert } = await import('@orama/orama');
        await insert(mentionsDb, {
            id: doc.id,
            title: doc.title || 'Untitled',
            source: 'document',
            snippet: '',
        });
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
        const { insert } = await import('@orama/orama');
        await insert(mentionsDb, {
            id: thread.id,
            title: thread.title || 'Untitled Chat',
            source: 'chat',
            snippet: '',
        });
    } catch (e) {
        console.warn('[mentions] Failed to index thread:', e);
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
    resetIndex,
};

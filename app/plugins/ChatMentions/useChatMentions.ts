/**
 * @module ChatMentions/useChatMentions
 *
 * **Purpose**
 * Provides @mention indexing and search for documents and chat threads. Allows users to
 * reference context from prior documents or conversations within the editor via an
 * autocomplete-driven mention flow. The module maintains an in-memory Orama index of
 * doc/thread titles and supports incremental updates as entities are created/updated/deleted.
 *
 * **Responsibilities**
 * - Initialize and manage the Orama search index (mentions database)
 * - Index documents (posts with postType='doc') and chat threads (threads table)
 * - Provide typeahead search over indexed mentions (title-based)
 * - Collect mention nodes from TipTap JSON documents
 * - Resolve mention IDs to full context (document content or chat transcript)
 * - Support incremental index updates (upsert/remove) via DB hooks
 * - Apply fair per-group limiting (MAX_PER_GROUP) to ensure balanced results
 *
 * **Non-responsibilities**
 * - Does NOT handle UI rendering (see MentionsList.vue, MentionsPopover.vue)
 * - Does NOT manage TipTap mention extension config (see suggestions.ts and mentions.client.ts plugin)
 * - Does NOT persist the index (ephemeral, rebuilt on each session)
 * - Does NOT sync mentions across devices (local session only)
 *
 * **Orama Schema Constraints**
 * - Schema fields: `title`, `source`, `snippet` (all strings)
 * - **CRITICAL**: `id` is NOT included in the Orama schema to avoid field name clashes with Orama's internal identity system
 * - Document identity is managed by passing the `id` property in records to Orama's insert/update/remove APIs
 * - Hit results use `hit.id` for identity and `hit.document` for indexed fields
 *
 * **Lifecycle**
 * - `initMentionsIndex()` must be called once (async, typically via mentions.client.ts plugin)
 * - After init, `indexReady` flag is set and search/updates become operational
 * - `resetIndex()` clears state (used for HMR or teardown)
 * - Incremental updates via `upsertDocument/Thread`, `removeDocument/Thread` are best-effort
 *
 * **Performance**
 * - Index is fully in-memory and rebuilt on session start (no persistence)
 * - Search fetches a larger pool (50) and applies per-group caps client-side for fairness
 * - Context resolution truncates content to MAX_CONTEXT_BYTES (default 50,000 bytes) to control message size
 * - Enrichment fallback via Dexie queries if Orama hits lack required fields (rare)
 *
 * **SSR Notes**
 * - This module dynamically imports `~/db` to avoid SSR bundle inclusion (Dexie is client-only)
 * - All exported functions are async or return immediately if index is not ready
 * - Safe to import type definitions in server code, but do NOT call functions server-side
 *
 * **Error Handling**
 * - Errors are reported via the unified `reportError` API with tags: `domain:'chat'`, `feature:'mentions'`, `stage:...`
 * - Search and resolve functions return `[]` or `null` on failure (best-effort, no exceptions thrown)
 * - Index update failures are logged but do not block or throw (fire-and-forget incremental updates)
 */

import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';
import { reportError, err } from '~/utils/errors';

// ============================================================================
// Types
// ============================================================================

/**
 * A mention item returned by search or extracted from editor content.
 */
export interface MentionItem {
    id: string;
    source: 'document' | 'chat';
    label: string;
    subtitle?: string;
    score?: number;
}

/**
 * Minimal document (post) row shape from Dexie.
 */
interface DocPostRow {
    id: string;
    postType: string;
    title?: string;
    content?: string | Record<string, unknown>;
    deleted?: boolean;
}

/**
 * Minimal thread row shape from Dexie.
 */
interface ThreadRow {
    id: string;
    title?: string;
    deleted?: boolean;
}

/**
 * Minimal message row shape from Dexie.
 */
interface MessageRow {
    thread_id: string;
    index: number;
    role: string;
    data?: {
        content?: string | unknown;
    };
}

/**
 * Internal record shape for Orama index.
 * Note: `id` is passed to Orama but NOT part of the schema definition.
 */
interface IndexRecord {
    id: string;
    title: string;
    source: string;
    snippet: string;
}

/**
 * Shape of enriched Orama hit (partial until validation).
 */
interface OramaHit {
    id?: string;
    document?: {
        id?: string;
        title?: string;
        source?: string;
        snippet?: string;
    };
    score?: number;
}

/**
 * TipTap JSON mention node shape (subset).
 */
interface MentionNode {
    type: string;
    attrs?: {
        id?: string;
        source?: string;
        label?: string;
    };
    content?: MentionNode[];
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

/**
 * Sets runtime configuration for the mentions system.
 *
 * @param config - Configuration options
 * @param config.maxPerGroup - Maximum results per source group (documents/conversations). Default: 5
 * @param config.maxContextBytes - Maximum bytes of context to return when resolving mentions. Default: 50,000
 * @param config.enabledSources - Which mention sources are enabled (documents, conversations)
 *
 * @remarks
 * - Called once during plugin initialization (see mentions.client.ts)
 * - Changes take effect immediately for subsequent searches
 */
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
let mentionsDb: Awaited<ReturnType<typeof createDb>> | null = null;
let indexReady = false;

/**
 * Initializes the mentions Orama index.
 *
 * **Behavior**
 * - Creates an in-memory Orama database with schema: title, source, snippet
 * - Loads all non-deleted documents (postType='doc') from Dexie
 * - Loads all non-deleted threads from Dexie
 * - Builds the index synchronously
 * - Sets `indexReady` flag on success
 *
 * **Error Handling**
 * - On failure, logs error via `reportError` with stage='init'
 * - Index remains unusable (searches return empty results)
 * - Does not throw; safe to call multiple times (idempotent if already ready)
 *
 * @remarks
 * - Must be called before search/resolve operations
 * - SSR-safe (dynamically imports ~/db)
 */
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

        const docs = (await db.posts
            .where('postType')
            .equals('doc')
            .and((p: DocPostRow) => !p.deleted)
            .toArray()) as DocPostRow[];

        // Some existing rows use numeric flags; fall back to filtering to avoid Dexie key errors
        const threads = (await db.threads
            .filter((t: ThreadRow) => !t.deleted)
            .toArray()) as ThreadRow[];

        const records: IndexRecord[] = [
            ...docs.map((d) => ({
                id: d.id,
                title: d.title || 'Untitled',
                source: 'document' as const,
                snippet: '',
            })),
            ...threads.map((t) => ({
                id: t.id,
                title: t.title || 'Untitled Chat',
                source: 'chat' as const,
                snippet: '',
            })),
        ];

        await buildIndex(mentionsDb, records);
        indexReady = true;
    } catch (error) {
        reportError(error, {
            code: 'ERR_INTERNAL',
            message: 'Mentions index init failed',
            tags: { domain: 'chat', feature: 'mentions', stage: 'init' },
            toast: false,
        });
    }
}

/**
 * Searches the mentions index for matching items.
 *
 * **Behavior**
 * - Returns empty array if index not ready
 * - Fetches top 50 results from Orama (larger pool for fair grouping)
 * - Enriches hits via Orama's getByID if fields are missing (fallback)
 * - Groups by source (document/chat) and applies MAX_PER_GROUP limit per group
 * - Respects ENABLED_SOURCES configuration (filters disabled source types)
 *
 * **Error Handling**
 * - On failure, logs error via `reportError` with stage='search' and returns `[]`
 * - Does not throw; safe for UI autocomplete flows
 *
 * @param query - User's search term (title-based substring match)
 * @returns Array of MentionItem (empty if not ready or on error)
 *
 * @remarks
 * - Enrichment fallback may query Dexie if Orama hits lack required fields
 * - Results are ordered by score (Orama BM25) within each group
 */
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
            results.hits.map(async (hit: OramaHit) => {
                let id: string | null = hit?.id ?? hit?.document?.id ?? null;
                let source: 'document' | 'chat' | null =
                    (hit?.document?.source as 'document' | 'chat') ?? null;
                let title: string = hit?.document?.title ?? '';
                let subtitle: string | undefined =
                    hit?.document?.snippet || undefined;

                if (!id || !source || !title) {
                    try {
                        const stored = (await getByID(mentionsDb!, hit?.id ?? id!)) as IndexRecord | null;
                        if (stored) {
                            id = id ?? stored.id ?? hit?.id ?? null;
                            source = (source ?? stored.source ?? null) as 'document' | 'chat' | null;
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
                        const row = (await db.posts
                            .where('postType')
                            .equals('doc')
                            .and(
                                (r: DocPostRow) =>
                                    !r.deleted && (r.title || '') === title
                            )
                            .first()) as DocPostRow | undefined;
                        if (row) {
                            id = id ?? row.id;
                            source = (source ?? 'document') as 'document' | 'chat';
                        }
                    } catch {
                        // ignore fallback failures
                    }
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
        reportError(error, {
            code: 'ERR_INTERNAL',
            message: 'Mentions search failed',
            tags: { domain: 'chat', feature: 'mentions', stage: 'search' },
            toast: false,
        });
        return [];
    }
}

// ============================================================================
// Context Resolution
// ============================================================================

/**
 * Collects all mention nodes from a TipTap JSON document.
 *
 * **Behavior**
 * - Recursively walks the document tree
 * - Extracts nodes with `type: 'mention'` and attrs: { id, source, label }
 * - Deduplicates by `source:id` key
 *
 * **Error Handling**
 * - Safe to call with any object shape; returns empty array if document is malformed
 * - Does not throw
 *
 * @param doc - TipTap JSON document (expected shape: { type, content, attrs })
 * @returns Array of MentionItem (empty if none found)
 */
export function collectMentions(doc: MentionNode): MentionItem[] {
    const mentions: MentionItem[] = [];
    const seen = new Set<string>();

    function walk(node: MentionNode) {
        if (node.type === 'mention' && node.attrs) {
            const key = `${node.attrs.source}:${node.attrs.id}`;
            if (!seen.has(key) && node.attrs.id && node.attrs.source && node.attrs.label) {
                seen.add(key);
                mentions.push({
                    id: node.attrs.id,
                    source: node.attrs.source as 'document' | 'chat',
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

/**
 * Truncates text to a maximum byte length (UTF-8).
 *
 * @param text - Input text
 * @param maxBytes - Maximum byte count
 * @returns Truncated text with "[truncated]" suffix if needed
 */
function truncateBytes(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return text;

    const truncated = bytes.slice(0, maxBytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(truncated) + '\n...[truncated]';
}

/**
 * Resolves a mention to its full context string.
 *
 * **Behavior**
 * - For documents: returns title + full content (truncated to MAX_CONTEXT_BYTES)
 * - For chats: returns title + message transcript (truncated to MAX_CONTEXT_BYTES)
 * - Content is extracted from TipTap JSON or raw message data
 *
 * **Error Handling**
 * - Returns `null` if mention ID not found, entity is deleted, or content is invalid
 * - Logs error via `reportError` with stage='resolve' and returns `null`
 * - Does not throw
 *
 * @param mention - The mention item to resolve
 * @returns Context string or null on failure
 */
export async function resolveMention(
    mention: MentionItem
): Promise<string | null> {
    try {
        const { db } = await import('~/db');

        if (mention.source === 'document') {
            const doc = (await db.posts.get(mention.id)) as DocPostRow | undefined;
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

            const getText = (node: MentionNode): string => {
                if (node.type === 'text') return (node as { text?: string }).text || '';
                if (node.content) return node.content.map(getText).join('');
                return '';
            };

            const text = getText(content as MentionNode);
            return `(Referenced Document: ${mention.label})\n${truncateBytes(
                text,
                MAX_CONTEXT_BYTES
            )}`;
        } else {
            const messages = (await db.messages
                .where('thread_id')
                .equals(mention.id)
                .sortBy('index')) as MessageRow[];

            if (!messages.length) return null;

            const transcript = messages
                .map((m) => {
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
        reportError(error, {
            code: 'ERR_INTERNAL',
            message: `Failed to resolve ${mention.source} ${mention.id}`,
            tags: { domain: 'chat', feature: 'mentions', stage: 'resolve' },
            toast: false,
        });
        return null;
    }
}

// ============================================================================
// Index Updates
// ============================================================================

/**
 * Upserts a document into the mentions index.
 *
 * **Behavior**
 * - Attempts insert first; if ID exists, falls back to update
 * - No-op if index not ready
 * - Fire-and-forget; does not block caller
 *
 * **Error Handling**
 * - Logs via `reportError` with stage='index' on failure
 * - Does not throw
 *
 * @param doc - Document row from Dexie (must have `id` and optional `title`)
 */
export async function upsertDocument(doc: Partial<DocPostRow>) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { insert, update } = await import('@orama/orama');
        const record = {
            id: doc.id!,
            title: doc.title || 'Untitled',
            source: 'document',
            snippet: '',
        };

        try {
            // Try insert first - note: Orama uses the id field from the record
            await insert(mentionsDb, record);
        } catch (insertError: unknown) {
            const errMsg = insertError instanceof Error ? insertError.message : '';
            // If insert fails (duplicate ID), try update
            if (
                errMsg.includes('already exists') ||
                errMsg.includes('duplicate')
            ) {
                try {
                    await update(mentionsDb, doc.id!, record);
                } catch (updateError) {
                    reportError(updateError, {
                        code: 'ERR_INTERNAL',
                        message: 'Failed to update document in mentions index',
                        tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
                        toast: false,
                    });
                }
            } else {
                throw insertError;
            }
        }
    } catch (e) {
        reportError(e, {
            code: 'ERR_INTERNAL',
            message: 'Failed to index document',
            tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
            toast: false,
        });
    }
}

/**
 * Updates a document in the mentions index (title only).
 *
 * **Behavior**
 * - Updates existing entry; no-op if document doesn't exist
 * - No-op if index not ready
 *
 * @param doc - Document row with `id` and `title`
 */
export async function updateDocument(doc: Partial<DocPostRow>) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { update } = await import('@orama/orama');
        await update(mentionsDb, doc.id!, {
            title: doc.title || 'Untitled',
        });
    } catch (e) {
        // Ignore if document doesn't exist yet
    }
}

/**
 * Upserts a thread into the mentions index.
 *
 * **Behavior**
 * - Attempts insert first; if ID exists, falls back to update
 * - No-op if index not ready
 * - Fire-and-forget; does not block caller
 *
 * **Error Handling**
 * - Logs via `reportError` with stage='index' on failure
 * - Does not throw
 *
 * @param thread - Thread row from Dexie (must have `id` and optional `title`)
 */
export async function upsertThread(thread: Partial<ThreadRow>) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { insert, update } = await import('@orama/orama');
        const record = {
            id: thread.id!,
            title: thread.title || 'Untitled Chat',
            source: 'chat',
            snippet: '',
        };
        try {
            // Try insert first
            await insert(mentionsDb, record);
        } catch (insertError: unknown) {
            const errMsg = insertError instanceof Error ? insertError.message : '';
            // If insert fails (duplicate ID), try update
            if (
                errMsg.includes('already exists') ||
                errMsg.includes('duplicate')
            ) {
                try {
                    await update(mentionsDb, thread.id!, record);
                } catch (updateError) {
                    reportError(updateError, {
                        code: 'ERR_INTERNAL',
                        message: 'Failed to update thread in mentions index',
                        tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
                        toast: false,
                    });
                }
            } else {
                throw insertError;
            }
        }
    } catch (e) {
        reportError(e, {
            code: 'ERR_INTERNAL',
            message: 'Failed to index thread',
            tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
            toast: false,
        });
    }
}

/**
 * Updates a thread in the mentions index (title only).
 *
 * **Behavior**
 * - Updates existing entry; no-op if thread doesn't exist
 * - No-op if index not ready
 *
 * @param thread - Thread row with `id` and `title`
 */
export async function updateThread(thread: Partial<ThreadRow>) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { update } = await import('@orama/orama');
        await update(mentionsDb, thread.id!, {
            title: thread.title || 'Untitled Chat',
        });
    } catch (e) {
        // Ignore if thread doesn't exist yet
    }
}

/**
 * Removes a document from the mentions index.
 *
 * **Behavior**
 * - No-op if index not ready or ID not found
 * - Fire-and-forget; does not block caller
 *
 * **Error Handling**
 * - Logs via `reportError` with stage='index' on failure
 * - Does not throw
 *
 * @param payload - Payload with `id` or `entity.id`
 */
export async function removeDocument(payload: { id?: string; entity?: { id?: string } }) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { remove } = await import('@orama/orama');
        const docId = payload.id || payload.entity?.id;
        if (docId) {
            await remove(mentionsDb, docId);
        }
    } catch (e) {
        reportError(e, {
            code: 'ERR_INTERNAL',
            message: 'Failed to remove document from mentions index',
            tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
            toast: false,
        });
    }
}

/**
 * Removes a thread from the mentions index.
 *
 * **Behavior**
 * - No-op if index not ready or ID not found
 * - Fire-and-forget; does not block caller
 *
 * **Error Handling**
 * - Logs via `reportError` with stage='index' on failure
 * - Does not throw
 *
 * @param payload - Payload with `id` or `entity.id`
 */
export async function removeThread(payload: { id?: string; entity?: { id?: string } }) {
    if (!mentionsDb || !indexReady) return;
    try {
        const { remove } = await import('@orama/orama');
        const threadId = payload.id || payload.entity?.id;
        if (threadId) {
            await remove(mentionsDb, threadId);
        }
    } catch (e) {
        reportError(e, {
            code: 'ERR_INTERNAL',
            message: 'Failed to remove thread from mentions index',
            tags: { domain: 'chat', feature: 'mentions', stage: 'index' },
            toast: false,
        });
    }
}

/**
 * Resets the mentions index to initial state.
 *
 * **Behavior**
 * - Clears the Orama DB reference and sets indexReady to false
 * - Used for HMR cleanup or manual teardown
 * - Safe to call multiple times
 *
 * @remarks
 * After calling, `initMentionsIndex()` must be called again to use the index
 */
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

/** Workspace-owned mention title index and current AI context resolution. */
import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';
import { reportError } from '~/utils/errors';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';
import { getActiveWorkspaceId, getDb, getWorkspaceGeneration } from '~/db/client';
import { parseFileHashes } from '~/db/files-util';

export interface MentionItem {
    id: string;
    source: 'document' | 'chat' | 'file';
    label: string;
    subtitle?: string;
    score?: number;
    imageHash?: string;
    imageSizeBytes?: number;
}

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


interface IndexRecord {
    id: string;
    recordId: string;
    title: string;
    source: MentionItem['source'];
}
let mentionsDb: unknown = null;
let records: IndexRecord[] = [];
let initPromise: Promise<void> | null = null;
let revision = 0;
let workspaceGeneration = -1;
const invalidationListeners = new Set<() => void>();

/** Open pickers subscribe only for their visible lifetime. */
export function subscribeMentionInvalidation(listener: () => void): () => void {
    invalidationListeners.add(listener);
    return () => { invalidationListeners.delete(listener); };
}

/** Invalidates both pending reads and already-built indexes. */
export function resetIndex() {
    revision += 1;
    initPromise = null;
    mentionsDb = null;
    records = [];
    for (const listener of invalidationListeners) listener();
}

/** Share initial work; reset cancels publication by any superseded build. */
export function initMentionsIndex(): Promise<void> {
    if (workspaceGeneration !== getWorkspaceGeneration()) {
        workspaceGeneration = getWorkspaceGeneration();
        resetIndex();
    }
    if (mentionsDb) return Promise.resolve();
    if (initPromise) return initPromise;
    const pending = (async () => {
        const version = revision;
        const generation = getWorkspaceGeneration();
        const db = getDb();
        try {
            const candidates = await db.posts.where('postType').anyOf('doc', FILE_CATALOG_POST_TYPE)
                .and(isVisibleWorkspaceItem).toArray();
            const docs = await Promise.all(candidates.map(async post => {
                if (post.postType === FILE_CATALOG_POST_TYPE) {
                    const hashes = parseFileHashes(post.file_hashes);
                    const meta = hashes.length === 1 ? await db.file_meta.get(hashes[0]!) : undefined;
                    if (!meta || meta.deleted) return null;
                }
                const source = post.postType === FILE_CATALOG_POST_TYPE ? 'file' : 'document';
                return { id: `${source}:${post.id}`, recordId: post.id, title: post.title || 'Untitled', source } as IndexRecord;
            }));
            const threads = await db.threads.filter(t => !t.deleted).toArray();
            const nextRecords: IndexRecord[] = [
                ...docs.filter((row): row is IndexRecord => row !== null),
                ...threads.map(t => ({ id: `chat:${t.id}`, recordId: t.id, title: t.title || 'Untitled Chat', source: 'chat' as const })),
            ];
            const next = await createDb({ recordId: 'string', title: 'string', source: 'string' });
            if (next) await buildIndex(next, nextRecords);
            // Workspace switches and mutations retire the entire snapshot.
            if (generation !== getWorkspaceGeneration()) return;
            if (version !== revision) return;
            records = nextRecords;
            mentionsDb = next;
            return;
        } catch (error) {
            if (generation !== getWorkspaceGeneration()) return;
            if (version !== revision) return;
            reportError(error, { code: 'ERR_INTERNAL', message: 'Mentions index init failed',
                tags: { domain: 'chat', feature: 'mentions', stage: 'init' }, toast: false });
            return;
        }
    })();
    initPromise = pending;
    void pending.finally(() => { if (initPromise === pending) initPromise = null; });
    return pending;
}

/** Search titles only, with per-source limits and a substring fallback. */
export async function searchMentions(query: string, options?: {
    maxPerGroup?: number;
    documentsEnabled?: boolean;
    conversationsEnabled?: boolean;
    currentDocumentId?: string;
}): Promise<MentionItem[]> {
    const db = getDb();
    const generation = getWorkspaceGeneration();
    const version = revision;
    const index = mentionsDb;
    const current = () => generation === getWorkspaceGeneration() && version === revision;
    if (!index || workspaceGeneration !== generation) return [];
    const limit = Math.max(1, options?.maxPerGroup ?? MAX_PER_GROUP);
    const enabled = records.filter(row => row.source === 'chat'
        ? (options?.conversationsEnabled ?? ENABLED_SOURCES.conversations)
        : (options?.documentsEnabled ?? ENABLED_SOURCES.documents)
            && !(row.source === 'document' && row.recordId === options?.currentDocumentId));
    const needle = query.trim().toLowerCase();
    let matches: IndexRecord[];
    try {
        const response = await searchWithIndex(index, needle, 50, { properties: ['title'] });
        if (!current()) return [];
        const byId = new Map(enabled.map(row => [row.id, row]));
        matches = response.hits.flatMap(hit => {
            const result = hit as { id?: string; document?: { id?: string } };
            const row = byId.get(result.id ?? result.document?.id ?? '');
            return row ? [row] : [];
        });
        if (!matches.length) matches = enabled.filter(row => row.title.toLowerCase().includes(needle));
    } catch {
        if (!current()) return [];
        matches = enabled.filter(row => row.title.toLowerCase().includes(needle));
    }
    const items: MentionItem[] = [];
    let docCount = 0;
    let chatCount = 0;
    for (const record of matches) {
        if (!current()) return [];
        if (record.source === 'chat' ? chatCount >= limit : docCount >= limit) continue;
        const item: MentionItem = { id: record.recordId, source: record.source, label: record.title };
        if (record.source === 'chat') {
            const row = await db.threads.get(item.id);
            if (!row || row.deleted || (row.title || 'Untitled Chat') !== record.title) continue;
            chatCount += 1;
        } else {
            const row = await db.posts.get(item.id);
            if (!row || !isVisibleWorkspaceItem(row) || row.postType !== (record.source === 'file' ? FILE_CATALOG_POST_TYPE : 'doc')
                || (row.title || 'Untitled') !== record.title) continue;
            if (record.source === 'file') {
                const hashes = parseFileHashes(row.file_hashes);
                const meta = hashes.length === 1 ? await db.file_meta.get(hashes[0]!) : undefined;
                if (!meta || meta.deleted) continue;
                if (meta.mime_type.startsWith('image/')) { item.imageHash = meta.hash; item.imageSizeBytes = meta.size_bytes; }
            }
            docCount += 1;
        }
        items.push(item);
    }
    if (!current()) return [];
    return [...items.filter(item => item.source !== 'chat'), ...items.filter(item => item.source === 'chat')];
}

/** Extract valid identities from saved editor JSON, once per source and ID. */
export function collectMentions(doc: unknown): MentionItem[] {
    const mentions: MentionItem[] = [];
    const seen = new Set<string>();
    function walk(value: unknown) {
        if (!value || typeof value !== 'object') return;
        const node = value as { type?: unknown; attrs?: Partial<MentionItem>; content?: unknown };
        const attrs = node.attrs;
        if (node.type === 'mention' && attrs && typeof attrs.id === 'string' && attrs.id
            && (attrs.source === 'document' || attrs.source === 'chat' || attrs.source === 'file')) {
            const key = `${attrs.source}:${attrs.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                mentions.push({ id: attrs.id, source: attrs.source, label: typeof attrs.label === 'string' ? attrs.label : '' });
            }
        }
        if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(doc);
    return mentions;
}

function truncateBytes(text: string, maxBytes: number): string {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= maxBytes) return text;
    // Streaming decode omits an incomplete final UTF-8 code point.
    return new TextDecoder().decode(bytes.slice(0, maxBytes), { stream: true }) + '\n...[truncated]';
}

/** Reuse workspace reads so mentions honor live editors, transcript visibility,
 * current titles, and originating account/workspace access throughout the read. */
export async function resolveMention(mention: MentionItem): Promise<string | null> {
    try {
        if (mention.source === 'chat' ? !ENABLED_SOURCES.conversations : !ENABLED_SOURCES.documents) return null;
        const scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
            threadId: 'mention-context', messageId: null, requestId: 'mention-context', callId: mention.id,
            abortSignal: new AbortController().signal });
        const { readWorkspaceItem, workspaceRead } = await import('~/utils/chat/workspace-items');
        scope.assertCurrent();
        if (mention.source === 'file') {
            const read = await workspaceRead(scope, { kind: 'file', id: mention.id });
            scope.assertCurrent();
            const coverage = 'textCoverage' in read ? read.textCoverage : 'none';
            return `(Referenced File: ${read.source.title}; indexed text: ${coverage}; this page: ${read.coverage})\n${truncateBytes(read.content, MAX_CONTEXT_BYTES)}`;
        }
        if (mention.source !== 'document' && mention.source !== 'chat') return null;
        const read = await readWorkspaceItem(scope, { kind: mention.source, id: mention.id });
        scope.assertCurrent();
        const kind = mention.source === 'document' ? 'Document' : 'Chat';
        return `(Referenced ${kind}: ${read.source.title})\n${truncateBytes(read.content, MAX_CONTEXT_BYTES)}`;
    } catch (error) {
        reportError(error, { code: 'ERR_INTERNAL', message: `Failed to resolve ${mention.source} ${mention.id}`,
            tags: { domain: 'chat', feature: 'mentions', stage: 'resolve' }, toast: false });
        return null;
    }
}

export default { initMentionsIndex, searchMentions, collectMentions, resolveMention, resetIndex, setMentionsConfig };

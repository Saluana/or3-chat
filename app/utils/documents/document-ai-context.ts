import type { MentionItem } from '~/plugins/ChatMentions/useChatMentions';

export interface DocumentAiContextReference {
    id: string;
    source: 'document' | 'chat';
    label: string;
}

export interface DocumentAiMentionSearchOptions {
    currentDocumentId: string;
    documentsEnabled: boolean;
    conversationsEnabled: boolean;
    maxPerGroup?: number;
    maxContextBytes?: number;
}

function normalizeQuery(value: string) {
    return value.trim().toLocaleLowerCase();
}

function matchesQuery(label: string, query: string) {
    return !query || label.toLocaleLowerCase().includes(query);
}

function dedupeReferences(references: readonly DocumentAiContextReference[]) {
    const seen = new Set<string>();
    return references.filter((reference) => {
        const key = `${reference.source}:${reference.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function fallbackSearch(
    query: string,
    options: DocumentAiMentionSearchOptions,
): Promise<MentionItem[]> {
    const { db } = await import('~/db');
    const limit = Math.max(1, options.maxPerGroup ?? 5);
    const normalized = normalizeQuery(query);

    const [documents, conversations] = await Promise.all([
        options.documentsEnabled
            ? db.posts
                  .where('postType')
                  .equals('doc')
                  .and((document) => !document.deleted && document.id !== options.currentDocumentId)
                  .toArray()
            : [],
        options.conversationsEnabled
            ? db.threads.filter((thread) => !thread.deleted).toArray()
            : [],
    ]);

    return [
        ...documents
            .filter((document) => matchesQuery(document.title || 'Untitled', normalized))
            .slice(0, limit)
            .map((document) => ({
                id: document.id,
                source: 'document' as const,
                label: document.title || 'Untitled',
                subtitle: 'Document',
            })),
        ...conversations
            .filter((thread) => matchesQuery(thread.title || 'Untitled Chat', normalized))
            .slice(0, limit)
            .map((thread) => ({
                id: thread.id,
                source: 'chat' as const,
                label: thread.title || 'Untitled Chat',
                subtitle: 'Chat',
            })),
    ];
}

export async function searchDocumentAiMentions(
    query: string,
    options: DocumentAiMentionSearchOptions,
): Promise<MentionItem[]> {
    const mentionApi = await import('~/plugins/ChatMentions/useChatMentions');
    mentionApi.setMentionsConfig({
        maxPerGroup: options.maxPerGroup,
        maxContextBytes: options.maxContextBytes,
        enabledSources: {
            documents: options.documentsEnabled,
            conversations: options.conversationsEnabled,
        },
    });

    try {
        await mentionApi.initMentionsIndex();
        const indexed = (await mentionApi.searchMentions(query)).filter(
            (item) => item.source !== 'document' || item.id !== options.currentDocumentId,
        );
        if (indexed.length) return indexed;
    } catch {
        // Fall through to the workspace-scoped Dexie search.
    }

    return fallbackSearch(query, options);
}

export async function resolveDocumentAiReference(
    reference: DocumentAiContextReference,
): Promise<string | null> {
    const { resolveMention } = await import('~/plugins/ChatMentions/useChatMentions');
    return resolveMention(reference);
}

function escapeXml(value: string) {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

export function formatDocumentAiReferenceContext(
    entries: readonly { reference: DocumentAiContextReference; content: string }[],
) {
    return entries
        .map(({ reference, content }) =>
            `<context type="reference" source="${reference.source}" id="${escapeXml(reference.id)}" label="${escapeXml(reference.label)}">\n${escapeXml(content)}\n</context>`,
        )
        .join('\n');
}

export function uniqueDocumentAiReferences(
    references: readonly DocumentAiContextReference[],
) {
    return dedupeReferences(references);
}

import {
    createDb,
    insertDocumentsBatched,
    removeDoc,
    searchWithIndex,
} from '~/core/search/orama';
import { ResourceChunkTracker, resourceToIndexDocuments } from './chunker';
import { groupHitsByResource, resourceToResult } from './group-hits';
import { buildEscapedSnippet } from './snippets';
import {
    PALETTE_INSERT_BATCH_SIZE,
    PALETTE_ORAMA_LIMIT,
    type PaletteIndexDocument,
    type PaletteResource,
    type PaletteResult,
} from './types';

const PALETTE_SCHEMA = {
    id: 'string',
    resourceKey: 'string',
    recordId: 'string',
    title: 'string',
    subtitle: 'string',
    keywords: 'string',
    body: 'string',
    updatedAt: 'number',
    chunkIndex: 'number',
} as const;

export interface PaletteSourceIndexSearchOptions {
    term: string;
    limit?: number;
    forceFallback?: boolean;
    signal?: AbortSignal;
}

export interface PaletteSourceIndexSearchResult {
    results: PaletteResult[];
    usingFallback: boolean;
    oramaFailed: boolean;
}

/**
 * Per-source in-memory Orama index with substring fallback over normalized records.
 */
export class PaletteSourceIndex {
    readonly sourceId: string;
    private db: unknown | null = null;
    private oramaAvailable = true;
    private readonly resources = new Map<string, PaletteResource>();
    private readonly tracker = new ResourceChunkTracker();
    private disposed = false;

    constructor(sourceId: string) {
        this.sourceId = sourceId;
    }

    get resourceCount(): number {
        return this.resources.size;
    }

    getResources(): PaletteResource[] {
        return [...this.resources.values()];
    }

    getResource(resourceKey: string): PaletteResource | undefined {
        return this.resources.get(resourceKey);
    }

    async ensureDb(): Promise<unknown | null> {
        if (this.disposed) return null;
        if (!this.oramaAvailable) return null;
        if (this.db) return this.db;
        try {
            this.db = await createDb({ ...PALETTE_SCHEMA });
            return this.db;
        } catch {
            this.oramaAvailable = false;
            this.db = null;
            return null;
        }
    }

    async replaceAll(
        resources: readonly PaletteResource[],
        options?: {
            signal?: AbortSignal;
            onBatchComplete?: (durationMs: number, count: number) => void;
        }
    ): Promise<void> {
        this.resources.clear();
        this.tracker.clear();
        this.db = null;
        for (const resource of resources) {
            this.resources.set(resource.key, resource);
        }
        const docs = resources.flatMap((resource) => {
            const documents = resourceToIndexDocuments(resource);
            this.tracker.set(
                resource.key,
                documents.map((doc) => doc.id)
            );
            return documents;
        });
        const db = await this.ensureDb();
        if (!db || options?.signal?.aborted) return;
        try {
            await insertDocumentsBatched(db, docs, {
                batchSize: PALETTE_INSERT_BATCH_SIZE,
                signal: options?.signal,
                onBatchComplete: options?.onBatchComplete,
            });
        } catch (error) {
            if (isAbortError(error)) throw error;
            this.oramaAvailable = false;
            this.db = null;
        }
    }

    async upsertResource(
        resource: PaletteResource,
        options?: { signal?: AbortSignal }
    ): Promise<void> {
        throwIfAborted(options?.signal);
        await this.removeResource(resource.key);
        this.resources.set(resource.key, resource);
        const docs = resourceToIndexDocuments(resource);
        this.tracker.set(
            resource.key,
            docs.map((doc) => doc.id)
        );
        const db = await this.ensureDb();
        if (!db) return;
        try {
            await insertDocumentsBatched(db, docs, {
                batchSize: PALETTE_INSERT_BATCH_SIZE,
                yieldBetweenBatches: false,
                signal: options?.signal,
            });
        } catch (error) {
            if (isAbortError(error)) throw error;
            this.oramaAvailable = false;
            this.db = null;
        }
    }

    async reconcileAll(
        resources: readonly PaletteResource[],
        options?: { signal?: AbortSignal }
    ): Promise<void> {
        const nextByKey = new Map(resources.map((resource) => [resource.key, resource]));
        for (const key of [...this.resources.keys()]) {
            throwIfAborted(options?.signal);
            if (!nextByKey.has(key)) await this.removeResource(key);
        }
        for (const resource of resources) {
            throwIfAborted(options?.signal);
            const current = this.resources.get(resource.key);
            if (current && resourcesEqual(current, resource)) continue;
            await this.upsertResource(resource, options);
        }
    }

    async removeResource(resourceKey: string): Promise<void> {
        this.resources.delete(resourceKey);
        const chunkIds = this.tracker.remove(resourceKey);
        const db = this.db;
        if (!db || !this.oramaAvailable) return;
        for (const id of chunkIds) {
            try {
                await removeDoc(db, id);
            } catch {
                // Ignore missing docs during incremental cleanup.
            }
        }
    }

    async search(
        options: PaletteSourceIndexSearchOptions
    ): Promise<PaletteSourceIndexSearchResult> {
        const term = options.term.trim();
        const limit = options.limit ?? PALETTE_ORAMA_LIMIT;
        if (!term) {
            return {
                results: this.getResources()
                    .sort(
                        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
                    )
                    .slice(0, limit)
                    .map((resource) => resourceToResult(resource)),
                usingFallback: false,
                oramaFailed: false,
            };
        }

        if (!options.forceFallback && this.oramaAvailable) {
            const db = await this.ensureDb();
            if (db) {
                try {
                    const tolerance = term.length >= 4 ? 1 : 0;
                    const pageSize = Math.max(
                        PALETTE_ORAMA_LIMIT,
                        Math.min(100, limit * 3)
                    );
                    const hits: Array<{
                        document: PaletteIndexDocument;
                        score: number;
                    }> = [];
                    let offset = 0;
                    let grouped: PaletteResult[] = [];
                    while (grouped.length < limit) {
                        throwIfAborted(options.signal);
                        const raw = await searchWithIndex(db, term, pageSize, {
                            properties: ['title', 'keywords', 'subtitle', 'body'],
                            boost: {
                                title: 5,
                                keywords: 3,
                                subtitle: 2,
                                body: 1,
                            },
                            tolerance,
                            offset,
                        });
                        const pageHits = normalizeOramaHits(raw.hits);
                        hits.push(...pageHits);
                        grouped = groupHitsByResource(
                            hits,
                            this.resources,
                            term
                        );
                        if (raw.hits.length < pageSize) break;
                        offset += raw.hits.length;
                    }
                    return {
                        results: grouped.slice(0, limit),
                        usingFallback: false,
                        oramaFailed: false,
                    };
                } catch (error) {
                    if (isAbortError(error)) throw error;
                    this.oramaAvailable = false;
                    this.db = null;
                }
            }
        }

        return {
            results: this.fallbackSearch(term, limit),
            usingFallback: true,
            oramaFailed: !this.oramaAvailable || Boolean(options.forceFallback),
        };
    }

    dispose(): void {
        this.disposed = true;
        this.db = null;
        this.resources.clear();
        this.tracker.clear();
    }

    private fallbackSearch(term: string, limit: number): PaletteResult[] {
        const needle = term.toLowerCase();
        const scored: Array<{ resource: PaletteResource; score: number; body: string }> =
            [];
        for (const resource of this.resources.values()) {
            const title = resource.title.toLowerCase();
            const subtitle = (resource.subtitle ?? '').toLowerCase();
            const keywords = (resource.keywords ?? []).join(' ').toLowerCase();
            const body = (resource.content ?? '').toLowerCase();
            let score = 0;
            if (title.includes(needle)) score += 50;
            if (keywords.includes(needle)) score += 30;
            if (subtitle.includes(needle)) score += 20;
            if (body.includes(needle)) score += 10;
            if (score > 0) {
                scored.push({
                    resource,
                    score,
                    body: resource.content ?? resource.title,
                });
            }
        }
        scored.sort(
            (a, b) =>
                b.score - a.score ||
                (b.resource.updatedAt ?? 0) - (a.resource.updatedAt ?? 0) ||
                a.resource.key.localeCompare(b.resource.key)
        );
        return scored.slice(0, limit).map(({ resource, score, body }) =>
            resourceToResult(resource, {
                score,
                snippet: buildEscapedSnippet(body, term),
            })
        );
    }
}

function resourcesEqual(
    left: PaletteResource,
    right: PaletteResource
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const error = new Error('Palette operation aborted');
    error.name = 'AbortError';
    throw error;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function normalizeOramaHits(
    hits: unknown[]
): Array<{ document: PaletteIndexDocument; score: number }> {
    const out: Array<{ document: PaletteIndexDocument; score: number }> = [];
    for (const hit of hits) {
        if (!hit || typeof hit !== 'object') continue;
        const record = hit as {
            score?: number;
            document?: PaletteIndexDocument;
            id?: string;
        };
        const document =
            record.document ??
            (isPaletteIndexDocument(hit)
                ? (hit as PaletteIndexDocument)
                : null);
        if (!document) continue;
        out.push({
            document,
            score: typeof record.score === 'number' ? record.score : 0,
        });
    }
    return out;
}

function isPaletteIndexDocument(value: unknown): value is PaletteIndexDocument {
    if (!value || typeof value !== 'object') return false;
    const doc = value as Partial<PaletteIndexDocument>;
    return typeof doc.id === 'string' && typeof doc.resourceKey === 'string';
}

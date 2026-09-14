import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { ImageSummary } from '~/db/files-select';
import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';

interface ImageSearchDoc {
    id: string;
    name: string;
    mime: string;
}

type OramaInstance = Record<string, unknown>;

export type ImageSearchStatus = 'idle' | 'pending' | 'ready';

/** Orama hit batches stay bounded; the loop walks the whole corpus. */
export const IMAGE_SEARCH_BATCH_SIZE = 200;

export interface ImageSearchState {
    query: Ref<string>;
    /** `null` means "no active query"; otherwise the whole-corpus match set. */
    matches: Ref<ReadonlySet<string> | null>;
    status: Ref<ImageSearchStatus>;
    /** Bumped whenever `matches` is republished. */
    revision: Ref<number>;
    rebuild: () => Promise<void>;
    search: () => Promise<void>;
}

function readHitId(hit: unknown): string | undefined {
    if (!hit || typeof hit !== 'object') return undefined;
    const record = hit as { document?: { id?: unknown }; id?: unknown };
    const id = record.document?.id ?? record.id;
    return typeof id === 'string' ? id : undefined;
}

/**
 * Search the compact image corpus (summaries only). Matching IDs are retrieved
 * in bounded Orama batches until exhausted, with a whole-corpus substring
 * fallback when Orama is unavailable, fails, or returns no matches.
 */
export function useImageSearch(
    summaries: Ref<ImageSummary[]>
): ImageSearchState {
    const query = ref('');
    const matches = ref<ReadonlySet<string> | null>(null);
    const status = ref<ImageSearchStatus>('idle');
    const revision = ref(0);
    let currentDb: OramaInstance | null = null;
    let indexedCorpus: ImageSummary[] | null = null;
    let activeBuild: Promise<void> | null = null;
    let activeBuildCorpus: ImageSummary[] | null = null;
    let queryToken = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function publish(result: Set<string>, token: number): void {
        if (token !== queryToken) return;
        matches.value = result;
        status.value = 'ready';
        revision.value += 1;
    }

    function fallback(raw: string): Set<string> {
        const needle = raw.toLocaleLowerCase();
        const result = new Set<string>();
        for (const summary of summaries.value) {
            if (
                `${summary.name}\n${summary.mime_type}`
                    .toLocaleLowerCase()
                    .includes(needle)
            ) {
                result.add(summary.hash);
            }
        }
        return result;
    }

    /** Build an index for one corpus snapshot without adopting stale results. */
    async function buildCorpusIndex(corpus: ImageSummary[]): Promise<void> {
        let db: OramaInstance | null = null;
        try {
            if (corpus.length) {
                db = (await createDb({
                    id: 'string',
                    name: 'string',
                    mime: 'string',
                })) as OramaInstance | null;
                if (db) {
                    const docs: ImageSearchDoc[] = corpus.map((summary) => ({
                        id: summary.hash,
                        name: summary.name,
                        mime: summary.mime_type,
                    }));
                    await buildOramaIndex(db, docs);
                }
            }
        } catch {
            // Orama is optional; queries fall back to substring matching.
            db = null;
        }
        // Obsolete builds must not publish an index for a corpus that changed
        // while it was constructing.
        if (summaries.value !== corpus) return;
        currentDb = db;
        indexedCorpus = corpus;
    }

    /**
     * Ensure the latest corpus has a settled index (built, empty, or failed).
     * Searches await the matching build instead of racing it with fallback
     * results; obsolete builds never publish their index.
     */
    async function ensureIndex(): Promise<void> {
        if (!process.client) return;
        for (;;) {
            const corpus = summaries.value;
            if (indexedCorpus === corpus) return;
            if (activeBuild && activeBuildCorpus === corpus) {
                await activeBuild;
                continue;
            }
            const build = buildCorpusIndex(corpus);
            activeBuild = build;
            activeBuildCorpus = corpus;
            try {
                await build;
            } finally {
                if (activeBuild === build) {
                    activeBuild = null;
                    activeBuildCorpus = null;
                }
            }
        }
    }

    async function runSearch(): Promise<void> {
        const raw = query.value.trim();
        const token = ++queryToken;
        if (!raw) {
            matches.value = null;
            status.value = 'idle';
            return;
        }
        status.value = 'pending';
        await ensureIndex();
        if (token !== queryToken) return;
        while (summaries.value !== indexedCorpus) {
            if (!process.client) break;
            await ensureIndex();
            if (token !== queryToken) return;
        }
        if (!currentDb) {
            publish(fallback(raw), token);
            return;
        }

        try {
            const known = new Set(summaries.value.map((item) => item.hash));
            const found = new Set<string>();
            const maxBatches = Math.max(
                1,
                Math.ceil(known.size / IMAGE_SEARCH_BATCH_SIZE)
            );
            let offset = 0;
            for (let batch = 0; batch < maxBatches; batch += 1) {
                const response = await searchWithIndex(
                    currentDb,
                    raw,
                    IMAGE_SEARCH_BATCH_SIZE,
                    { offset, properties: ['name', 'mime'] }
                );
                if (token !== queryToken) return;
                const hits = Array.isArray(response.hits) ? response.hits : [];
                const before = found.size;
                for (const hit of hits) {
                    const id = readHitId(hit);
                    if (id && known.has(id)) found.add(id);
                }
                if (hits.length < IMAGE_SEARCH_BATCH_SIZE) break;
                if (found.size === before) break;
                offset += IMAGE_SEARCH_BATCH_SIZE;
            }
            publish(found.size > 0 ? found : fallback(raw), token);
        } catch {
            // Orama failure falls back to the whole-corpus substring scan.
            publish(fallback(raw), token);
        }
    }

    watch(summaries, () => {
        currentDb = null;
        indexedCorpus = null;
        void runSearch();
    });

    watch(query, (value) => {
        clearTimeout(timeout);
        const raw = value.trim();
        if (!raw) {
            queryToken += 1;
            matches.value = null;
            status.value = 'idle';
            return;
        }
        // Drop stale matches immediately so callers never apply them.
        queryToken += 1;
        matches.value = null;
        status.value = 'pending';
        revision.value += 1;
        timeout = setTimeout(() => void runSearch(), 120);
    });

    onScopeDispose(() => {
        clearTimeout(timeout);
        queryToken += 1;
    });

    return {
        query,
        matches,
        status,
        revision,
        rebuild: ensureIndex,
        search: runSearch,
    };
}

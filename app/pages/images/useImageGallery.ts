/**
 * @module app/pages/images/useImageGallery
 *
 * Purpose:
 * Gallery controller for the image library page.
 *
 * Responsibilities:
 * - Own the compact image corpus, global counts, and page window.
 * - Coordinate keyset pages, name-order snapshots, search membership, and
 *   document reference membership.
 * - Invalidate on Dexie writes and workspace changes, discard stale requests,
 *   and expose retryable failure state.
 *
 * Non-responsibilities:
 * - Selection, viewer state, and mutation flows (owned by the page).
 */
import {
    computed,
    getCurrentScope,
    onScopeDispose,
    ref,
    shallowRef,
    watch,
    type ComputedRef,
    type Ref,
} from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import {
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { listDocumentFileHashes } from '~/db/documents';
import {
    getImageMetasByHashes,
    listImagePage,
    listImageSummaries,
    type GalleryState,
    type ImageIndexedCursor,
    type ImageSummary,
    type ImagePageSort,
} from '~/db/files-select';
import type { FileMeta } from '~/db/schema';
import { useImageSearch } from '~/core/search/useImageSearch';
import {
    imageSummaryCounts,
    isGeneratedImageName,
    orderImageSummariesByName,
    type ImageLibrarySort,
    type ImageLibraryView,
} from './image-library';
import { reportError } from '~/utils/errors';

type LoadState = 'pending' | 'ready' | 'failed';
type AggregateCounts = Record<ImageLibraryView, number | null>;

const DEFAULT_PAGE_SIZE = 50;

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

export interface UseImageGalleryOptions {
    pageSize?: number;
    /** Called after workspace state is cleared so the page can reset UI state. */
    onWorkspaceChange?: () => void;
}

export interface UseImageGalleryState {
    activeView: Ref<ImageLibraryView>;
    sortMode: Ref<ImageLibrarySort>;
    searchQuery: Ref<string>;
    items: Ref<FileMeta[]>;
    loading: Ref<boolean>;
    done: Ref<boolean>;
    pageError: Ref<Error | null>;
    counts: ComputedRef<AggregateCounts>;
    countsFailed: ComputedRef<boolean>;
    matchingTotal: ComputedRef<number | null>;
    searchPending: ComputedRef<boolean>;
    start: () => void;
    stop: () => void;
    retry: () => void;
    refresh: () => void;
    loadMore: () => Promise<void>;
}

/**
 * Create the image gallery controller. Call `start()` once mounted.
 */
export function useImageGallery(
    options: UseImageGalleryOptions = {}
): UseImageGalleryState {
    const requestedPageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageSize =
        Number.isFinite(requestedPageSize) && requestedPageSize > 0
            ? Math.floor(requestedPageSize)
            : DEFAULT_PAGE_SIZE;

    const activeView = ref<ImageLibraryView>('all');
    const sortMode = ref<ImageLibrarySort>('newest');
    const items = ref<FileMeta[]>([]);
    const loading = ref(false);
    const done = ref(false);
    const pageError = ref<Error | null>(null);
    const pagesLoaded = ref(0);
    const cursor = ref<ImageIndexedCursor | null>(null);

    const summaries = shallowRef<ImageSummary[]>([]);
    const summariesState = ref<LoadState>('pending');
    const summariesError = ref<Error | null>(null);
    const summariesRevision = ref(0);
    const usedInDocumentHashes = ref<ReadonlySet<string>>(new Set());
    const referencesState = ref<LoadState>('pending');
    const referencesError = ref<Error | null>(null);
    const referencesRevision = ref(0);

    const search = useImageSearch(summaries);
    const searchQuery = search.query;

    const state = computed<GalleryState>(() =>
        activeView.value === 'trash' ? 'trash' : 'active'
    );
    const isNameSort = computed(
        () => sortMode.value === 'name-asc' || sortMode.value === 'name-desc'
    );
    /** Page queries that cannot be answered without the summary corpus. */
    const pageDependsOnSummaries = computed(
        () =>
            activeView.value === 'uploads' ||
            activeView.value === 'generated' ||
            isNameSort.value
    );

    let summariesSub: Subscription | null = null;
    let referencesSub: Subscription | null = null;
    let workspaceUnsub: (() => void) | null = null;
    let started = false;
    let summariesInitialized = false;
    let summariesFailureReported = false;
    let referencesFailureReported = false;

    function subscribeSummaries(): void {
        summariesSub?.unsubscribe();
        summariesSub = null;
        summariesState.value = 'pending';
        summariesError.value = null;
        summariesFailureReported = false;
        summariesInitialized = false;
        const generation = getWorkspaceGeneration();
        const observable = liveQuery(() => listImageSummaries());
        summariesSub = observable.subscribe({
            next: (rows) => {
                if (generation !== getWorkspaceGeneration()) return;
                const initial = !summariesInitialized;
                summariesInitialized = true;
                summaries.value = rows;
                summariesRevision.value += 1;
                summariesState.value = 'ready';
                summariesError.value = null;
                // Initial corpus completion only re-reads pages whose query
                // depends on it; later emissions signal data changes.
                if (!initial || pageDependsOnSummaries.value) {
                    requestRefresh(false);
                }
            },
            error: (error) => {
                if (generation !== getWorkspaceGeneration()) return;
                const normalized = toError(error);
                summariesState.value = 'failed';
                summariesError.value = normalized;
                if (!summariesFailureReported) {
                    summariesFailureReported = true;
                    reportError(normalized, {
                        code: 'ERR_DB_READ_FAILED',
                        message: "Couldn't load image library counts.",
                        retryable: true,
                        tags: { domain: 'images', action: 'summaries' },
                    });
                }
                // Release any page load waiting on this dependency and expose
                // the retry state instead of leaving the gallery loading.
                requestRefresh(false);
            },
        });
    }

    function subscribeReferences(): void {
        referencesSub?.unsubscribe();
        referencesSub = null;
        referencesState.value = 'pending';
        referencesError.value = null;
        referencesFailureReported = false;
        const generation = getWorkspaceGeneration();
        const observable = liveQuery(() => listDocumentFileHashes());
        referencesSub = observable.subscribe({
            next: (hashes) => {
                if (generation !== getWorkspaceGeneration()) return;
                usedInDocumentHashes.value = new Set(hashes);
                referencesRevision.value += 1;
                referencesState.value = 'ready';
                referencesError.value = null;
                // References only affect page membership in the used-in-docs
                // view; other views only consume them for counts.
                if (activeView.value === 'used-in-docs') {
                    requestRefresh(false);
                }
            },
            error: (error) => {
                if (generation !== getWorkspaceGeneration()) return;
                const normalized = toError(error);
                referencesState.value = 'failed';
                referencesError.value = normalized;
                if (!referencesFailureReported) {
                    referencesFailureReported = true;
                    reportError(normalized, {
                        code: 'ERR_DB_READ_FAILED',
                        message: "Couldn't load document image references.",
                        retryable: true,
                        tags: { domain: 'images', action: 'references' },
                    });
                }
                requestRefresh(false);
            },
        });
    }

    function handleWorkspaceChange(): void {
        summaries.value = [];
        summariesState.value = 'pending';
        summariesRevision.value += 1;
        usedInDocumentHashes.value = new Set();
        referencesState.value = 'pending';
        referencesRevision.value += 1;
        options.onWorkspaceChange?.();
        if (!started) return;
        subscribeSummaries();
        subscribeReferences();
        resetQuery();
    }

    function start(): void {
        if (started) return;
        started = true;
        subscribeSummaries();
        subscribeReferences();
        workspaceUnsub = subscribeActiveWorkspaceDb(() => {
            handleWorkspaceChange();
        });
        resetQuery();
    }

    function stop(): void {
        started = false;
        requestVersion += 1;
        refreshQueued = false;
        summariesSub?.unsubscribe();
        summariesSub = null;
        referencesSub?.unsubscribe();
        referencesSub = null;
        workspaceUnsub?.();
        workspaceUnsub = null;
    }

    function retry(): void {
        if (summariesState.value === 'failed') subscribeSummaries();
        if (referencesState.value === 'failed') subscribeReferences();
        requestRefresh(false);
    }

    function refresh(): void {
        requestRefresh(false);
    }

    // --- Filter membership and readiness -------------------------------------

    function filterReadiness(): { ready: boolean; error: Error | null } {
        const requiresSummaries =
            activeView.value === 'uploads' ||
            activeView.value === 'generated' ||
            isNameSort.value ||
            searchQuery.value.trim().length > 0;
        if (requiresSummaries) {
            if (summariesState.value === 'failed') {
                return {
                    ready: false,
                    error:
                        summariesError.value ??
                        new Error('Image summaries failed.'),
                };
            }
            if (summariesState.value !== 'ready') {
                return { ready: false, error: null };
            }
        }
        if (activeView.value === 'used-in-docs') {
            if (referencesState.value === 'failed') {
                return {
                    ready: false,
                    error:
                        referencesError.value ??
                        new Error('Document references failed.'),
                };
            }
            if (referencesState.value !== 'ready') {
                return { ready: false, error: null };
            }
        }
        if (searchQuery.value.trim() && search.status.value !== 'ready') {
            return { ready: false, error: null };
        }
        return { ready: true, error: null };
    }

    function buildFilter(): Set<string> | null {
        const conditions: Array<ReadonlySet<string>> = [];
        if (activeView.value === 'uploads' || activeView.value === 'generated') {
            const wantsGenerated = activeView.value === 'generated';
            const viewSet = new Set<string>();
            for (const summary of summaries.value) {
                if (summary.state !== state.value) continue;
                if (isGeneratedImageName(summary.name) === wantsGenerated) {
                    viewSet.add(summary.hash);
                }
            }
            conditions.push(viewSet);
        }
        if (activeView.value === 'used-in-docs') {
            conditions.push(usedInDocumentHashes.value);
        }
        if (searchQuery.value.trim()) {
            conditions.push(search.matches.value ?? new Set());
        }
        if (!conditions.length) return null;

        let result: Set<string> | null = null;
        for (const condition of conditions) {
            if (result === null) {
                result = new Set(condition);
                continue;
            }
            const kept = new Set<string>();
            for (const hash of result) {
                if (condition.has(hash)) kept.add(hash);
            }
            result = kept;
        }
        return result ?? new Set();
    }

    // --- Page window ---------------------------------------------------------

    let nameOrderCache: {
        key: string;
        ids: string[];
        /** Snapshot IDs consumed by accepted pages. */
        consumed: number;
    } | null = null;
    let requestVersion = 0;
    let refreshQueued = false;
    let draining = false;

    function nameOrderKey(filter: Set<string> | null): string {
        return [
            summariesRevision.value,
            referencesRevision.value,
            search.revision.value,
            activeView.value,
            sortMode.value,
            getWorkspaceGeneration(),
            filter ? filter.size : 'all',
        ].join('|');
    }

    function computeNameOrder(filter: Set<string> | null): {
        ids: string[];
        consumed: number;
    } {
        const key = nameOrderKey(filter);
        if (nameOrderCache && nameOrderCache.key === key) {
            return nameOrderCache;
        }
        const eligible = summaries.value.filter(
            (summary) =>
                summary.state === state.value &&
                (!filter || filter.has(summary.hash))
        );
        const ids = orderImageSummariesByName(
            eligible,
            sortMode.value === 'name-desc' ? 'name-desc' : 'name-asc'
        );
        nameOrderCache = { key, ids, consumed: 0 };
        return nameOrderCache;
    }

    function resetWindowState(): void {
        items.value = [];
        cursor.value = null;
        done.value = false;
        pagesLoaded.value = 0;
        pageError.value = null;
        nameOrderCache = null;
    }

    function resetQuery(): void {
        resetWindowState();
        requestRefresh(true);
    }

    function requestRefresh(resetWindow: boolean): void {
        requestVersion += 1;
        if (resetWindow) {
            resetWindowState();
        }
        refreshQueued = true;
        void drain();
    }

    async function fetchWindow(targetPages: number): Promise<{
        items: FileMeta[];
        cursor: ImageIndexedCursor | null;
        done: boolean;
    }> {
        const filter = buildFilter();
        if (isNameSort.value) {
            const order = computeNameOrder(filter);
            const wanted = Math.min(targetPages * pageSize, order.ids.length);
            let slice = order.ids.slice(0, wanted);
            let rows = await getImageMetasByHashes(slice);
            if (rows.length < slice.length) {
                // Drop rows lost during hydration from the snapshot so offsets
                // stay consistent; a summaries emission rebuilds the corpus.
                const found = new Set(rows.map((row) => row.hash));
                const missing = new Set(
                    slice.filter((id) => !found.has(id))
                );
                order.ids = order.ids.filter((id) => !missing.has(id));
                slice = order.ids.slice(0, wanted);
                rows = await getImageMetasByHashes(slice);
            }
            order.consumed = Math.min(slice.length, rows.length);
            return {
                items: rows,
                cursor: null,
                done: order.consumed >= order.ids.length,
            };
        }

        const collected: FileMeta[] = [];
        let nextCursor: ImageIndexedCursor | null = null;
        let missing = 0;
        for (let page = 0; page < targetPages; page += 1) {
            const result = await listImagePage({
                state: state.value,
                sort: sortMode.value as ImagePageSort,
                limit: pageSize,
                cursor: nextCursor,
                hashes: filter,
            });
            collected.push(...result.items);
            missing += result.missing;
            nextCursor = result.nextCursor;
            if (!result.hasMore) break;
        }
        if (missing > 0) {
            // Rows disappeared between index selection and hydration. Discard
            // this revision and re-run the current query from the start.
            requestRefresh(false);
        }
        return {
            items: collected,
            cursor: nextCursor,
            done: nextCursor === null,
        };
    }

    async function drain(): Promise<void> {
        if (draining) return;
        draining = true;
        try {
            while (refreshQueued) {
                refreshQueued = false;
                const version = requestVersion;
                const readiness = filterReadiness();
                if (!readiness.ready) {
                    loading.value = !readiness.error;
                    pageError.value = readiness.error;
                    continue;
                }
                loading.value = true;
                pageError.value = null;
                const targetPages = Math.max(1, pagesLoaded.value || 1);
                try {
                    const result = await fetchWindow(targetPages);
                    if (version !== requestVersion) continue;
                    items.value = result.items;
                    cursor.value = result.cursor;
                    done.value = result.done;
                    pagesLoaded.value = targetPages;
                } catch (error) {
                    if (version !== requestVersion) continue;
                    const normalized = toError(error);
                    pageError.value = normalized;
                    reportError(normalized, {
                        code: 'ERR_DB_READ_FAILED',
                        message: "Couldn't load images.",
                        retryable: true,
                        tags: { domain: 'images', action: 'list-page' },
                    });
                } finally {
                    if (version === requestVersion) loading.value = false;
                }
            }
        } finally {
            draining = false;
        }
    }

    async function loadMore(): Promise<void> {
        if (loading.value || done.value || !started) return;
        if (!filterReadiness().ready) return;
        const version = requestVersion;
        loading.value = true;
        pageError.value = null;
        try {
            if (isNameSort.value) {
                const order = computeNameOrder(buildFilter());
                const start = order.consumed;
                let slice = order.ids.slice(start, start + pageSize);
                if (!slice.length) {
                    done.value = true;
                    return;
                }
                let rows = await getImageMetasByHashes(slice);
                if (version !== requestVersion) return;
                if (rows.length < slice.length) {
                    // Drop rows lost during hydration from the snapshot so the
                    // consumed offset never skips or repeats entries.
                    const found = new Set(rows.map((row) => row.hash));
                    const missing = new Set(
                        slice.filter((id) => !found.has(id))
                    );
                    order.ids = order.ids.filter((id) => !missing.has(id));
                    slice = order.ids.slice(start, start + pageSize);
                    rows = await getImageMetasByHashes(slice);
                    if (version !== requestVersion) return;
                }
                order.consumed = start + Math.min(slice.length, rows.length);
                items.value = [...items.value, ...rows];
                pagesLoaded.value += 1;
                done.value = order.consumed >= order.ids.length;
                return;
            }
            const result = await listImagePage({
                state: state.value,
                sort: sortMode.value as ImagePageSort,
                limit: pageSize,
                cursor: cursor.value,
                hashes: buildFilter(),
            });
            if (version !== requestVersion) return;
            items.value = [...items.value, ...result.items];
            cursor.value = result.nextCursor;
            done.value = result.nextCursor === null;
            pagesLoaded.value = Math.ceil(items.value.length / pageSize);
            if (result.missing > 0) requestRefresh(false);
        } catch (error) {
            if (version !== requestVersion) return;
            const normalized = toError(error);
            pageError.value = normalized;
            reportError(normalized, {
                code: 'ERR_DB_READ_FAILED',
                message: "Couldn't load more images.",
                retryable: true,
                tags: { domain: 'images', action: 'load-more' },
            });
        } finally {
            if (version === requestVersion) loading.value = false;
        }
    }

    // --- Global aggregates ---------------------------------------------------

    const counts = computed<AggregateCounts>(() => {
        if (summariesState.value !== 'ready') {
            return {
                all: null,
                uploads: null,
                generated: null,
                'used-in-docs': null,
                trash: null,
            };
        }
        const base = imageSummaryCounts(
            summaries.value,
            usedInDocumentHashes.value
        );
        return {
            ...base,
            'used-in-docs':
                referencesState.value === 'ready'
                    ? base['used-in-docs']
                    : null,
        };
    });

    const countsFailed = computed(
        () =>
            summariesState.value === 'failed' ||
            referencesState.value === 'failed'
    );

    const searchPending = computed(
        () => searchQuery.value.trim().length > 0 && search.status.value !== 'ready'
    );

    const matchingTotal = computed<number | null>(() => {
        if (summariesState.value !== 'ready') return null;
        if (!filterReadiness().ready) return null;
        const filter = buildFilter();
        let total = 0;
        for (const summary of summaries.value) {
            if (summary.state !== state.value) continue;
            if (filter && !filter.has(summary.hash)) continue;
            total += 1;
        }
        return total;
    });

    // --- Reactivity ----------------------------------------------------------

    watch([activeView, sortMode], () => {
        if (!started) return;
        resetQuery();
    });

    // A changed query invalidates the whole window; the new membership is
    // fetched as a single page once search completion lands.
    watch(
        () => searchQuery.value.trim(),
        () => {
            if (!started) return;
            resetWindowState();
            requestRefresh(false);
        }
    );

    // Reference completion is scheduled from its subscription, and summaries
    // from theirs; only search completion needs a watcher here.
    watch(() => search.revision.value, () => {
        if (!started) return;
        requestRefresh(false);
    });

    if (getCurrentScope()) {
        onScopeDispose(stop);
    }

    return {
        activeView,
        sortMode,
        searchQuery,
        items,
        loading,
        done,
        pageError,
        counts,
        countsFailed,
        matchingTotal,
        searchPending,
        start,
        stop,
        retry,
        refresh,
        loadMore,
    };
}

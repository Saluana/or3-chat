import {
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    subscribeActiveWorkspaceDb,
} from '~/db/client';
import { subscribePluginGateChanges } from '~/utils/plugins/access-gate';
import { subscribeDashboardRegistry } from '~/composables/dashboard/useDashboardPlugins';
import { parsePaletteQuery } from './parse-query';
import {
    getPaletteAliasMap,
    listPaletteCommands,
    listPaletteSources,
    subscribePaletteRegistry,
} from './registry';
import { resourceToResult } from './group-hits';
import {
    buildFallbackPalettePreview,
    buildUnavailablePalettePreview,
} from './preview';
import { PaletteSourceIndex } from './source-index';
import { emitPaletteTelemetry } from './telemetry';
import {
    PALETTE_EMPTY_COMMANDS,
    PALETTE_EMPTY_RECENTS,
    PALETTE_MAX_PER_SOURCE,
    PALETTE_MAX_TOTAL,
    PALETTE_QUERY_DEBOUNCE_MS,
    type PaletteLoadContext,
    type PalettePreview,
    type PaletteResource,
    type PaletteResult,
    type PaletteSearchSource,
    type PaletteSourceStatus,
    type RegisteredPaletteCommand,
} from './types';

export interface PaletteCoordinatorSnapshot {
    query: string;
    parsedKind: 'all' | 'category';
    categoryId?: string;
    results: PaletteResult[];
    statuses: PaletteSourceStatus[];
    workspaceGeneration: number;
    loading: boolean;
}

type SnapshotListener = (snapshot: PaletteCoordinatorSnapshot) => void;

export interface PaletteCoordinator {
    setQuery(raw: string): void;
    getSnapshot(): PaletteCoordinatorSnapshot;
    subscribe(listener: SnapshotListener): () => void;
    ensureWarm(): Promise<void>;
    refreshSources(sourceIds?: readonly string[]): Promise<void>;
    retrySource(sourceId: string): Promise<void>;
    getResource(
        sourceId: string,
        resourceKey: string
    ): PaletteResource | undefined;
    hydratePreview(
        result: PaletteResult,
        options?: { signal?: AbortSignal }
    ): Promise<PalettePreview>;
    dispose(): void;
}

interface BoundSource {
    source: PaletteSearchSource;
    index: PaletteSourceIndex;
    status: PaletteSourceStatus;
    ready: boolean;
}

/**
 * Debounced multi-source query coordinator with workspace generation guards.
 */
export function createPaletteCoordinator(options?: {
    debounceMs?: number;
    canOpenNewPane?: () => boolean;
}): PaletteCoordinator {
    const debounceMs = options?.debounceMs ?? PALETTE_QUERY_DEBOUNCE_MS;
    const canOpenNewPane = options?.canOpenNewPane ?? (() => true);

    let disposed = false;
    let rawQuery = '';
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let queryGeneration = 0;
    let workspaceGeneration = getWorkspaceGeneration();
    let loading = false;
    let results: PaletteResult[] = [];
    let statuses: PaletteSourceStatus[] = [];
    let warmPromise: Promise<void> | null = null;
    let requestedWarmVersion = 0;
    let completedWarmVersion = -1;
    let warmAbortController = new AbortController();
    let queryAbortController = new AbortController();
    let refreshChain = Promise.resolve();
    const listeners = new Set<SnapshotListener>();
    const bound = new Map<string, BoundSource>();

    const unsubWorkspace = subscribeActiveWorkspaceDb((event) => {
        warmAbortController.abort();
        warmAbortController = new AbortController();
        workspaceGeneration = event.generation;
        clearResultsSync();
        disposeBoundSources();
        requestedWarmVersion += 1;
        void startWarm();
    });
    const unsubRegistry = subscribePaletteRegistry(() => {
        invalidateFullWarm();
    });
    const unsubGate = subscribePluginGateChanges(() => {
        invalidateFullWarm();
    });
    const unsubDashboard = subscribeDashboardRegistry(() => {
        void refreshSources(['dashboard']);
    });

    function invalidateFullWarm(): void {
        requestedWarmVersion += 1;
        warmAbortController.abort();
        warmAbortController = new AbortController();
        void startWarm();
    }

    function loadContext(signal?: AbortSignal): PaletteLoadContext {
        return {
            workspaceId: getActiveWorkspaceId() ?? 'default',
            workspaceGeneration,
            getDb: async () => getDb(),
            canOpenNewPane,
            signal,
        };
    }

    function clearResultsSync(): void {
        queryGeneration += 1;
        queryAbortController.abort();
        queryAbortController = new AbortController();
        results = [];
        statuses = [];
        loading = false;
        emitSnapshot();
    }

    function disposeBoundSources(): void {
        for (const entry of bound.values()) {
            entry.index.dispose();
        }
        bound.clear();
    }

    function emitSnapshot(): void {
        const parsed = parsePaletteQuery(rawQuery, getPaletteAliasMap());
        const snapshot: PaletteCoordinatorSnapshot = {
            query: rawQuery,
            parsedKind: parsed.kind,
            categoryId:
                parsed.kind === 'category' ? parsed.categoryId : undefined,
            results,
            statuses,
            workspaceGeneration,
            loading,
        };
        for (const listener of [...listeners]) {
            try {
                listener(snapshot);
            } catch {
                // Ignore listener failures.
            }
        }
    }

    async function reconcileSources(
        generation: number,
        options?: {
            sourceIds?: ReadonlySet<string>;
            signal?: AbortSignal;
        }
    ): Promise<void> {
        const context = loadContext(options?.signal);
        const sources = listPaletteSources();
        const liveIds = new Set(sources.map((source) => source.id));
        if (!options?.sourceIds) {
            for (const [sourceId, entry] of [...bound]) {
                if (liveIds.has(sourceId)) continue;
                entry.index.dispose();
                bound.delete(sourceId);
            }
        }

        const selectedSources = options?.sourceIds
            ? sources.filter((source) => options.sourceIds?.has(source.id))
            : sources;
        for (const source of selectedSources) {
            if (disposed || generation !== workspaceGeneration) return;
            const existing = bound.get(source.id);
            if (existing) {
                existing.source = source;
                existing.status = { sourceId: source.id, state: 'loading' };
                continue;
            }
            bound.set(source.id, {
                source,
                index: new PaletteSourceIndex(source.id),
                status: { sourceId: source.id, state: 'loading' },
                ready: false,
            });
        }

        statuses = [...bound.values()].map((entry) => entry.status);
        emitSnapshot();

        await Promise.all(
            selectedSources.map(async (source) => {
                const entry = bound.get(source.id);
                if (!entry) return;
                try {
                    throwIfAborted(options?.signal);
                    const resources = await abortable(
                        source.load(context),
                        options?.signal
                    );
                    throwIfAborted(options?.signal);
                    if (disposed || generation !== workspaceGeneration) return;
                    if (bound.get(source.id) !== entry) {
                        return;
                    }
                    if (entry.ready) {
                        await entry.index.reconcileAll(resources, {
                            signal: options?.signal,
                        });
                    } else {
                        const nextIndex = new PaletteSourceIndex(source.id);
                        try {
                            await nextIndex.replaceAll(resources, {
                                signal: options?.signal,
                            });
                            throwIfAborted(options?.signal);
                            if (
                                disposed ||
                                generation !== workspaceGeneration ||
                                bound.get(source.id) !== entry
                            ) {
                                nextIndex.dispose();
                                return;
                            }
                            entry.index.dispose();
                            entry.index = nextIndex;
                        } catch (error) {
                            nextIndex.dispose();
                            throw error;
                        }
                    }
                    entry.ready = true;
                    entry.status = { sourceId: source.id, state: 'ready' };
                } catch (error) {
                    if (isAbortError(error)) return;
                    if (disposed || generation !== workspaceGeneration) return;
                    if (bound.get(source.id) !== entry) return;
                    entry.status = {
                        sourceId: source.id,
                        state: 'error',
                        error: {
                            code: 'load-failed',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Source failed to load',
                            cause: error,
                        },
                    };
                }
            })
        );

        if (disposed || generation !== workspaceGeneration) return;
        statuses = [...bound.values()].map((entry) => entry.status);
        emitSnapshot();
    }

    async function performWarm(version: number): Promise<void> {
        if (disposed) return;
        const generation = workspaceGeneration;
        const signal = warmAbortController.signal;
        const started = performance.now();
        await reconcileSources(generation, { signal });
        if (disposed || generation !== workspaceGeneration) {
            emitPaletteTelemetry({
                kind: 'build',
                durationMs: performance.now() - started,
                outcome: 'stale',
            });
            return;
        }
        if (signal.aborted) return;
        completedWarmVersion = Math.max(completedWarmVersion, version);
        emitPaletteTelemetry({
            kind: 'build',
            sourceIds: [...bound.keys()],
            durationMs: performance.now() - started,
            counts: { sources: bound.size },
            outcome: 'success',
        });
        await runSearch(rawQuery, true);
    }

    function startWarm(): Promise<void> {
        if (disposed) return Promise.resolve();
        if (warmPromise) return warmPromise;
        const version = requestedWarmVersion;
        warmPromise = performWarm(version).finally(async () => {
            warmPromise = null;
            if (!disposed && completedWarmVersion < requestedWarmVersion) {
                await startWarm();
            }
        });
        return warmPromise;
    }

    function ensureWarm(): Promise<void> {
        if (disposed) return Promise.resolve();
        if (warmPromise) return warmPromise;
        requestedWarmVersion += 1;
        return startWarm();
    }

    function setQuery(raw: string): void {
        rawQuery = raw;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (!raw) {
            debounceTimer = null;
            void runSearch(raw, true);
            return;
        }
        debounceTimer = setTimeout(() => {
            void runSearch(rawQuery, false);
        }, debounceMs);
    }

    async function runSearch(raw: string, immediate: boolean): Promise<void> {
        if (disposed) return;
        const generationAtStart = workspaceGeneration;
        const requestId = ++queryGeneration;
        queryAbortController.abort();
        queryAbortController = new AbortController();
        const querySignal = queryAbortController.signal;
        loading = true;
        emitSnapshot();

        if (!immediate && !bound.size) {
            await ensureWarm();
        }

        const started = performance.now();
        const parsed = parsePaletteQuery(raw, getPaletteAliasMap());
        const term = parsed.term;
        const eligible = [...bound.values()].filter((entry) => {
            if (parsed.kind === 'category') {
                return (
                    entry.source.category.id === parsed.categoryId ||
                    entry.index
                        .getResources()
                        .some((resource) => resource.categoryId === parsed.categoryId)
                );
            }
            return true;
        });

        try {
            if (!term) {
                results = buildEmptyQueryResults(parsed.kind, parsed.kind === 'category' ? parsed.categoryId : undefined);
            } else {
                const settled = await Promise.all(
                    eligible.map(async (entry) => {
                        try {
                            const searchResult = await entry.index.search({
                                term,
                                limit: PALETTE_MAX_PER_SOURCE,
                                signal: querySignal,
                            });
                            if (searchResult.usingFallback) {
                                entry.status = {
                                    ...entry.status,
                                    usingFallback: true,
                                };
                            }
                            return searchResult.results.slice(
                                0,
                                PALETTE_MAX_PER_SOURCE
                            );
                        } catch (error) {
                            if (isAbortError(error)) {
                                return [] as PaletteResult[];
                            }
                            entry.status = {
                                sourceId: entry.source.id,
                                state: 'error',
                                error: {
                                    code: 'search-failed',
                                    message:
                                        error instanceof Error
                                            ? error.message
                                            : 'Search failed',
                                    cause: error,
                                },
                            };
                            return [] as PaletteResult[];
                        }
                    })
                );

                if (
                    disposed ||
                    requestId !== queryGeneration ||
                    generationAtStart !== workspaceGeneration
                ) {
                    emitPaletteTelemetry({
                        kind: 'query',
                        sourceIds: eligible.map((e) => e.source.id),
                        durationMs: performance.now() - started,
                        outcome: 'stale',
                    });
                    return;
                }

                // Preserve source section order; do not compare cross-source scores.
                const orderedSources = eligible
                    .slice()
                    .sort(
                        (a, b) =>
                            a.source.order - b.source.order ||
                            a.source.id.localeCompare(b.source.id)
                    );
                const bySourceId = new Map(
                    eligible.map((entry, index) => [
                        entry.source.id,
                        settled[index] ?? [],
                    ])
                );
                const flattened: PaletteResult[] = [];
                for (const entry of orderedSources) {
                    flattened.push(...(bySourceId.get(entry.source.id) ?? []));
                    if (flattened.length >= PALETTE_MAX_TOTAL) break;
                }
                results = flattened.slice(0, PALETTE_MAX_TOTAL);
            }

            if (
                disposed ||
                requestId !== queryGeneration ||
                generationAtStart !== workspaceGeneration
            ) {
                return;
            }

            statuses = [...bound.values()].map((b) => b.status);
            loading = false;
            emitSnapshot();
            emitPaletteTelemetry({
                kind: 'query',
                sourceIds: eligible.map((e) => e.source.id),
                durationMs: performance.now() - started,
                counts: {
                    results: results.length,
                    sources: eligible.length,
                },
                outcome: 'success',
            });
        } catch (error) {
            if (
                isAbortError(error) ||
                disposed ||
                requestId !== queryGeneration ||
                generationAtStart !== workspaceGeneration
            ) {
                return;
            }
            loading = false;
            emitSnapshot();
            emitPaletteTelemetry({
                kind: 'query',
                durationMs: performance.now() - started,
                outcome: 'failure',
                errorCategory:
                    error instanceof Error ? error.name : 'unknown',
            });
        }
    }

    function buildEmptyQueryResults(
        kind: 'all' | 'category',
        categoryId?: string
    ): PaletteResult[] {
        const out: PaletteResult[] = [];
        if (kind === 'all' || categoryId === 'command') {
            const commands = listPaletteCommands()
                .slice()
                .sort(
                    (a, b) =>
                        (a.order ?? 200) - (b.order ?? 200) ||
                        a.id.localeCompare(b.id)
                )
                .slice(0, PALETTE_EMPTY_COMMANDS);
            out.push(...commands.map(commandToResult));
        }

        if (kind === 'all' || (categoryId && categoryId !== 'command')) {
            const recentResources = [...bound.values()]
                .filter((entry) => {
                    if (kind === 'category') {
                        return (
                            entry.source.category.id === categoryId ||
                            entry.index
                                .getResources()
                                .some(
                                    (resource) =>
                                        resource.categoryId === categoryId
                                )
                        );
                    }
                    return entry.source.category.id !== 'command';
                })
                .flatMap((entry) => entry.index.getResources())
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                .slice(0, PALETTE_EMPTY_RECENTS)
                .map((resource) => resourceToResult(resource));
            out.push(...recentResources);
        } else if (kind === 'category' && categoryId === 'command') {
            // already handled
        }

        return out.slice(0, PALETTE_MAX_TOTAL);
    }

    function getResource(
        sourceId: string,
        resourceKey: string
    ): PaletteResource | undefined {
        return bound.get(sourceId)?.index.getResource(resourceKey);
    }

    async function hydratePreview(
        result: PaletteResult,
        options?: { signal?: AbortSignal }
    ): Promise<PalettePreview> {
        const entry = bound.get(result.sourceId);
        const resource = entry?.index.getResource(result.key);
        if (!entry || !resource) return buildUnavailablePalettePreview(result);

        const fallback = buildFallbackPalettePreview(resource, result);
        if (!entry.source.hydratePreview) return fallback;

        try {
            return await entry.source.hydratePreview(resource, {
                workspaceId: getActiveWorkspaceId() ?? 'default',
                workspaceGeneration,
                getDb: async () => getDb(),
                signal: options?.signal,
            });
        } catch {
            return { ...fallback, unavailable: true };
        }
    }

    async function retrySource(sourceId: string): Promise<void> {
        await refreshSources([sourceId]);
    }

    function refreshSources(sourceIds?: readonly string[]): Promise<void> {
        if (!sourceIds) {
            invalidateFullWarm();
            return warmPromise ?? Promise.resolve();
        }
        const ids = new Set(sourceIds);
        if (!ids.size || disposed) return Promise.resolve();
        const generation = workspaceGeneration;
        refreshChain = refreshChain
            .catch(() => undefined)
            .then(async () => {
                if (!bound.size) await startWarm();
                else if (warmPromise) await warmPromise;
                if (disposed || generation !== workspaceGeneration) return;
                const controller = new AbortController();
                const onWarmAbort = () => controller.abort();
                warmAbortController.signal.addEventListener(
                    'abort',
                    onWarmAbort,
                    { once: true }
                );
                try {
                    await reconcileSources(generation, {
                        sourceIds: ids,
                        signal: controller.signal,
                    });
                    if (!controller.signal.aborted) {
                        await runSearch(rawQuery, true);
                    }
                } finally {
                    warmAbortController.signal.removeEventListener(
                        'abort',
                        onWarmAbort
                    );
                }
            });
        return refreshChain;
    }

    return {
        setQuery,
        getSnapshot: () => {
            const parsed = parsePaletteQuery(rawQuery, getPaletteAliasMap());
            return {
                query: rawQuery,
                parsedKind: parsed.kind,
                categoryId:
                    parsed.kind === 'category' ? parsed.categoryId : undefined,
                results,
                statuses,
                workspaceGeneration,
                loading,
            };
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        ensureWarm,
        refreshSources,
        retrySource,
        getResource,
        hydratePreview,
        dispose: () => {
            disposed = true;
            warmAbortController.abort();
            queryAbortController.abort();
            if (debounceTimer) clearTimeout(debounceTimer);
            unsubWorkspace();
            unsubRegistry();
            unsubGate();
            unsubDashboard();
            disposeBoundSources();
            listeners.clear();
            clearResultsSync();
        },
    };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const error = new Error('Palette operation aborted');
    error.name = 'AbortError';
    throw error;
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return operation;
    if (signal.aborted) {
        return Promise.reject(createAbortError());
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(createAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        operation.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}

function createAbortError(): Error {
    const error = new Error('Palette operation aborted');
    error.name = 'AbortError';
    return error;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function commandToResult(command: RegisteredPaletteCommand): PaletteResult {
    return {
        key: `command:${command.id}`,
        sourceId: 'command',
        categoryId: 'command',
        recordId: command.id,
        title: command.label,
        subtitle: command.description,
        icon: command.icon,
        primaryAction: {
            id: `command:${command.id}`,
            label: command.label,
            icon: command.icon,
            closeOnSuccess: command.closeOnSuccess,
            target: {
                kind: 'command',
                commandId: command.id,
                expectedPluginGeneration: command.pluginGeneration,
            },
        },
        secondaryActions: [],
        metadata: {},
    };
}

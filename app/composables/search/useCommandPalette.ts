/**
 * Global command palette state controller.
 *
 * Owns overlay visibility, the flattened active-result index, preview
 * hydration, and action dispatch. State is module-scoped so the shortcut,
 * sidebar affordances, and the overlay all address one palette instance.
 */
import {
    computed,
    ref,
    shallowRef,
    watch,
    type ComputedRef,
    type Ref,
} from 'vue';
import { executePaletteAction } from '~/core/search/command-palette/action-executor';
import type {
    PaletteCoordinator,
    PaletteCoordinatorSnapshot,
} from '~/core/search/command-palette/coordinator';
import { bindPaletteLifecycle } from '~/core/search/command-palette/lifecycle';
import { loadCommandPaletteSearchModule } from '~/core/search/command-palette/prewarm';
import {
    listPaletteCategories,
    listPaletteSources,
} from '~/core/search/command-palette/registry';
import type {
    PaletteAction,
    PaletteCategory,
    PalettePreview,
    PaletteHostContext,
    PaletteResult,
    PaletteSourceStatus,
} from '~/core/search/command-palette/types';

export interface PaletteResultGroup {
    categoryId: string;
    label: string;
    icon?: string;
    results: PaletteResult[];
}

export interface CommandPaletteController {
    isOpen: Readonly<Ref<boolean>>;
    query: Ref<string>;
    loading: Readonly<Ref<boolean>>;
    groups: ComputedRef<PaletteResultGroup[]>;
    flatResults: ComputedRef<PaletteResult[]>;
    activeKey: Readonly<Ref<string | null>>;
    activeResult: ComputedRef<PaletteResult | null>;
    activeCategoryId: ComputedRef<string | undefined>;
    statuses: ComputedRef<PaletteSourceStatus[]>;
    failedStatuses: ComputedRef<PaletteSourceStatus[]>;
    sourceLabels: ComputedRef<Record<string, string>>;
    categories: ComputedRef<PaletteCategory[]>;
    preview: Readonly<Ref<PalettePreview | null>>;
    previewLoading: Readonly<Ref<boolean>>;
    actionTrayOpen: Readonly<Ref<boolean>>;
    secondaryActions: ComputedRef<readonly PaletteAction[]>;
    announcement: Readonly<Ref<string>>;
    errorMessage: Readonly<Ref<string | null>>;
    focusToken: Readonly<Ref<number>>;
    open(): void;
    close(): void;
    toggle(): void;
    setActive(key: string): void;
    activateByPointer(key: string): Promise<void>;
    hoverActive(key: string): void;
    releaseHoverLock(): void;
    moveActive(delta: number): void;
    runPrimary(): Promise<void>;
    runAction(
        action: PaletteAction,
        sourceId?: string,
        expectedPluginGeneration?: number
    ): Promise<void>;
    openActionTray(): boolean;
    closeActionTray(): void;
    setCategoryFilter(categoryId: string | null): void;
    retrySource(sourceId: string): Promise<void>;
    announce(message: string): void;
    warm(): Promise<void>;
    getCoordinator(): PaletteCoordinator | null;
}

const isOpen = ref(false);
const query = ref('');
const loading = ref(false);
const results = shallowRef<PaletteResult[]>([]);
const statuses = shallowRef<PaletteSourceStatus[]>([]);
const parsedCategoryId = ref<string | undefined>(undefined);
const activeKey = ref<string | null>(null);
const preview = shallowRef<PalettePreview | null>(null);
const previewLoading = ref(false);
const actionTrayOpen = ref(false);
const announcement = ref('');
const errorMessage = ref<string | null>(null);
const focusToken = ref(0);
const registryVersion = ref(0);
// Keyboard selection wins until the pointer moves again. A clicked selection
// stays locked until the user explicitly clicks another row, so merely moving
// the cursor cannot replace the preview they chose to inspect.
const hoverLock = ref<'keyboard' | 'pointer' | null>('keyboard');
const pointerArmedKey = ref<string | null>(null);

let coordinator: PaletteCoordinator | null = null;
let coordinatorPromise: Promise<PaletteCoordinator> | null = null;
let unsubscribeSnapshot: (() => void) | null = null;
let unbindLifecycle: (() => void) | null = null;
let hostContext: PaletteHostContext | null = null;
let hostContextOwner: symbol | null = null;
let previousFocus: HTMLElement | null = null;
let previewGeneration = 0;
let openGeneration = 0;
let previewCleanup: (() => void) | null = null;
let previewAbort: AbortController | null = null;

export function setPaletteHostContext(
    context: PaletteHostContext | null
): () => void {
    if (context === null) {
        hostContext = null;
        hostContextOwner = null;
        return () => undefined;
    }
    const owner = Symbol('palette-host-context');
    hostContext = context;
    hostContextOwner = owner;
    return () => {
        if (hostContextOwner !== owner) return;
        hostContext = null;
        hostContextOwner = null;
    };
}

export function getPaletteHostContext(): PaletteHostContext | null {
    return hostContext;
}

/** Re-read registry-derived data (categories) after registrations change. */
export function refreshPaletteRegistrySnapshot(): void {
    registryVersion.value += 1;
}

function applySnapshot(snapshot: PaletteCoordinatorSnapshot): void {
    results.value = snapshot.results;
    statuses.value = snapshot.statuses;
    parsedCategoryId.value = snapshot.categoryId;
    loading.value = snapshot.loading;
    if (
        pointerArmedKey.value &&
        !snapshot.results.some((result) => result.key === pointerArmedKey.value)
    ) {
        pointerArmedKey.value = null;
        if (hoverLock.value === 'pointer') hoverLock.value = 'keyboard';
    }
    reconcileActiveKey();
}

async function ensureCoordinator(): Promise<PaletteCoordinator> {
    if (coordinator) return coordinator;
    if (!coordinatorPromise) {
        coordinatorPromise = (async () => {
            const module = await loadCommandPaletteSearchModule();
            const created = module.createPaletteCoordinator({
                canOpenNewPane: () => hostContext?.canOpenNewPane() ?? false,
            });
            coordinator = created;
            unsubscribeSnapshot = created.subscribe(applySnapshot);
            return created;
        })();
    }
    return coordinatorPromise;
}

/** Release coordinator resources. Used by tests and full teardown. */
export function disposeCommandPalette(): void {
    releasePreview();
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;
    unbindLifecycle?.();
    unbindLifecycle = null;
    coordinator?.dispose();
    coordinator = null;
    coordinatorPromise = null;
    isOpen.value = false;
    openGeneration += 1;
    query.value = '';
    results.value = [];
    statuses.value = [];
    activeKey.value = null;
    hoverLock.value = 'keyboard';
    pointerArmedKey.value = null;
    actionTrayOpen.value = false;
    errorMessage.value = null;
    announcement.value = '';
    previousFocus = null;
}

const groups = computed<PaletteResultGroup[]>(() => {
    void registryVersion.value;
    const categoryById = new Map(
        listPaletteCategories().map((category) => [category.id, category])
    );
    const ordered: PaletteResultGroup[] = [];
    const byCategory = new Map<string, PaletteResultGroup>();
    for (const result of results.value) {
        let group = byCategory.get(result.categoryId);
        if (!group) {
            const category = categoryById.get(result.categoryId);
            group = {
                categoryId: result.categoryId,
                label: category?.label ?? titleize(result.categoryId),
                icon: category?.icon,
                results: [],
            };
            byCategory.set(result.categoryId, group);
            ordered.push(group);
        }
        group.results.push(result);
    }
    return ordered;
});

const flatResults = computed<PaletteResult[]>(() =>
    groups.value.flatMap((group) => group.results)
);

const activeResult = computed<PaletteResult | null>(() => {
    const key = activeKey.value;
    if (!key) return null;
    return flatResults.value.find((result) => result.key === key) ?? null;
});

const secondaryActions = computed<readonly PaletteAction[]>(
    () => activeResult.value?.secondaryActions ?? []
);

const failedStatuses = computed(() =>
    statuses.value.filter((status) => status.state === 'error')
);

const categories = computed<PaletteCategory[]>(() => {
    void registryVersion.value;
    return listPaletteCategories();
});

/** Source id -> human label, used for indexing and failure notices. */
const sourceLabels = computed<Record<string, string>>(() => {
    void registryVersion.value;
    const labels: Record<string, string> = {};
    for (const source of listPaletteSources()) labels[source.id] = source.label;
    return labels;
});

// Live-region copy. Announcements never move focus; they only describe changes
// the user cannot see (result counts, loading, source failures).
watch(
    () => [isOpen.value, loading.value, flatResults.value.length] as const,
    ([open_, isLoading, count]) => {
        if (!open_) return;
        if (isLoading) {
            announcement.value = 'Searching…';
            return;
        }
        announcement.value =
            count === 0
                ? 'No results'
                : `${count} result${count === 1 ? '' : 's'} available`;
    }
);

watch(failedStatuses, (failed) => {
    if (!isOpen.value || !failed.length) return;
    announcement.value = `${failed.length} search source${
        failed.length === 1 ? '' : 's'
    } unavailable`;
});

function isSelectable(result: PaletteResult): boolean {
    return !result.primaryAction.disabled;
}

function reconcileActiveKey(): void {
    const list = flatResults.value;
    if (!list.length) {
        if (activeKey.value !== null) setActiveKey(null);
        return;
    }
    if (activeKey.value && list.some((r) => r.key === activeKey.value)) return;
    const first = list.find(isSelectable) ?? list[0];
    setActiveKey(first ? first.key : null);
}

function setActiveKey(key: string | null): void {
    if (activeKey.value === key) return;
    activeKey.value = key;
    actionTrayOpen.value = false;
    void hydrateActivePreview();
}

function releasePreview(): void {
    previewGeneration += 1;
    previewAbort?.abort();
    previewAbort = null;
    previewCleanup?.();
    previewCleanup = null;
    preview.value = null;
    previewLoading.value = false;
}

async function hydrateActivePreview(): Promise<void> {
    releasePreview();
    const result = activeResult.value;
    if (!result || !coordinator) return;

    const generation = previewGeneration;
    const controller =
        typeof AbortController === 'function' ? new AbortController() : null;
    previewAbort = controller;
    previewLoading.value = true;

    try {
        const hydrated = await coordinator.hydratePreview(result, {
            signal: controller?.signal,
        });
        if (generation !== previewGeneration) {
            hydrated.cleanup?.();
            return;
        }
        preview.value = hydrated;
        previewCleanup = hydrated.cleanup ?? null;
    } catch {
        if (generation !== previewGeneration) return;
        preview.value = {
            title: result.title,
            categoryId: result.categoryId,
            unavailable: true,
        };
    } finally {
        if (generation === previewGeneration) previewLoading.value = false;
    }
}

function open(): void {
    if (isOpen.value) {
        focusToken.value += 1;
        return;
    }
    if (typeof document !== 'undefined') {
        const active = document.activeElement;
        previousFocus = active instanceof HTMLElement ? active : null;
    }
    isOpen.value = true;
    const generation = ++openGeneration;
    errorMessage.value = null;
    focusToken.value += 1;
    hoverLock.value = 'keyboard';
    pointerArmedKey.value = null;
    void (async () => {
        const wasAlreadyCreated = Boolean(coordinator || coordinatorPromise);
        const instance = await ensureCoordinator();
        if (generation !== openGeneration) return;
        if (!unbindLifecycle) {
            try {
                unbindLifecycle = bindPaletteLifecycle(instance);
            } catch {
                // Hook engine unavailable (e.g. tests); incremental updates are optional.
            }
        }
        if (wasAlreadyCreated) {
            await instance.refreshSources();
        } else {
            await instance.ensureWarm();
        }
        if (generation !== openGeneration) return;
        applySnapshot(instance.getSnapshot());
        instance.setQuery(query.value);
    })();
}

function close(): void {
    if (!isOpen.value) return;
    isOpen.value = false;
    openGeneration += 1;
    unbindLifecycle?.();
    unbindLifecycle = null;
    query.value = '';
    coordinator?.setQuery('');
    actionTrayOpen.value = false;
    hoverLock.value = 'keyboard';
    pointerArmedKey.value = null;
    errorMessage.value = null;
    releasePreview();
    const target = previousFocus;
    previousFocus = null;
    if (target?.isConnected) {
        try {
            target.focus();
        } catch {
            // Restoring focus is best-effort.
        }
    }
}

function setQuery(next: string): void {
    query.value = next;
    errorMessage.value = null;
    // New results should follow the query, not wherever the cursor happens to rest.
    hoverLock.value = 'keyboard';
    pointerArmedKey.value = null;
    void (async () => {
        const instance = coordinator ?? (await ensureCoordinator());
        instance.setQuery(next);
    })();
}

/** Pointer-driven selection: ignored while a keyboard selection holds the lock. */
function hoverActive(key: string): void {
    if (hoverLock.value || actionTrayOpen.value) return;
    setActiveKey(key);
}

function moveActive(delta: number): void {
    hoverLock.value = 'keyboard';
    pointerArmedKey.value = null;
    const list = flatResults.value;
    if (!list.length) return;
    const selectable = list.filter(isSelectable);
    if (!selectable.length) return;

    const currentIndex = selectable.findIndex((r) => r.key === activeKey.value);
    const nextIndex =
        currentIndex < 0
            ? delta > 0
                ? 0
                : selectable.length - 1
            : (currentIndex + delta + selectable.length) % selectable.length;
    const next = selectable[nextIndex];
    if (next) setActiveKey(next.key);
}

async function runAction(
    action: PaletteAction,
    sourceId?: string,
    expectedPluginGeneration?: number
): Promise<void> {
    if (!hostContext) {
        errorMessage.value = 'Navigation is unavailable right now.';
        return;
    }
    const result = await executePaletteAction({
        host: hostContext,
        action,
        sourceId,
        expectedPluginGeneration,
    });
    if (result.ok) {
        errorMessage.value = null;
        const shouldClose =
            action.closeOnSuccess !== false && result.closeOnSuccess !== false;
        if (shouldClose) close();
        return;
    }
    errorMessage.value = result.error.message;
    announcement.value = `Action failed: ${result.error.message}`;
    if (
        result.error.code === 'not-found' ||
        result.error.code === 'forbidden' ||
        result.error.code === 'stale-plugin'
    ) {
        void coordinator?.ensureWarm();
    }
}

async function runPrimary(): Promise<void> {
    const result = activeResult.value;
    if (!result) return;
    await runAction(
        result.primaryAction,
        result.sourceId,
        result.pluginGeneration
    );
}

/**
 * Pointer activation is deliberately two-stage. The first click selects and
 * locks the preview, even when search already made that row active. A second
 * click on the same still-active row executes its primary action.
 */
async function activateByPointer(key: string): Promise<void> {
    if (pointerArmedKey.value === key && activeKey.value === key) {
        await runPrimary();
        return;
    }
    pointerArmedKey.value = key;
    hoverLock.value = 'pointer';
    setActiveKey(key);
}

function openActionTray(): boolean {
    const actions = secondaryActions.value;
    const hasEnabled = actions.some((action) => !action.disabled);
    if (!hasEnabled) {
        announcement.value = 'No additional actions available';
        actionTrayOpen.value = false;
        return false;
    }
    actionTrayOpen.value = true;
    return true;
}

function setCategoryFilter(categoryId: string | null): void {
    const parsed = stripCategoryPrefix(query.value);
    if (!categoryId) {
        setQuery(parsed.term);
        return;
    }
    const category = categories.value.find((entry) => entry.id === categoryId);
    const alias = category?.aliases[0] ?? categoryId;
    setQuery(parsed.term ? `${alias}: ${parsed.term}` : `${alias}: `);
    focusToken.value += 1;
}

function stripCategoryPrefix(raw: string): { term: string } {
    const colonIndex = raw.indexOf(':');
    if (colonIndex <= 0) return { term: raw.trim() };
    const alias = raw.slice(0, colonIndex).trim().toLowerCase();
    const known = categories.value.some((category) =>
        category.aliases.includes(alias)
    );
    return { term: known ? raw.slice(colonIndex + 1).trim() : raw.trim() };
}

function titleize(value: string): string {
    if (!value) return 'Results';
    return value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
}

export function useCommandPalette(): CommandPaletteController {
    return {
        isOpen,
        query: computed({ get: () => query.value, set: setQuery }),
        loading,
        groups,
        flatResults,
        activeKey,
        activeResult,
        activeCategoryId: computed(() => parsedCategoryId.value),
        statuses: computed(() => statuses.value),
        failedStatuses,
        sourceLabels,
        categories,
        preview,
        previewLoading,
        actionTrayOpen,
        secondaryActions,
        announcement,
        errorMessage,
        focusToken,
        open,
        close,
        toggle: () => (isOpen.value ? close() : open()),
        setActive: (key: string) => {
            hoverLock.value = 'keyboard';
            pointerArmedKey.value = null;
            setActiveKey(key);
        },
        activateByPointer,
        hoverActive,
        releaseHoverLock: () => {
            if (hoverLock.value === 'keyboard') hoverLock.value = null;
        },
        moveActive,
        runPrimary,
        runAction,
        openActionTray,
        closeActionTray: () => {
            actionTrayOpen.value = false;
        },
        setCategoryFilter,
        retrySource: async (sourceId: string) => {
            await coordinator?.retrySource(sourceId);
        },
        announce: (message: string) => {
            announcement.value = message;
        },
        warm: async () => {
            const instance = await ensureCoordinator();
            await instance.ensureWarm();
        },
        getCoordinator: () => coordinator,
    };
}

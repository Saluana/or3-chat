import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type {
    PaletteCoordinator,
    PaletteCoordinatorSnapshot,
} from '~/core/search/command-palette/coordinator';
import type {
    PaletteAction,
    PalettePreview,
    PaletteResult,
} from '~/core/search/command-palette/types';

const executePaletteAction = vi.fn();
const hydratePreview = vi.fn();
const setQuery = vi.fn();
const retrySource = vi.fn();

let snapshot: PaletteCoordinatorSnapshot;
let listeners: ((snapshot: PaletteCoordinatorSnapshot) => void)[] = [];

function emitSnapshot(next: Partial<PaletteCoordinatorSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener(snapshot);
}

const coordinator: PaletteCoordinator = {
    setQuery,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter((entry) => entry !== listener);
        };
    },
    ensureWarm: vi.fn(async () => {}),
    refreshSources: vi.fn(async () => {}),
    retrySource,
    getResource: vi.fn(),
    hydratePreview,
    dispose: vi.fn(),
};

vi.mock('~/core/search/command-palette/prewarm', () => ({
    loadCommandPaletteSearchModule: async () => ({
        createPaletteCoordinator: () => coordinator,
    }),
    scheduleCommandPalettePrewarm: vi.fn(),
}));

vi.mock('~/core/search/command-palette/lifecycle', () => ({
    bindPaletteLifecycle: () => () => {},
}));

vi.mock('~/core/search/command-palette/registry', () => ({
    listPaletteCategories: () => [
        { id: 'chat', label: 'Chats', aliases: ['chat'], order: 10 },
        { id: 'command', label: 'Commands', aliases: ['cmd'], order: 20 },
    ],
    listPaletteSources: () => [
        { id: 'chat', label: 'Chats' },
        { id: 'command', label: 'Commands' },
    ],
}));

vi.mock('~/core/search/command-palette/action-executor', () => ({
    executePaletteAction: (...args: unknown[]) => executePaletteAction(...args),
}));

const {
    disposeCommandPalette,
    getPaletteHostContext,
    setPaletteHostContext,
    useCommandPalette,
} = await import('../useCommandPalette');

function action(overrides: Partial<PaletteAction> = {}): PaletteAction {
    return {
        id: 'open',
        label: 'Open',
        kind: 'open-chat',
        payload: { threadId: 't1' },
        ...overrides,
    } as PaletteAction;
}

function result(overrides: Partial<PaletteResult> = {}): PaletteResult {
    return {
        key: 'chat:t1',
        sourceId: 'chat',
        categoryId: 'chat',
        recordId: 't1',
        title: 'Thread one',
        primaryAction: action(),
        secondaryActions: [],
        metadata: {},
        ...overrides,
    } as PaletteResult;
}

const host = {
    canOpenNewPane: () => true,
} as never;

describe('useCommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listeners = [];
        snapshot = {
            query: '',
            parsedKind: 'all',
            results: [],
            statuses: [],
            workspaceGeneration: 1,
            loading: false,
        };
        hydratePreview.mockResolvedValue({
            title: 'Thread one',
            categoryId: 'chat',
        } satisfies PalettePreview);
        executePaletteAction.mockResolvedValue({ ok: true });
        disposeCommandPalette();
        setPaletteHostContext(host);
    });

    it('opens, refocuses on repeat, and restores focus on close', async () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();

        const palette = useCommandPalette();
        palette.open();
        await nextTick();

        expect(palette.isOpen.value).toBe(true);
        const firstToken = palette.focusToken.value;

        palette.open();
        expect(palette.focusToken.value).toBe(firstToken + 1);

        palette.close();
        expect(palette.isOpen.value).toBe(false);
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('clears transient state on close', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        palette.query.value = 'chat: hello';
        palette.close();

        expect(palette.query.value).toBe('');
        expect(palette.actionTrayOpen.value).toBe(false);
        expect(palette.errorMessage.value).toBeNull();
    });

    it('releases the search indexes after the palette stays closed', async () => {
        vi.useFakeTimers();
        try {
            const palette = useCommandPalette();
            palette.open();
            await Promise.resolve();
            vi.mocked(coordinator.dispose).mockClear();

            palette.close();
            await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

            expect(coordinator.dispose).toHaveBeenCalledTimes(1);
            expect(palette.getCoordinator()).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('groups results and selects the first selectable row', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();

        emitSnapshot({
            results: [
                result({
                    key: 'chat:a',
                    primaryAction: action({ disabled: true }),
                }),
                result({ key: 'chat:b' }),
                result({
                    key: 'command:c',
                    categoryId: 'command',
                    sourceId: 'command',
                }),
            ],
        });
        await nextTick();

        expect(palette.groups.value.map((group) => group.label)).toEqual([
            'Chats',
            'Commands',
        ]);
        expect(palette.activeKey.value).toBe('chat:b');
    });

    it('wraps arrow navigation across groups and skips disabled rows', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [
                result({ key: 'chat:a' }),
                result({
                    key: 'chat:disabled',
                    primaryAction: action({ disabled: true }),
                }),
                result({
                    key: 'command:c',
                    categoryId: 'command',
                    sourceId: 'command',
                }),
            ],
        });
        await nextTick();

        expect(palette.activeKey.value).toBe('chat:a');
        palette.moveActive(1);
        expect(palette.activeKey.value).toBe('command:c');
        palette.moveActive(1);
        expect(palette.activeKey.value).toBe('chat:a');
        palette.moveActive(-1);
        expect(palette.activeKey.value).toBe('command:c');
    });

    it('ignores hover selection until the pointer moves after keyboard navigation', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [result({ key: 'chat:a' }), result({ key: 'chat:b' })],
        });
        await nextTick();

        // A cursor resting over another row must not steal the selection.
        palette.hoverActive('chat:b');
        expect(palette.activeKey.value).toBe('chat:a');

        palette.releaseHoverLock();
        palette.hoverActive('chat:b');
        expect(palette.activeKey.value).toBe('chat:b');

        // Arrow keys re-lock so the pointer has to move again.
        palette.moveActive(-1);
        palette.hoverActive('chat:b');
        expect(palette.activeKey.value).toBe('chat:a');
    });

    it('ignores hover selection while the action tray is open', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [
                result({
                    key: 'chat:a',
                    secondaryActions: [action({ id: 'pane', label: 'New pane' })],
                }),
                result({ key: 'chat:b' }),
            ],
        });
        await nextTick();

        palette.releaseHoverLock();
        expect(palette.openActionTray()).toBe(true);
        palette.hoverActive('chat:b');
        expect(palette.activeKey.value).toBe('chat:a');
    });

    it('selects and preview-locks on the first click, then executes on the second', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [result({ key: 'chat:a' }), result({ key: 'chat:b' })],
        });
        await nextTick();

        // Search already made the first row active; its first click must still
        // only arm it rather than execute.
        await palette.activateByPointer('chat:a');
        expect(executePaletteAction).not.toHaveBeenCalled();

        palette.releaseHoverLock();
        palette.hoverActive('chat:b');
        expect(palette.activeKey.value).toBe('chat:a');

        await palette.activateByPointer('chat:a');
        expect(executePaletteAction).toHaveBeenCalledTimes(1);
        expect(palette.isOpen.value).toBe(false);
    });

    it('requires a fresh first click after pointer selection changes', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [result({ key: 'chat:a' }), result({ key: 'chat:b' })],
        });
        await nextTick();

        await palette.activateByPointer('chat:a');
        await palette.activateByPointer('chat:b');

        expect(palette.activeKey.value).toBe('chat:b');
        expect(executePaletteAction).not.toHaveBeenCalled();

        await palette.activateByPointer('chat:b');
        expect(executePaletteAction).toHaveBeenCalledTimes(1);
    });

    it('hydrates a preview for the active result without navigating', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();
        await Promise.resolve();
        await Promise.resolve();

        expect(hydratePreview).toHaveBeenCalledTimes(1);
        expect(palette.preview.value?.title).toBe('Thread one');
        expect(executePaletteAction).not.toHaveBeenCalled();
    });

    it('releases image object URLs when the selection changes and on close', async () => {
        const cleanup = vi.fn();
        hydratePreview.mockResolvedValue({
            title: 'Image',
            categoryId: 'image',
            imageObjectUrl: 'blob:one',
            cleanup,
        } satisfies PalettePreview);

        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [result({ key: 'chat:a' }), result({ key: 'chat:b' })],
        });
        await nextTick();
        await Promise.resolve();
        await Promise.resolve();
        expect(palette.preview.value?.imageObjectUrl).toBe('blob:one');

        palette.setActive('chat:b');
        expect(cleanup).toHaveBeenCalledTimes(1);

        await Promise.resolve();
        await Promise.resolve();
        palette.close();
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(palette.preview.value).toBeNull();
    });

    it('falls back to an unavailable preview when hydration fails', async () => {
        hydratePreview.mockRejectedValue(new Error('gone'));
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();
        await Promise.resolve();
        await Promise.resolve();

        expect(palette.preview.value?.unavailable).toBe(true);
        expect(palette.previewLoading.value).toBe(false);
    });

    it('closes after a successful action but stays open on failure', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();

        await palette.runPrimary();
        expect(palette.isOpen.value).toBe(false);

        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();
        executePaletteAction.mockResolvedValueOnce({
            ok: false,
            error: { code: 'navigation-failed', message: 'Nope' },
        });
        await palette.runPrimary();

        expect(palette.isOpen.value).toBe(true);
        expect(palette.errorMessage.value).toBe('Nope');
        expect(palette.activeKey.value).toBe('chat:a');
    });

    it('respects closeOnSuccess: false', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [
                result({
                    key: 'chat:a',
                    primaryAction: action({ closeOnSuccess: false }),
                }),
            ],
        });
        await nextTick();

        await palette.runPrimary();
        expect(palette.isOpen.value).toBe(true);
    });

    it('announces when the active result has no secondary actions', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();

        expect(palette.openActionTray()).toBe(false);
        expect(palette.announcement.value).toBe('No additional actions available');
        expect(palette.actionTrayOpen.value).toBe(false);
    });

    it('opens the tray when an enabled secondary action exists', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            results: [
                result({
                    key: 'chat:a',
                    secondaryActions: [action({ id: 'new-pane', label: 'New pane' })],
                }),
            ],
        });
        await nextTick();

        expect(palette.openActionTray()).toBe(true);
        expect(palette.actionTrayOpen.value).toBe(true);
    });

    it('writes a category alias prefix when filtering', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        palette.query.value = 'hello';
        palette.setCategoryFilter('chat');

        expect(palette.query.value).toBe('chat: hello');

        palette.setCategoryFilter(null);
        expect(palette.query.value).toBe('hello');
    });

    it('surfaces failed sources and retries them on request', async () => {
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({
            statuses: [
                { sourceId: 'chat', state: 'error', error: 'boom' } as never,
            ],
        });
        await nextTick();

        expect(palette.failedStatuses.value).toHaveLength(1);
        expect(palette.sourceLabels.value.chat).toBe('Chats');

        await palette.retrySource('chat');
        expect(retrySource).toHaveBeenCalledWith('chat');
    });

    it('reports a recoverable error when no host context is wired', async () => {
        setPaletteHostContext(null);
        const palette = useCommandPalette();
        palette.open();
        await Promise.resolve();
        emitSnapshot({ results: [result({ key: 'chat:a' })] });
        await nextTick();

        await palette.runPrimary();
        expect(palette.isOpen.value).toBe(true);
        expect(palette.errorMessage.value).toBe(
            'Navigation is unavailable right now.'
        );
    });

    it('does not let an older shell disposer clear a newer host context', () => {
        const older = { canOpenNewPane: () => false } as never;
        const newer = { canOpenNewPane: () => true } as never;
        const disposeOlder = setPaletteHostContext(older);
        const disposeNewer = setPaletteHostContext(newer);

        disposeOlder();
        expect(getPaletteHostContext()).toBe(newer);
        disposeNewer();
        expect(getPaletteHostContext()).toBeNull();
    });
});

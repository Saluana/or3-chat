import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Store original require/import
let originalDb: any;

beforeEach(async () => {
    // Mock db module
    vi.doMock('~/db', () => ({
        db: {
            messages: {
                where: () => ({
                    between: () => ({
                        filter: () => ({
                            toArray: async () => [],
                        }),
                    }),
                }),
            },
        },
    }));

    // Mock hooks
    vi.doMock('../../core/hooks/useHooks', () => ({
        useHooks: () => ({
            doAction: vi.fn(),
            applyFilters: vi.fn((name: string, value: any) =>
                Promise.resolve(value)
            ),
        }),
    }));
});

afterEach(() => {
    vi.doUnmock('~/db');
    vi.doUnmock('../../core/hooks/useHooks');
});

describe('useMultiPane - newPaneForApp', () => {
    beforeEach(() => {
        // Clean up registries
        const g = globalThis as any;
        g.__or3PaneAppsRegistry = new Map();
        g.__or3MultiPaneApi = undefined;
    });

    it('creates a new pane for a registered app', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'todo',
            label: 'Todo App',
            component: { name: 'TodoPane', template: '<div>todo</div>' },
        });

        const multiPane = useMultiPane({ maxPanes: 3 });
        const initialLength = multiPane.panes.value.length;

        await multiPane.newPaneForApp('todo');

        expect(multiPane.panes.value.length).toBe(initialLength + 1);
        const newPane = multiPane.panes.value[multiPane.panes.value.length - 1];
        expect(newPane?.mode).toBe('todo');
        expect(newPane?.threadId).toBe('');
        expect(newPane?.documentId).toBeUndefined();
    });

    it('calls createInitialRecord and assigns documentId', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');

        const mockCreateRecord = vi.fn(async () => ({ id: 'record-123' }));
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'notes',
            label: 'Notes',
            component: { name: 'NotesPane', template: '<div>notes</div>' },
            createInitialRecord: mockCreateRecord,
        });

        const multiPane = useMultiPane();
        await multiPane.newPaneForApp('notes');

        expect(mockCreateRecord).toHaveBeenCalledTimes(1);
        const newPane = multiPane.panes.value[multiPane.panes.value.length - 1];
        expect(newPane?.documentId).toBe('record-123');
    });

    it('uses initialRecordId when provided and skips createInitialRecord', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');

        const mockCreateRecord = vi.fn(async () => ({ id: 'should-not-use' }));
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'crm',
            label: 'CRM',
            component: { name: 'CrmPane', template: '<div>crm</div>' },
            createInitialRecord: mockCreateRecord,
        });

        const multiPane = useMultiPane();
        await multiPane.newPaneForApp('crm', {
            initialRecordId: 'existing-123',
        });

        expect(mockCreateRecord).not.toHaveBeenCalled();
        const newPane = multiPane.panes.value[multiPane.panes.value.length - 1];
        expect(newPane?.documentId).toBe('existing-123');
    });

    it('does not create pane when limit reached', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'kanban',
            label: 'Kanban',
            component: { name: 'KanbanPane', template: '<div>kanban</div>' },
        });

        const multiPane = useMultiPane({ maxPanes: 2 });

        // Add one more pane to reach limit (starts with 1)
        multiPane.addPane();

        expect(multiPane.panes.value.length).toBe(2);
        expect(multiPane.canAddPane.value).toBe(false);

        await multiPane.newPaneForApp('kanban');

        // Should still be 2
        expect(multiPane.panes.value.length).toBe(2);
    });

    it('does not create pane for unregistered app', async () => {
        const { useMultiPane } = await import('../useMultiPane');

        const multiPane = useMultiPane();
        const initialLength = multiPane.panes.value.length;

        await multiPane.newPaneForApp('nonexistent-app');

        expect(multiPane.panes.value.length).toBe(initialLength);
    });

    it('aborts pane creation when createInitialRecord throws', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');

        const mockCreateRecord = vi.fn(async () => {
            throw new Error('Database error');
        });
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'failing-app',
            label: 'Failing App',
            component: { name: 'FailingPane', template: '<div>fail</div>' },
            createInitialRecord: mockCreateRecord,
        });

        const multiPane = useMultiPane();
        const initialLength = multiPane.panes.value.length;

        await multiPane.newPaneForApp('failing-app');

        // Should not create pane on error
        expect(multiPane.panes.value.length).toBe(initialLength);
        expect(mockCreateRecord).toHaveBeenCalledTimes(1);
    });

    it('activates the newly created pane', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'calendar',
            label: 'Calendar',
            component: {
                name: 'CalendarPane',
                template: '<div>calendar</div>',
            },
        });

        const multiPane = useMultiPane();
        const initialIndex = multiPane.activePaneIndex.value;

        await multiPane.newPaneForApp('calendar');

        const newIndex = multiPane.panes.value.length - 1;
        expect(multiPane.activePaneIndex.value).toBe(newIndex);
        expect(multiPane.activePaneIndex.value).not.toBe(initialIndex);
    });

    it('handles createInitialRecord returning null', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');

        const mockCreateRecord = vi.fn(async () => null);
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'optional-record',
            label: 'Optional',
            component: {
                name: 'OptionalPane',
                template: '<div>optional</div>',
            },
            createInitialRecord: mockCreateRecord,
        });

        const multiPane = useMultiPane();
        const initialLength = multiPane.panes.value.length;

        await multiPane.newPaneForApp('optional-record');

        // Pane should still be created
        expect(multiPane.panes.value.length).toBe(initialLength + 1);
        const newPane = multiPane.panes.value[multiPane.panes.value.length - 1];
        expect(newPane?.documentId).toBeUndefined();
        expect(mockCreateRecord).toHaveBeenCalledTimes(1);
    });

    it('passes app definition to createInitialRecord', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');

        let capturedContext: any;
        const mockCreateRecord = vi.fn(async (ctx) => {
            capturedContext = ctx;
            return { id: 'test-id' };
        });
        const { registerPaneApp } = usePaneApps();

        const appDef = {
            id: 'test-app',
            label: 'Test App',
            component: { name: 'TestPane', template: '<div>test</div>' },
            postType: 'custom_post',
            createInitialRecord: mockCreateRecord,
        };

        registerPaneApp(appDef);

        const multiPane = useMultiPane();
        await multiPane.newPaneForApp('test-app');

        expect(capturedContext).toBeDefined();
        expect(capturedContext.app).toBeDefined();
        expect(capturedContext.app.id).toBe('test-app');
        expect(capturedContext.app.postType).toBe('custom_post');
    });

    it('assigns unique id to each pane', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const { usePaneApps } = await import('../usePaneApps');
        const { registerPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'multi',
            label: 'Multi',
            component: { name: 'MultiPane', template: '<div>multi</div>' },
        });

        const multiPane = useMultiPane({ maxPanes: 5 });

        await multiPane.newPaneForApp('multi');
        await multiPane.newPaneForApp('multi');

        const ids = multiPane.panes.value.map((p) => p.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });
});

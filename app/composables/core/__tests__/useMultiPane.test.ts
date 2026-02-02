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

describe('useMultiPane - paneWidths normalization', () => {
    beforeEach(() => {
        // Clean up registries and localStorage
        const g = globalThis as any;
        g.__or3PaneAppsRegistry = new Map();
        g.__or3MultiPaneApi = undefined;
        localStorage.clear();
    });

    it('truncates stored widths when closing panes', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        
        const multiPane = useMultiPane({ 
            maxPanes: 5,
            storageKey: 'test-widths-close'
        });

        // Add multiple panes first
        multiPane.addPane();
        multiPane.addPane();
        multiPane.addPane();
        multiPane.addPane();
        
        const paneCountBefore = multiPane.panes.value.length; // Should be 5
        
        // Ensure widths are set
        if (multiPane.paneWidths.value.length === 0) {
            multiPane.paneWidths.value = Array(paneCountBefore).fill(300);
        }
        
        // Close a pane
        await multiPane.closePane(0);
        
        const paneCountAfter = multiPane.panes.value.length;
        
        // Widths should be truncated to match remaining panes
        expect(multiPane.paneWidths.value.length).toBeLessThanOrEqual(paneCountAfter);
    });

    it('normalizes widths when panes are added', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        
        const multiPane = useMultiPane({ 
            maxPanes: 5,
            storageKey: 'test-widths-add'
        });

        // Start with 1 pane, add more
        const initialCount = multiPane.panes.value.length;
        
        multiPane.addPane();
        multiPane.addPane();
        
        const finalCount = multiPane.panes.value.length;
        
        // Widths should not exceed pane count
        expect(multiPane.paneWidths.value.length).toBeLessThanOrEqual(finalCount);
    });

    it('handles getPaneWidth with orphaned widths gracefully', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        
        const multiPane = useMultiPane({ 
            maxPanes: 5,
            storageKey: 'test-widths-get'
        });

        // Simulate orphaned widths (more stored than actual panes)
        multiPane.paneWidths.value = [400, 400, 400, 400, 400];
        
        // With only 1 pane, getPaneWidth should not crash
        const width = multiPane.getPaneWidth(0);
        
        expect(width).toBeDefined();
        // Should fall back to 100% for single pane
        expect(width).toBe('100%');
    });

    it('truncates widths array when longer than pane count', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        
        const multiPane = useMultiPane({ 
            maxPanes: 5,
            storageKey: 'test-widths-truncate'
        });

        // Set up 3 panes
        multiPane.addPane();
        multiPane.addPane();
        
        const paneCount = multiPane.panes.value.length; // Should be 3
        
        // Manually inject extra widths
        multiPane.paneWidths.value = [300, 300, 300, 300, 300];
        
        // Trigger normalization via getPaneWidth
        multiPane.getPaneWidth(0);
        
        // Widths should now match pane count
        expect(multiPane.paneWidths.value.length).toBe(paneCount);
    });
});

describe('useMultiPane - message loading with validation', () => {
    beforeEach(() => {
        // Clean up registries
        const g = globalThis as any;
        g.__or3PaneAppsRegistry = new Map();
        g.__or3MultiPaneApi = undefined;
        // Reset modules to ensure fresh imports
        vi.resetModules();
    });

    it('skips invalid message rows without crashing', async () => {
        // Mock db with mixed valid/invalid messages
        vi.doMock('~/db', () => ({
            db: {
                messages: {
                    where: () => ({
                        between: () => ({
                            filter: () => ({
                                toArray: async () => [
                                    // Valid message
                                    {
                                        id: 'msg-1',
                                        role: 'user',
                                        content: 'Hello',
                                        deleted: false,
                                        index: 0,
                                    },
                                    // Invalid - no id
                                    {
                                        role: 'assistant',
                                        content: 'Hi',
                                        deleted: false,
                                    },
                                    // Invalid - no role
                                    {
                                        id: 'msg-3',
                                        content: 'Test',
                                        deleted: false,
                                    },
                                    // Valid message
                                    {
                                        id: 'msg-4',
                                        role: 'assistant',
                                        content: 'Valid response',
                                        deleted: false,
                                        index: 1,
                                    },
                                ],
                            }),
                        }),
                    }),
                },
            },
        }));

        // Re-import to get the mocked version
        const { useMultiPane } = await import('../useMultiPane');
        const multiPane = useMultiPane();

        // Load messages for a thread
        const messages = await multiPane.loadMessagesFor('thread-123');

        // Should only include the 2 valid messages
        expect(messages).toHaveLength(2);
        expect(messages[0]?.id).toBe('msg-1');
        expect(messages[1]?.id).toBe('msg-4');
    });

    it('skips deleted messages even if they pass initial filter', async () => {
        vi.doMock('~/db', () => ({
            db: {
                messages: {
                    where: () => ({
                        between: () => ({
                            filter: () => ({
                                toArray: async () => [
                                    {
                                        id: 'msg-1',
                                        role: 'user',
                                        content: 'Hello',
                                        deleted: false,
                                    },
                                    {
                                        id: 'msg-2',
                                        role: 'assistant',
                                        content: 'Response',
                                        deleted: true, // Should be skipped
                                    },
                                ],
                            }),
                        }),
                    }),
                },
            },
        }));

        const { useMultiPane } = await import('../useMultiPane');
        const multiPane = useMultiPane();

        const messages = await multiPane.loadMessagesFor('thread-456');

        expect(messages).toHaveLength(1);
        expect(messages[0]?.id).toBe('msg-1');
    });

    it('handles completely invalid data without crashing', async () => {
        vi.doMock('~/db', () => ({
            db: {
                messages: {
                    where: () => ({
                        between: () => ({
                            filter: () => ({
                                toArray: async () => [
                                    null,
                                    undefined,
                                    'not an object',
                                    123,
                                    { random: 'data' },
                                ],
                            }),
                        }),
                    }),
                },
            },
        }));

        const { useMultiPane } = await import('../useMultiPane');
        const multiPane = useMultiPane();

        const messages = await multiPane.loadMessagesFor('thread-789');

        // All invalid, should return empty array
        expect(messages).toHaveLength(0);
    });
});

describe('useMultiPane - pane prompt cleanup', () => {
    beforeEach(() => {
        // Clean up registries
        const g = globalThis as any;
        g.__or3PaneAppsRegistry = new Map();
        g.__or3MultiPaneApi = undefined;
        // Reset modules
        vi.resetModules();
    });

    it('clears pending prompt when pane is closed', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const {
            setPanePendingPrompt,
            getPanePendingPrompt,
            setupPanePromptCleanup,
        } = await import('../usePanePrompt');

        // Manually setup cleanup in test environment
        setupPanePromptCleanup();

        const multiPane = useMultiPane({ maxPanes: 3 });

        // Add a pane
        multiPane.addPane();
        const paneId = multiPane.panes.value[1]?.id;

        expect(paneId).toBeDefined();

        // Set a pending prompt for that pane
        setPanePendingPrompt(paneId!, 'prompt-123');

        // Verify it's set
        expect(getPanePendingPrompt(paneId!)).toBe('prompt-123');

        // Close the pane
        await multiPane.closePane(1);

        // Pending prompt should be cleared automatically
        expect(getPanePendingPrompt(paneId!)).toBeUndefined();
    });

    it('does not clear prompts for other panes when one closes', async () => {
        const { useMultiPane } = await import('../useMultiPane');
        const {
            setPanePendingPrompt,
            getPanePendingPrompt,
            setupPanePromptCleanup,
        } = await import('../usePanePrompt');

        // Setup cleanup
        setupPanePromptCleanup();

        const multiPane = useMultiPane({ maxPanes: 5 });

        // Add two panes
        multiPane.addPane();
        multiPane.addPane();

        const pane1Id = multiPane.panes.value[1]?.id;
        const pane2Id = multiPane.panes.value[2]?.id;

        // Set pending prompts for both
        setPanePendingPrompt(pane1Id!, 'prompt-1');
        setPanePendingPrompt(pane2Id!, 'prompt-2');

        // Close first added pane
        await multiPane.closePane(1);

        // First pane's prompt should be cleared
        expect(getPanePendingPrompt(pane1Id!)).toBeUndefined();

        // Second pane's prompt should remain
        expect(getPanePendingPrompt(pane2Id!)).toBe('prompt-2');
    });
});

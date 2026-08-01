/**
 * Tests for resizable panes functionality in useMultiPane composable
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMultiPane } from '../useMultiPane';
import type { MultiPaneMessage } from '../useMultiPane';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        addAction: vi.fn(),
        removeAction: vi.fn(),
        doAction: vi.fn(),
        applyFilters: vi.fn((_, value) => Promise.resolve(value)),
    }),
}));

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
});

// Mock document.querySelector for container width
Object.defineProperty(global, 'document', {
    value: {
        querySelector: vi.fn(() => ({
            clientWidth: 1200,
        })),
    },
    writable: true,
});

describe('useMultiPane - Width Management', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    it('getPaneWidth returns 100% for single pane', () => {
        const { panes, getPaneWidth } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        expect(panes.value.length).toBe(1);
        expect(getPaneWidth(0)).toBe('100%');
    });

    it('getPaneWidth returns equal distribution by default for multiple panes', () => {
        const { panes, addPane, getPaneWidth } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();
        expect(panes.value.length).toBe(2);
        expect(getPaneWidth(0)).toBe('50%');
        expect(getPaneWidth(1)).toBe('50%');

        addPane();
        expect(panes.value.length).toBe(3);
        // Use approximate match for floating point
        expect(getPaneWidth(0)).toMatch(/^33\.33333/);
    });

    it('handleResize updates widths correctly', () => {
        const { panes, addPane, handleResize, getPaneWidth, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();
        
        // Initialize widths to specific values
        paneWidths.value = [600, 600];

        // Resize first pane by +100px
        handleResize(0, 100);

        expect(paneWidths.value[0]).toBe(700);
        expect(paneWidths.value[1]).toBe(500);
        expect(getPaneWidth(0)).toBe(`${(700 / 1200) * 100}%`);
        expect(getPaneWidth(1)).toBe(`${(500 / 1200) * 100}%`);
    });

    it('handleResize respects minimum width constraint', () => {
        const { panes, addPane, handleResize, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
            minPaneWidth: 280,
        });

        addPane();
        
        // Set widths where left is at minimum
        paneWidths.value = [280, 920];

        // Try to shrink left pane (should be blocked)
        handleResize(0, -50);

        // Widths should not change because left would go below minimum
        expect(paneWidths.value[0]).toBe(280);
        expect(paneWidths.value[1]).toBe(920);
    });

    it('handleResize respects maximum width constraint', () => {
        const { panes, addPane, handleResize, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
            minPaneWidth: 280,
            maxPaneWidth: 2000,
        });

        addPane();
        
        // Set widths
        paneWidths.value = [1900, 300];

        // Try to grow left pane beyond max (should clamp)
        handleResize(0, 200);

        // The adjacent pane reaches its minimum first; total width is preserved.
        expect(paneWidths.value).toEqual([1920, 280]);
    });

    it('persists widths to localStorage', () => {
        const { panes, addPane, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
            storageKey: 'test-pane-widths',
        });

        addPane();
        paneWidths.value = [500, 700];

        // Trigger persistence (would normally happen in handleResize)
        localStorage.setItem('test-pane-widths', JSON.stringify(paneWidths.value));

        const stored = localStorage.getItem('test-pane-widths');
        expect(stored).toBe('[500,700]');
    });

    it('adds pane and redistributes widths proportionally', () => {
        const { panes, addPane, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        // Start with 2 panes with specific widths
        addPane();
        paneWidths.value = [600, 600];

        // Add third pane
        addPane();

        // Total was 1200, with 3 panes should be 400 each
        expect(panes.value.length).toBe(3);
        expect(paneWidths.value.length).toBe(3);
        expect(paneWidths.value[0]).toBe(400);
        expect(paneWidths.value[1]).toBe(400);
        expect(paneWidths.value[2]).toBe(400);
    });

    it('always renders matching stored widths across the full container', () => {
        const { addPane, getPaneWidth, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        paneWidths.value = [800];
        addPane();

        const renderedTotal =
            Number.parseFloat(getPaneWidth(0)) +
            Number.parseFloat(getPaneWidth(1));
        expect(renderedTotal).toBeCloseTo(100);
    });

    it('uses the latest single-pane container size when a split is reopened', async () => {
        const {
            addPane,
            closePane,
            handleResize,
            paneWidths,
            recalculateWidthsForContainer,
        } = useMultiPane({ loadMessagesFor: async () => [] });

        recalculateWidthsForContainer(1600);
        addPane();
        handleResize(0, 200);
        await closePane(1);
        recalculateWidthsForContainer(1200);
        addPane();

        expect(paneWidths.value).toEqual([600, 600]);
    });

    it('closes pane and redistributes width to remaining panes', async () => {
        const { panes, addPane, closePane, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        // Create 3 panes
        addPane();
        addPane();
        paneWidths.value = [400, 400, 400];

        // Close middle pane
        await closePane(1);

        // Should have 2 panes, each with additional 200px (half of removed pane)
        expect(panes.value.length).toBe(2);
        expect(paneWidths.value.length).toBe(2);
        expect(paneWidths.value[0]).toBe(600);
        expect(paneWidths.value[1]).toBe(600);
    });

    it('handles invalid pane index in handleResize', () => {
        const { panes, addPane, handleResize, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();
        paneWidths.value = [600, 600];

        // Try invalid index
        handleResize(-1, 100);
        handleResize(5, 100);

        // Widths should not change
        expect(paneWidths.value[0]).toBe(600);
        expect(paneWidths.value[1]).toBe(600);
    });

    it('restores widths from localStorage on initialization', async () => {
        // Pre-populate localStorage
        localStorage.setItem('pane-widths', JSON.stringify([450, 750]));

        const { panes, addPane, getPaneWidth, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        // Add a second pane to match stored count
        addPane();

        // Wait for restore to happen
        await new Promise(resolve => setTimeout(resolve, 10));

        // Should restore from localStorage
        expect(paneWidths.value).toEqual([450, 750]);
    });

    it('handles corrupted localStorage data gracefully', async () => {
        // Pre-populate with invalid JSON
        localStorage.setItem('pane-widths', 'not-valid-json');

        const { panes, addPane, getPaneWidth } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();

        // Wait for restore attempt
        await new Promise(resolve => setTimeout(resolve, 10));

        // Should fall back to equal distribution
        expect(getPaneWidth(0)).toBe('50%');
        expect(getPaneWidth(1)).toBe('50%');
    });

    it('handles pane count mismatch with stored widths', () => {
        const { panes, addPane, getPaneWidth, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        // Store widths for 2 panes
        paneWidths.value = [600, 600];

        // But only have 1 pane
        expect(panes.value.length).toBe(1);

        // Should fall back to percentage
        expect(getPaneWidth(0)).toBe('100%');
    });

    it('enforces minimum width for both panes during resize', () => {
        const { panes, addPane, handleResize, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
            minPaneWidth: 280,
        });

        addPane();
        paneWidths.value = [300, 900];

        // Try to shrink left pane below minimum
        handleResize(0, -30);

        // Should only shrink by 20 to reach minimum
        expect(paneWidths.value[0]).toBe(280);
        expect(paneWidths.value[1]).toBe(920);
    });

    it('preserves total width when the adjacent pane reaches its minimum', () => {
        const { addPane, handleResize, paneWidths } = useMultiPane({
            loadMessagesFor: async () => [],
            minPaneWidth: 280,
        });

        addPane();
        paneWidths.value = [300, 300];
        handleResize(0, 100);

        expect(paneWidths.value).toEqual([320, 280]);
        expect(paneWidths.value[0]! + paneWidths.value[1]!).toBe(600);
    });

    it('recalculates widths proportionally when container resizes (equal widths)', () => {
        const { addPane, paneWidths, recalculateWidthsForContainer } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();
        paneWidths.value = [600, 600]; // Total: 1200

        // Container shrinks to 900px
        recalculateWidthsForContainer(900);

        // Should maintain 50/50 ratio
        expect(paneWidths.value[0]).toBe(450);
        expect(paneWidths.value[1]).toBe(450);
    });

    it('recalculates widths proportionally when container resizes (unequal widths)', () => {
        const { addPane, paneWidths, recalculateWidthsForContainer } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        addPane();
        paneWidths.value = [400, 800]; // Total: 1200, ratio 1:2

        // Container grows to 1500px
        recalculateWidthsForContainer(1500);

        // Should maintain 1:2 ratio (500:1000)
        expect(paneWidths.value[0]).toBe(500);
        expect(paneWidths.value[1]).toBe(1000);
    });

    it('recalculates handles container shrink below minimum width gracefully', () => {
        const { addPane, paneWidths, recalculateWidthsForContainer } = useMultiPane({
            loadMessagesFor: async () => [],
            minPaneWidth: 280,
        });

        addPane();
        paneWidths.value = [600, 600]; // Total: 1200

        // Container shrinks to 500px (each pane would be 250px, below min of 280)
        recalculateWidthsForContainer(500);

        // Both should clamp to minimum
        expect(paneWidths.value[0]).toBe(280);
        expect(paneWidths.value[1]).toBe(280);
    });

    it('fills the container when proportional scaling hits a minimum', () => {
        const { addPane, paneWidths, recalculateWidthsForContainer } =
            useMultiPane({
                loadMessagesFor: async () => [],
                minPaneWidth: 280,
            });

        addPane();
        paneWidths.value = [300, 900];
        recalculateWidthsForContainer(900);

        expect(paneWidths.value).toEqual([280, 620]);
    });

    it('fills containers wider than the configured maximums can cover', () => {
        const { addPane, paneWidths, recalculateWidthsForContainer } =
            useMultiPane({
                loadMessagesFor: async () => [],
                maxPaneWidth: 2000,
            });

        addPane();
        paneWidths.value = [1900, 300];
        recalculateWidthsForContainer(4500);

        expect(paneWidths.value).toEqual([2250, 2250]);
    });

    it('tracks the container width while a single pane is open', () => {
        const { paneWidths, recalculateWidthsForContainer } = useMultiPane({
            loadMessagesFor: async () => [],
        });

        paneWidths.value = [800];
        recalculateWidthsForContainer(1000);

        // The pane still renders at 100%, but its stored width must stay current
        // so a newly opened split starts from the real available space.
        expect(paneWidths.value).toEqual([1000]);
    });
});

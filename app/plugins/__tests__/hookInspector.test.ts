import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createHookEngine } from '../../utils/hooks';
import HookInspector from '../devtools/HookInspector.vue';

// Mock composables
const mockHooks = createHookEngine();
const mockToast = { add: vi.fn() };

// Stub UI components
const UIcon = { template: '<i></i>' };
const UButton = { template: '<button><slot /></button>' };

// Set up global mocks
(globalThis as any).useHooks = () => mockHooks;
(globalThis as any).useToast = () => mockToast;

async function flush() {
    await nextTick();
    await nextTick(); // Extra tick for reactivity
}

const mountOptions = {
    global: {
        stubs: {
            UIcon,
            UButton,
        },
    },
};

describe('HookInspector', () => {
    beforeEach(() => {
        // Clear diagnostics
        mockHooks._diagnostics.timings = {};
        mockHooks._diagnostics.errors = {};
        // Clear all callbacks to avoid test interference
        mockHooks.removeAllCallbacks();
        mockToast.add.mockClear();
    });

    it('renders empty state when no hooks have been executed', async () => {
        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        const stats = wrapper.findAll('.text-2xl');
        expect(stats[0]?.text()).toContain('0'); // Total Actions
        expect(stats[1]?.text()).toContain('0'); // Total Filters
        expect(stats[2]?.text()).toContain('0'); // Total Errors

        expect(wrapper.text()).toContain(
            'No hooks have been executed yet'
        );
    });

    it('displays hook statistics after hooks are executed', async () => {
        // Register some hooks
        mockHooks.addAction('test.action', () => {});
        mockHooks.addFilter('test.filter', (v) => v);

        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        // Execute hooks to generate diagnostics
        await mockHooks.doAction('test.action');
        await mockHooks.applyFilters('test.filter', 'value');

        // Manually trigger update (simulate what would happen in real usage)
        await wrapper.vm.updateSnapshot();
        await flush();

        const stats = wrapper.findAll('.text-2xl');
        expect(stats[0]?.text()).toContain('1'); // Total Actions (1 registered)
        expect(stats[1]?.text()).toContain('1'); // Total Filters (1 registered)
    });

    it('shows hook execution details in table', async () => {
        mockHooks.addAction('test.hook.one', () => {});
        mockHooks.addAction('test.hook.two', () => {});

        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        // Execute hooks multiple times
        await mockHooks.doAction('test.hook.one');
        await mockHooks.doAction('test.hook.one');
        await mockHooks.doAction('test.hook.two');

        await wrapper.vm.updateSnapshot();
        await flush();

        // Check that hooks appear in table
        const tableText = wrapper.find('table').text();
        expect(tableText).toContain('test.hook.one');
        expect(tableText).toContain('test.hook.two');
    });

    it('calculates timing statistics correctly', async () => {
        // Manually add timing data
        mockHooks._diagnostics.timings['manual.hook'] = [1.5, 2.3, 3.1, 4.8];

        const wrapper = mount(HookInspector, mountOptions);
        await wrapper.vm.updateSnapshot();
        await flush();

        const details = wrapper.vm.hookDetails;
        const hook = details.find((h: any) => h.name === 'manual.hook');

        expect(hook).toBeTruthy();
        expect(hook.count).toBe(4);
        expect(parseFloat(hook.avg)).toBeCloseTo(2.925, 2);
        expect(parseFloat(hook.max)).toBeCloseTo(4.8, 1);
    });

    it('tracks errors correctly', async () => {
        mockHooks.addAction('error.hook', () => {
            throw new Error('Test error');
        });

        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        // Execute hook that throws error (engine catches it)
        await mockHooks.doAction('error.hook');

        await wrapper.vm.updateSnapshot();
        await flush();

        const stats = wrapper.vm.stats;
        expect(stats.totalErrors).toBe(1);
    });

    it('manual refresh updates the snapshot', async () => {
        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        // Initial state should show 0
        expect(wrapper.vm.stats.totalActions).toBe(0);

        // Add and execute a hook
        mockHooks.addAction('refresh.test', () => {});
        await mockHooks.doAction('refresh.test');

        // Stats shouldn't update automatically (passive polling is every 2s)
        expect(wrapper.vm.diagnosticsSnapshot.timings['refresh.test']).toBeUndefined();

        // Click refresh button
        await wrapper.find('button').trigger('click'); // First button is refresh
        await flush();

        // Now it should be updated
        expect(wrapper.vm.diagnosticsSnapshot.timings['refresh.test']).toBeTruthy();
    });

    it('clear button resets diagnostics', async () => {
        mockHooks._diagnostics.timings['clear.test'] = [1, 2, 3];
        mockHooks._diagnostics.errors['clear.test'] = 5;

        const wrapper = mount(HookInspector, mountOptions);
        await wrapper.vm.updateSnapshot();
        await flush();

        expect(Object.keys(wrapper.vm.diagnosticsSnapshot.timings).length).toBeGreaterThan(0);

        // Find and click the Clear button (has trash icon)
        const buttons = wrapper.findAll('button');
        const clearButton = buttons.find(b => b.html().includes('trash'));
        expect(clearButton).toBeTruthy();

        await clearButton?.trigger('click');
        await flush();

        expect(Object.keys(mockHooks._diagnostics.timings).length).toBe(0);
        expect(Object.keys(mockHooks._diagnostics.errors).length).toBe(0);
    });

    it('auto-refresh toggles correctly', async () => {
        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        expect(wrapper.vm.autoRefresh).toBe(false);

        // Find Auto button (has checkbox icon)
        const buttons = wrapper.findAll('button');
        const autoButton = buttons.find(b => b.html().includes('checkbox'));
        expect(autoButton).toBeTruthy();

        await autoButton?.trigger('click');
        await flush();

        expect(wrapper.vm.autoRefresh).toBe(true);
        expect(mockToast.add).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Auto-refresh enabled',
            })
        );
    });

    it('passive polling detects new hooks and invocations', async () => {
        vi.useFakeTimers();

        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        expect(Object.keys(wrapper.vm.diagnosticsSnapshot.timings).length).toBe(0);

        // Add and execute a hook
        mockHooks.addAction('passive.test', () => {});
        await mockHooks.doAction('passive.test');

        // Fast-forward 500ms (passive polling interval)
        vi.advanceTimersByTime(500);
        await flush();

        // Should have detected the new hook
        expect(wrapper.vm.diagnosticsSnapshot.timings['passive.test']).toBeTruthy();
        expect(wrapper.vm.diagnosticsSnapshot.timings['passive.test'].length).toBe(1);

        // Execute the hook again
        await mockHooks.doAction('passive.test');

        // Fast-forward another 500ms
        vi.advanceTimersByTime(500);
        await flush();

        // Should have detected the new invocation
        expect(wrapper.vm.diagnosticsSnapshot.timings['passive.test'].length).toBe(2);

        vi.useRealTimers();
    });

    it('reactivity works - computed values update when snapshot changes', async () => {
        const wrapper = mount(HookInspector, mountOptions);
        await flush();

        // Initial state
        expect(wrapper.vm.hookDetails.length).toBe(0);
        expect(wrapper.vm.stats.totalActions).toBe(0);

        // Manually mutate the reactive snapshot
        wrapper.vm.diagnosticsSnapshot.timings['new.hook'] = [1.5, 2.5];
        wrapper.vm.diagnosticsSnapshot.totalActions = 5;
        await flush();

        // Computed values should update
        expect(wrapper.vm.hookDetails.length).toBe(1);
        expect(wrapper.vm.stats.totalActions).toBe(5);
        expect(wrapper.vm.hookDetails[0].name).toBe('new.hook');
    });
});

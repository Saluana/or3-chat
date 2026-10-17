import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createHookEngine } from '../../core/hooks/hooks';
import { createTypedHookEngine } from '../../core/hooks/typed-hooks';
import HookInspector from '../devtools/HookInspector.vue';

// Mock composables
const mockHooks = createTypedHookEngine(createHookEngine());
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

const mounted: ReturnType<typeof mount>[] = [];
function mountInspector() {
    const wrapper = mount(HookInspector, mountOptions);
    mounted.push(wrapper);
    return wrapper;
}
function row(wrapper: ReturnType<typeof mount>, name: string) {
    return wrapper.findAll('tbody tr').find((entry) => entry.text().includes(name));
}

describe('HookInspector', () => {
    afterEach(() => {
        for (const wrapper of mounted.splice(0)) wrapper.unmount();
        vi.useRealTimers();
    });
    beforeEach(() => {
        // Clear diagnostics
        mockHooks._diagnostics.timings = {};
        mockHooks._diagnostics.errors = {};
        // Clear all callbacks to avoid test interference
        mockHooks.removeAllCallbacks();
        mockToast.add.mockClear();
    });

    it('renders empty state when no hooks have been executed', async () => {
        const wrapper = mountInspector();
        await flush();

        const stats = wrapper.findAll('.text-2xl');
        expect(stats[0]?.text()).toContain('0'); // Total Actions
        expect(stats[1]?.text()).toContain('0'); // Total Filters
        expect(stats[2]?.text()).toContain('0'); // Total Errors

        expect(wrapper.text()).toContain('No hooks have been executed yet');
    });

    it('shows hook execution details in table', async () => {
        mockHooks.addAction('test.hook.one', () => {});
        mockHooks.addAction('test.hook.two', () => { throw new Error('Test error'); });
        mockHooks.addFilter('test.filter', () => undefined);

        const wrapper = mountInspector();
        await flush();

        // Execute hooks multiple times
        await mockHooks.doAction('test.hook.one');
        await mockHooks.doAction('test.hook.one');
        await mockHooks.doAction('test.hook.two');
        await mockHooks.applyFilters('test.filter', 'value');

        await wrapper.findAll('button').find((button) => button.text() === 'Refresh')!.trigger('click');
        await flush();

        // Check that hooks appear in table
        const tableText = wrapper.find('table').text();
        expect(tableText).toContain('test.hook.one');
        expect(tableText).toContain('test.hook.two');
        expect(wrapper.findAll('.text-2xl').map((value) => value.text())).toEqual(['2', '1', '1']);
        expect(row(wrapper, 'test.hook.one')!.findAll('td')[1]!.text()).toBe('2');
        expect(row(wrapper, 'test.hook.two')!.findAll('td')[5]!.text()).toBe('1');
    });

    it('calculates timing statistics correctly', async () => {
        // Manually add timing data
        mockHooks._diagnostics.timings['manual.hook'] = [1.5, 2.3, 3.1, 4.8];

        const wrapper = mountInspector();
        await wrapper.findAll('button').find((button) => button.text() === 'Refresh')!.trigger('click');
        await flush();

        const cells = row(wrapper, 'manual.hook')!.findAll('td');
        expect(cells[1]!.text()).toBe('4');
        expect(parseFloat(cells[2]!.text())).toBeCloseTo(2.925, 2);
        expect(cells[3]!.text()).toBe('4.80');
        expect(parseFloat(cells[4]!.text())).toBeCloseTo(4.8, 1);
    });

    it('manual refresh updates the snapshot', async () => {
        const wrapper = mountInspector();
        await flush();

        // Initial state should show 0
        expect(wrapper.findAll('.text-2xl')[0]!.text()).toBe('0');

        // Add and execute a hook
        mockHooks.addAction('refresh.test', () => {});
        await mockHooks.doAction('refresh.test');

        // Passive polling has not run yet.
        expect(row(wrapper, 'refresh.test')).toBeUndefined();

        // Click refresh button
        await wrapper.find('button').trigger('click'); // First button is refresh
        await flush();

        // Now it should be updated
        expect(row(wrapper, 'refresh.test')).toBeTruthy();
    });

    it('clear button resets diagnostics', async () => {
        mockHooks._diagnostics.timings['clear.test'] = [1, 2, 3];
        mockHooks._diagnostics.errors['clear.test'] = 5;

        const wrapper = mountInspector();
        await wrapper.findAll('button').find((button) => button.text() === 'Refresh')!.trigger('click');
        await flush();

        expect(row(wrapper, 'clear.test')).toBeTruthy();

        // Find and click the Clear button (has trash icon)
        const buttons = wrapper.findAll('button');
        const clearButton = buttons.find((b) => b.text() === 'Clear');
        expect(clearButton).toBeTruthy();

        await clearButton?.trigger('click');
        await flush();

        expect(Object.keys(mockHooks._diagnostics.timings).length).toBe(0);
        expect(Object.keys(mockHooks._diagnostics.errors).length).toBe(0);
        expect(row(wrapper, 'clear.test')).toBeUndefined();
    });

    it('auto-refresh toggles correctly', async () => {
        const wrapper = mountInspector();
        await flush();

        expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeUndefined();

        // Find Auto button (has checkbox icon)
        const buttons = wrapper.findAll('button');
        const autoButton = buttons.find((b) => b.text() === 'Auto');
        expect(autoButton).toBeTruthy();

        await autoButton?.trigger('click');
        await flush();

        expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeDefined();
        expect(mockToast.add).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Auto-refresh enabled',
            }),
        );
    });

    it('passive polling detects new hooks and invocations', async () => {
        vi.useFakeTimers();

        const wrapper = mountInspector();
        await flush();

        expect(row(wrapper, 'passive.test')).toBeUndefined();

        // Add and execute a hook
        mockHooks.addAction('passive.test', () => {});
        await mockHooks.doAction('passive.test');

        // Fast-forward 500ms (passive polling interval)
        vi.advanceTimersByTime(500);
        await flush();

        // Should have detected the new hook
        expect(row(wrapper, 'passive.test')).toBeTruthy();
        expect(row(wrapper, 'passive.test')!.findAll('td')[1]!.text()).toBe('1');

        // Execute the hook again
        await mockHooks.doAction('passive.test');

        // Fast-forward another 500ms
        vi.advanceTimersByTime(500);
        await flush();

        // Should have detected the new invocation
        expect(row(wrapper, 'passive.test')!.findAll('td')[1]!.text()).toBe('2');

        vi.useRealTimers();
    });

});

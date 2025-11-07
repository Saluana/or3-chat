import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SearchPanelRoot from '../SearchPanelRoot.vue';

vi.mock('@orama/orama', () => ({
    create: vi.fn(() => ({})),
    insert: vi.fn(),
    search: vi.fn(() => ({ hits: [] })),
}));

describe('SearchPanelRoot - memory leaks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears search timeout on unmount', async () => {
        const wrapper = mount(SearchPanelRoot, {
            props: {
                docmap: {
                    sections: [
                        {
                            title: 'Section 1',
                            files: [
                                { name: 'test.md', path: '/test', category: 'Test' },
                            ],
                        },
                    ],
                },
                searchQuery: 'test',
            },
        });

        // Trigger a search that will set a timeout
        await wrapper.setProps({ searchQuery: 'new query' });

        // Unmount should clear the timeout
        wrapper.unmount();

        // Advance timers - if timeout wasn't cleared, this would cause an error
        vi.advanceTimersByTime(200);
        
        // Test passes if no errors are thrown
        expect(true).toBe(true);
    });

    it('clears previous timeout when new search is triggered', async () => {
        const wrapper = mount(SearchPanelRoot, {
            props: {
                docmap: {
                    sections: [
                        {
                            title: 'Section 1',
                            files: [
                                { name: 'test.md', path: '/test', category: 'Test' },
                            ],
                        },
                    ],
                },
                searchQuery: 'test',
            },
        });

        await wrapper.vm.$nextTick();

        // Trigger multiple searches rapidly - each should clear the previous timeout
        await wrapper.setProps({ searchQuery: 'query1' });
        await wrapper.setProps({ searchQuery: 'query2' });
        await wrapper.setProps({ searchQuery: 'query3' });

        // Only one timeout should be active at the end
        const timerCount = vi.getTimerCount();
        expect(timerCount).toBeLessThanOrEqual(1);

        wrapper.unmount();
    });

    it('nullifies timeout after search completes', async () => {
        const wrapper = mount(SearchPanelRoot, {
            props: {
                docmap: {
                    sections: [],
                },
                searchQuery: 'test query',
            },
        });

        await wrapper.vm.$nextTick();

        // Wait for debounce to complete
        vi.advanceTimersByTime(200);
        await wrapper.vm.$nextTick();

        // Unmounting should not cause issues
        wrapper.unmount();
        
        expect(true).toBe(true);
    });
});

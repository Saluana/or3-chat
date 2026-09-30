import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ToolCallIndicator from '../ToolCallIndicator.vue';

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => ({ value: 'test-icon' }),
}));

const global = {
    stubs: {
        UIcon: {
            template: '<span class="icon" />',
        },
    },
};

describe('ToolCallIndicator', () => {
    it('renders summary-only activity without an empty disclosure', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Reading files',
                        status: 'complete',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.find('[data-expandable="false"]').exists()).toBe(true);
        expect(wrapper.find('.tool-call-expanded-content').exists()).toBe(
            false
        );
    });

    it('keeps a disclosure when meaningful details are available', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'tests',
                        name: 'Running tests',
                        status: 'complete',
                        result: '41 tests passed',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('details').exists()).toBe(true);
        expect(wrapper.find('[data-expandable="true"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('41 tests passed');
    });

    it('requests a virtual-list remeasurement when details toggle', async () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Read files',
                        status: 'complete',
                        args: '/workspace/README.md',
                    },
                ],
            },
            global,
        });

        await wrapper.find('details').trigger('toggle');

        expect(wrapper.emitted('resize')).toHaveLength(1);
    });

    it('groups consecutive activity into a compact Codex-style summary', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'read',
                        name: 'Reading files',
                        label: 'Read files',
                        status: 'complete',
                    },
                    {
                        id: 'command',
                        name: 'Running a command',
                        label: 'Ran a command',
                        status: 'complete',
                        args: 'bun run test',
                    },
                    {
                        id: 'search',
                        name: 'Searching the workspace',
                        label: 'Searched the workspace',
                        status: 'complete',
                    },
                ],
            },
            global,
        });

        expect(wrapper.findAll('.tool-call-indicator-details')).toHaveLength(1);
        expect(wrapper.text()).toContain(
            'Read files, Ran a command, Searched the workspace'
        );
        expect(wrapper.text()).not.toContain('Agent activity');
        expect(wrapper.text()).not.toContain('COMPLETE');
    });

    it('does not describe task-list calls as file or workspace operations', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'create',
                        name: 'or3sal_tasks_create_list',
                        status: 'error',
                        error: 'Tool is client-only',
                    },
                    {
                        id: 'search',
                        name: 'or3sal_tasks_search_lists',
                        status: 'error',
                        error: 'Tool is client-only',
                    },
                ],
            },
            global,
        });

        expect(wrapper.find('summary').text()).toContain('or3sal_tasks_create_list');
        expect(wrapper.find('summary').text()).toContain('or3sal_tasks_search_lists');
        expect(wrapper.find('summary').text()).not.toContain('files');
        expect(wrapper.find('summary').text()).not.toContain('workspace');
    });

    it('shows when a background call is waiting for its browser executor', () => {
        const wrapper = mount(ToolCallIndicator, {
            props: {
                toolCalls: [
                    {
                        id: 'search',
                        name: 'search lists',
                        status: 'pending',
                        runtime: 'client',
                    },
                ],
            },
            global,
        });

        expect(wrapper.text()).toContain(
            'Waiting for this browser · search lists'
        );
    });
});

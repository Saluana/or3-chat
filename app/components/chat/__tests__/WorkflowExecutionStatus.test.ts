import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkflowExecutionStatus from '../WorkflowExecutionStatus.vue';
import type { UiWorkflowState } from '~/utils/chat/workflow-types';

// Mocks
vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ({ value: `icon-${name}` }),
}));

vi.mock('#app', () => ({
    useNuxtApp: () => ({
        $theme: {
            current: { value: 'light' },
            get: () => 'light',
        },
    }),
}));

// Mock streamdown-vue
vi.mock('streamdown-vue', () => ({
    StreamMarkdown: {
        template: '<div class="stream-markdown">{{ content }}</div>',
        props: ['content', 'shikiTheme'],
    },
    useShikiHighlighter: vi.fn().mockResolvedValue(undefined),
}));

// Mock StreamMarkdown component
const StreamMarkdown = {
    template: '<div class="stream-markdown">{{ content }}</div>',
    props: ['content', 'shikiTheme'],
};

// Mock UIcon component
const UIcon = {
    template: '<div class="u-icon" :data-name="name"></div>',
    props: ['name'],
};

describe('WorkflowExecutionStatus', () => {
    const mockState: UiWorkflowState = {
        workflowId: 'wf-1',
        workflowName: 'Test Workflow',
        executionState: 'running',
        nodeStates: {
            'node-1': {
                status: 'completed',
                label: 'Node 1',
                type: 'agent',
                output: 'Output 1',
                streamingText: undefined,
                tokenCount: 10,
                startedAt: 1000,
                finishedAt: 2000,
            },
            'node-2': {
                status: 'active',
                label: 'Node 2',
                type: 'tool',
                output: '',
                streamingText: 'Streaming...',
                tokenCount: 5,
                startedAt: 2000,
            },
        },
        executionOrder: ['node-1', 'node-2'],
        currentNodeId: 'node-2',
        branches: {},
    };

    it('renders header with correct status', () => {
        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: mockState },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        expect(wrapper.text()).toContain('Test Workflow');
        expect(wrapper.text()).toContain('(Running)');
        
        const statusIcon = wrapper.find('.u-icon[data-name="icon-workflow.status.running"]');
        expect(statusIcon.exists()).toBe(true);
    });

    it('renders node list in execution order', async () => {
        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: mockState },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        // Component starts collapsed, expand it first
        await wrapper.find('.cursor-pointer').trigger('click');

        const nodes = wrapper.findAll('.node-item');
        expect(nodes).toHaveLength(2);
        expect(nodes[0]!.text()).toContain('Node 1');
        expect(nodes[1]!.text()).toContain('Node 2');
    });

    it('renders node output', async () => {
        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: mockState },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        // Component starts collapsed, expand it first
        await wrapper.find('.cursor-pointer').trigger('click');

        expect(wrapper.text()).toContain('Output 1');
        expect(wrapper.text()).toContain('Streaming...');
    });

    it('toggles collapse state', async () => {
        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: mockState },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        // Initially collapsed (collapsed = true)
        expect(wrapper.find('.node-item').exists()).toBe(false);

        // Click header to expand
        await wrapper.find('.cursor-pointer').trigger('click');
        expect(wrapper.find('.node-item').exists()).toBe(true);

        // Click again to collapse
        await wrapper.find('.cursor-pointer').trigger('click');
        expect(wrapper.find('.node-item').exists()).toBe(false);
    });

    it('renders parallel branches', async () => {
        const stateWithBranches: UiWorkflowState = {
            ...mockState,
            branches: {
                'node-2:branch-1': {
                    id: 'branch-1',
                    label: 'Branch 1',
                    status: 'active',
                    output: '',
                    streamingText: 'Branch output',
                },
            },
        };

        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: stateWithBranches },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        // Component starts collapsed, expand it first
        await wrapper.find('.cursor-pointer').trigger('click');

        expect(wrapper.text()).toContain('Branch 1');
        expect(wrapper.text()).toContain('Branch output');
    });

    it('renders error state', async () => {
        const errorState: UiWorkflowState = {
            ...mockState,
            executionState: 'error',
            nodeStates: {
                'node-1': {
                    status: 'error',
                    label: 'Node 1',
                    type: 'agent',
                    output: '',
                    error: 'Something failed',
                },
            },
            executionOrder: ['node-1'],
        };

        const wrapper = mount(WorkflowExecutionStatus, {
            props: { workflowState: errorState },
            global: {
                components: { StreamMarkdown, UIcon },
            },
        });

        // Header is always visible
        expect(wrapper.text()).toContain('(Error)');
        const errorIcon = wrapper.find('.u-icon[data-name="icon-workflow.status.error"]');
        expect(errorIcon.exists()).toBe(true);

        // Expand to see error message in node
        await wrapper.find('.cursor-pointer').trigger('click');
        expect(wrapper.text()).toContain('Something failed');
    });
});

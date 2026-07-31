import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityDashboardPage from '../ActivityDashboardPage.vue';
import ActivityDetailPane from '../ActivityDetailPane.vue';
import ActivityRunList from '../ActivityRunList.vue';
import { encodeActivityRunRef } from '~/core/activity/run-ref';

const mocks = vi.hoisted(() => ({
    listRuns: vi.fn(),
    getRun: vi.fn(),
    executeAction: vi.fn(),
    subscriptionDispose: vi.fn(),
}));

vi.mock('~/core/activity/registry', () => ({
    getActivityRegistry: () => ({
        listSources: () => [
            { id: 'or3.workflow', label: 'Workflows' },
        ],
        get: (id: string) =>
            id === 'or3.workflow'
                ? { id, label: 'Workflows' }
                : undefined,
        listRuns: mocks.listRuns,
        getRun: mocks.getRun,
        executeAction: mocks.executeAction,
        subscribe: () => ({
            degradedSources: [],
            disposed: false,
            dispose: mocks.subscriptionDispose,
        }),
    }),
}));

vi.mock('~/db/kv', () => ({
    getKvByName: vi.fn(async () => undefined),
    setKvByName: vi.fn(async () => undefined),
}));

const ButtonStub = defineComponent({
    inheritAttrs: false,
    emits: ['click'],
    setup(_, { attrs, emit, slots }) {
        return () =>
            h(
                'button',
                {
                    ...attrs,
                    disabled: attrs.disabled as boolean,
                    onClick: () => emit('click'),
                },
                slots.default?.()
            );
    },
});
const BadgeStub = defineComponent({
    setup(_, { slots }) {
        return () => h('span', slots.default?.());
    },
});
const AlertStub = defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
        return () => {
            const actions = slots.actions?.() ?? [];
            return h('div', {}, [
                String(attrs.title ?? ''),
                String(attrs.description ?? ''),
                ...actions,
            ]);
        };
    },
});
const DetailStub = defineComponent({
    props: {
        recordId: {
            type: String,
            required: true,
        },
    },
    setup(props) {
        return () =>
            h(
                'div',
                { 'data-testid': 'activity-detail' },
                props.recordId
            );
    },
});

const global = {
    stubs: {
        UButton: ButtonStub,
        UBadge: BadgeStub,
        UAlert: AlertStub,
        UIcon: true,
        USkeleton: true,
    },
};

function run(overrides: Record<string, unknown> = {}) {
    return {
        id: 'run-1',
        sourceId: 'or3.workflow',
        title: 'Research workflow',
        kind: 'workflow',
        status: 'running',
        startedAt: '2026-07-27T09:00:00Z',
        updatedAt: '2026-07-27T10:00:00Z',
        summary: 'Research this topic',
        actions: ['cancel'],
        ...overrides,
    };
}

describe('Activity Center components', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listRuns.mockResolvedValue({
            runs: [run()],
            degradedSources: [],
        });
        mocks.executeAction.mockResolvedValue({
            ok: true,
            value: undefined,
        });
    });

    it('renders running runs and opens detail inside the dashboard app', async () => {
        const wrapper = mount(ActivityDashboardPage, {
            global: {
                ...global,
                stubs: {
                    ...global.stubs,
                    ActivityDetailPane: DetailStub,
                },
            },
        });
        await flushPromises();
        expect(wrapper.text()).toContain('Choose an activity');
        expect(wrapper.text()).toContain('Research workflow');
        expect(wrapper.text()).toContain('running');
        expect(wrapper.text()).toContain('Workflows · workflow');
        await wrapper
            .findAll('button')
            .find((button) => button.text().includes('Research workflow'))
            ?.trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="activity-detail"]').text()).toBe(
            encodeActivityRunRef({
                sourceId: 'or3.workflow',
                runId: 'run-1',
            })
        );
        expect(wrapper.text()).not.toContain('Choose an activity');
        wrapper.unmount();
        expect(mocks.subscriptionDispose).toHaveBeenCalled();
    });

    it('renders approval and degraded states', async () => {
        mocks.listRuns.mockResolvedValue({
            runs: [
                run({
                    status: 'waiting_approval',
                    actions: ['approve', 'deny'],
                }),
            ],
            degradedSources: [
                {
                    code: 'source_failure',
                    message: 'offline',
                    sourceId: 'or3.workflow',
                },
            ],
        });
        const wrapper = mount(ActivityRunList, { global });
        await flushPromises();
        await wrapper
            .findAll('button')
            .find((button) => button.text() === 'Approvals')
            ?.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Some activity is unavailable');
        expect(wrapper.text()).toContain('waiting approval');
    });

    it('renders detail errors and only advertised actions in responsive layout', async () => {
        mocks.getRun.mockResolvedValue({
            ok: true,
            value: {
                ...run({
                    status: 'failed',
                    actions: ['retry'],
                }),
                events: [
                    {
                        id: 'error-1',
                        sourceId: 'or3.workflow',
                        runId: 'run-1',
                        type: 'error',
                        occurredAt: '2026-07-27T10:00:00Z',
                        payload: { message: 'Execution failed' },
                    },
                ],
                error: 'Execution failed',
            },
        });
        const wrapper = mount(ActivityDetailPane, {
            props: {
                paneId: 'pane-1',
                recordId: encodeActivityRunRef({
                    sourceId: 'or3.workflow',
                    runId: 'run-1',
                }),
            },
            global,
        });
        await flushPromises();
        expect(wrapper.text()).toContain('Run failed');
        expect(wrapper.text()).toContain('Retry');
        expect(wrapper.text()).not.toContain('Cancel');
        expect(wrapper.find('section').classes()).toContain('px-4');
        expect(wrapper.html()).toContain('md:px-6');
        wrapper.unmount();
    });
});

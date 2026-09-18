import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { PortableActivation } from '~/composables/plugins/portable-client-runtime';

/**
 * A plugin's registered dashboard contributions must reach a rendered surface:
 * recording them and rendering nothing made the advertised contribution API
 * produce invisible UI. Withdrawal has to hide them again.
 */
const invokeMock = vi.fn();
const runHostActionMock = vi.fn();
const activations = new Map<string, unknown>();
const routeQuery: Record<string, unknown> = {};
const fetchMock = vi.fn();

vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    usePortableActivations: () => activations,
    invokePortableUiEvent: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('~/composables/plugins/usePortableHostActions', () => ({
    usePortableHostActions: () => ({ run: (...args: unknown[]) => runHostActionMock(...args) }),
}));

vi.mock('~/db/documents', () => ({
    getDocument: async () => ({
        id: 'doc_1',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selected text' }] }] },
    }),
}));

vi.mock('#imports', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useRoute: () => ({ query: routeQuery }),
    useToast: () => ({ add: vi.fn() }),
    navigateTo: vi.fn(),
    $fetch: (...args: unknown[]) => fetchMock(...args),
    useRuntimeConfig: () => ({ public: {} }),
}));

import PortableUiTree from '../PortableUiTree.vue';
import PortableClientView from '../PortableClientView.vue';

beforeEach(() => {
    invokeMock.mockReset();
    runHostActionMock.mockReset();
    fetchMock.mockReset();
    runHostActionMock.mockResolvedValue({
        ok: true,
        outcome: { status: 'created-document', documentId: 'doc_new' },
    });
    fetchMock.mockResolvedValue({ firstAction: { label: 'Summarize', ready: false, reason: 'Finish setup' } });
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
});

function activation(overrides: Partial<PortableActivation> = {}): PortableActivation {
    return {
        pluginId: 'sample.plugin',
        version: '1.0.0',
        workspaceId: 'ws-1',
        generation: 1,
        descriptorKey: `sha256-${'a'.repeat(64)}`,
        status: 'active',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        logs: [],
        crashed: false,
        startedAt: 0,
        ...overrides,
    } as PortableActivation;
}

const stubs = {
    UIcon: { template: '<i />' },
    UBadge: { template: '<span><slot /></span>' },
    UAlert: { props: ['title', 'description'], template: '<div role="alert">{{ title }}</div>' },
};

// Nuxt auto-imports the renderer in the app; a unit mount has to register it.
const global = { stubs, components: { PortableUiTree } };

describe('PortableClientView', () => {
    it('renders registered dashboard contributions', () => {
        activations.set(
            'sample.plugin',
            activation({
                contributions: [
                    {
                        id: 'sample.plugin.summary',
                        title: 'Workspace insights',
                        nodes: [{ type: 'text', text: 'Twelve open threads' }],
                    },
                ],
            })
        );

        const wrapper = mount(PortableClientView, {
            props: { pluginId: 'sample.plugin' },
            global,
        });

        const section = wrapper.get('[data-testid="portable-plugin-contributions"]');
        expect(section.text()).toContain('Workspace insights');
        expect(section.text()).toContain('Twelve open threads');
    });

    it('hides a contribution the plugin withdrew', () => {
        activations.set('sample.plugin', activation({ contributions: [] }));

        const wrapper = mount(PortableClientView, {
            props: { pluginId: 'sample.plugin' },
            global,
        });

        expect(wrapper.find('[data-testid="portable-plugin-contributions"]').exists()).toBe(false);
    });
});

describe('PortableClientView host actions', () => {
    function shell(nodes: readonly unknown[]) {
        activations.set('sample.plugin', activation({ view: { title: null, nodes } as never }));
        return mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
    }

    it('performs a host create-document action instead of forwarding it to the plugin', async () => {
        const wrapper = shell([
            { type: 'button', id: 'save', label: 'Create document', action: 'host.document.create' },
        ]);
        await wrapper.get('button[data-action="host.document.create"]').trigger('click');
        await Promise.resolve();
        expect(runHostActionMock).toHaveBeenCalledWith(
            expect.objectContaining({ pluginId: 'sample.plugin', action: 'host.document.create' })
        );
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('requires confirmation before replacing the selected document', async () => {
        routeQuery.documentId = 'doc_1';
        const wrapper = shell([
            { type: 'button', id: 'replace', label: 'Replace document', action: 'host.document.replace' },
        ]);
        await wrapper.get('button[data-action="host.document.replace"]').trigger('click');
        // Nothing is written until the host confirmation is answered.
        expect(runHostActionMock).not.toHaveBeenCalled();
        const dialog = wrapper.get('[data-testid="portable-host-confirm"]');
        expect(dialog.text()).toContain('Replace selected document');

        const confirm = dialog.findAll('button').find((button) => button.text().includes('Replace'));
        await confirm?.trigger('click');
        await Promise.resolve();
        expect(runHostActionMock).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'host.document.replace', selectedDocumentId: 'doc_1' })
        );
    })

    it('refuses an unknown host action instead of forwarding it', async () => {
        const wrapper = shell([
            { type: 'button', id: 'odd', label: 'Do odd thing', action: 'host.something.else' },
        ]);
        await wrapper.get('button[data-action="host.something.else"]').trigger('click');
        expect(runHostActionMock).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('still forwards ordinary plugin actions to the plugin', async () => {
        const wrapper = shell([
            { type: 'button', id: 'run', label: 'Run', action: 'compare.run' },
        ]);
        await wrapper.get('button[data-action="compare.run"]').trigger('click');
        await Promise.resolve();
        expect(invokeMock).toHaveBeenCalledWith('sample.plugin', expect.objectContaining({ action: 'compare.run' }));
        expect(runHostActionMock).not.toHaveBeenCalled();
    })

    it('offers the declared first action only when the plan says it can run', async () => {
        fetchMock.mockResolvedValue({
            firstAction: { label: 'Summarize sample', ready: false, reason: 'Finish setup' },
        });
        const notReady = shell([]);
        await flushPromises();
        const panel = notReady.get('[data-testid="portable-plugin-first-action"]');
        expect(panel.text()).toContain('Finish setup');
        expect(panel.findAll('button')).toHaveLength(0);

        fetchMock.mockResolvedValue({
            firstAction: { label: 'Summarize sample', ready: true, contextKind: 'sample' },
        });
        const ready = shell([]);
        await flushPromises();
        const readyPanel = ready.get('[data-testid="portable-plugin-first-action"]');
        expect(readyPanel.text()).toContain('Summarize sample');
        expect(readyPanel.text()).toContain('the package sample');
        expect(readyPanel.findAll('button')).toHaveLength(1);
    })
});

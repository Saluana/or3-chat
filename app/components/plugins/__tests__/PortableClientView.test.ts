import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import type { PortableActivation } from '~/composables/plugins/portable-client-runtime';

/**
 * A plugin's registered dashboard contributions must reach a rendered surface:
 * recording them and rendering nothing made the advertised contribution API
 * produce invisible UI. Withdrawal has to hide them again.
 */
const invokeMock = vi.fn();
const prepareMock = vi.fn();
const executeMock = vi.fn();
const ensureMock = vi.fn();
const activateMock = vi.fn();
const scheduleRecoveryMock = vi.fn();
const sourceMock = vi.fn();
const getDocumentInDbMock = vi.fn();
const activations = reactive(new Map<string, unknown>());
const routeQuery: Record<string, unknown> = {};
const fetchMock = vi.fn();
const navigateToMock = vi.fn();
const drafts = new Map<string, { values: Record<string, string | boolean>; dirty: Set<string> }>();

vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    activatePortableClient: (...args: unknown[]) => activateMock(...args),
    usePortableActivations: () => activations,
    invokePortableUiEvent: (...args: unknown[]) => invokeMock(...args),
    ensurePortableClientActivation: (...args: unknown[]) => ensureMock(...args),
    schedulePortableClientRecovery: (...args: unknown[]) => scheduleRecoveryMock(...args),
    getPortableClientSource: (...args: unknown[]) => sourceMock(...args),
    getPortableClientDraft: (pluginId: string, workspaceId: string, surface: string) => {
        const key = `${workspaceId}:${pluginId}:${surface}`;
        if (!drafts.has(key)) drafts.set(key, { values: reactive({}), dirty: new Set() });
        return drafts.get(key);
    },
}));

vi.mock('~/composables/plugins/usePortableHostActions', () => ({
    usePortableHostActions: () => ({
        prepare: (...args: unknown[]) => prepareMock(...args),
        execute: (...args: unknown[]) => executeMock(...args),
        run: vi.fn(),
    }),
}));

vi.mock('~/db/documents', () => ({
    getDocumentInDb: (...args: unknown[]) => getDocumentInDbMock(...args),
}));

vi.mock('~/db/client', () => ({
    getWorkspaceDb: () => ({ name: 'or3-db-ws-1' }),
}));

vi.mock('#imports', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useRoute: () => ({ query: routeQuery }),
    useToast: () => ({ add: vi.fn() }),
    navigateTo: (...args: unknown[]) => navigateToMock(...args),
    $fetch: (...args: unknown[]) => fetchMock(...args),
    useRuntimeConfig: () => ({ public: {} }),
}));

import PortableUiTree from '../PortableUiTree.vue';
import PortableClientView from '../PortableClientView.vue';

function prepared(overrides: Record<string, unknown> = {}) {
    return {
        action: 'host.document.create',
        plan: { kind: 'create-document', title: 'Result', content: '# Result', requiresConfirmation: false },
        pluginId: 'sample.plugin',
        workspaceId: 'ws-1',
        generation: 1,
        documentRevision: null,
        requiresConfirmation: false,
        ...overrides,
    };
}

beforeEach(() => {
    drafts.clear();
    invokeMock.mockReset();
    prepareMock.mockReset();
    executeMock.mockReset();
    ensureMock.mockReset();
    activateMock.mockReset();
    activateMock.mockResolvedValue(activation());
    scheduleRecoveryMock.mockReset();
    sourceMock.mockReset();
    getDocumentInDbMock.mockReset();
    fetchMock.mockReset();
    navigateToMock.mockReset();
    getDocumentInDbMock.mockResolvedValue({
        id: 'doc_from_handle',
        title: 'Doc One',
        updated_at: 10,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selected text' }] }] },
    });
    prepareMock.mockResolvedValue({ ok: true, prepared: prepared() });
    executeMock.mockResolvedValue({
        ok: true,
        outcome: { status: 'created-document', documentId: 'doc_new' },
    });
    ensureMock.mockResolvedValue(null);
    sourceMock.mockReturnValue(null);
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
        approvedGrants: ['documents.read', 'documents.write'],
        logs: [],
        crashed: false,
        startedAt: 0,
        ...overrides,
    } as PortableActivation;
}

const stubs = {
    UIcon: { template: '<i />' },
    UModal: {
        props: ['open', 'title', 'description'],
        emits: ['update:open'],
        template:
            '<div v-if="open" role="dialog" aria-modal="true"><h2 v-if="title">{{ title }}</h2><p v-if="description">{{ description }}</p><slot name="body" /></div>',
    },
    UBadge: { template: '<span><slot /></span>' },
    UAlert: { props: ['title', 'description'], template: '<div role="alert">{{ title }}</div>' },
    UTextarea: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UInput: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
};

// Nuxt auto-imports the renderer in the app; a unit mount has to register it.
const global = { stubs };

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
        await Promise.resolve();
        expect(prepareMock).toHaveBeenCalledWith(
            expect.objectContaining({ pluginId: 'sample.plugin', action: 'host.document.create' })
        );
        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'host.document.create' }));
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('requires confirmation before replacing the selected document', async () => {
        routeQuery.documentId = 'doc_1';
        prepareMock.mockResolvedValue({
            ok: true,
            prepared: prepared({
                action: 'host.document.replace',
                plan: {
                    kind: 'replace-document',
                    documentId: 'doc_1',
                    title: null,
                    content: '# New',
                    requiresConfirmation: true,
                },
                requiresConfirmation: true,
                documentRevision: 'rev-1',
            }),
        });
        const wrapper = shell([
            { type: 'button', id: 'replace', label: 'Replace document', action: 'host.document.replace' },
        ]);
        await wrapper.get('button[data-action="host.document.replace"]').trigger('click');
        await Promise.resolve();
        // Nothing is written until the host confirmation is answered.
        expect(executeMock).not.toHaveBeenCalled();
        const dialog = wrapper.get('[role="dialog"]');
        expect(dialog.text()).toContain('Replace selected document');

        const confirm = wrapper
            .get('[data-testid="portable-host-confirm"]')
            .findAll('button')
            .find((button) => button.text().includes('Replace'));
        await confirm?.trigger('click');
        await Promise.resolve();
        // The exact frozen plan is executed; the plugin is not asked again.
        expect(executeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'host.document.replace',
                documentRevision: 'rev-1',
            })
        );
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('runs only one host action while a previous one is still preparing', async () => {
        let resolvePrepare: (value: unknown) => void = () => undefined;
        prepareMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolvePrepare = resolve;
                })
        );
        const wrapper = shell([
            { type: 'button', id: 'save', label: 'Create document', action: 'host.document.create' },
        ]);
        const button = wrapper.get('button[data-action="host.document.create"]');
        await button.trigger('click');
        await button.trigger('click');
        await button.trigger('click');
        expect(prepareMock).toHaveBeenCalledTimes(1);
        resolvePrepare({ ok: true, prepared: prepared() });
        await flushPromises();
        expect(executeMock).toHaveBeenCalledTimes(1);
    })

    it('disables the plugin tree while a confirmation is pending', async () => {
        routeQuery.documentId = 'doc_1';
        prepareMock.mockResolvedValue({
            ok: true,
            prepared: prepared({
                action: 'host.document.replace',
                plan: {
                    kind: 'replace-document',
                    documentId: 'doc_1',
                    title: null,
                    content: '# New',
                    requiresConfirmation: true,
                },
                requiresConfirmation: true,
                documentRevision: 'rev-1',
            }),
        });
        const wrapper = shell([
            { type: 'button', id: 'run', label: 'Run', action: 'plugin.run' },
            { type: 'button', id: 'replace', label: 'Replace', action: 'host.document.replace' },
        ]);
        expect(wrapper.get('button[data-action="plugin.run"]').attributes('disabled')).toBeUndefined();
        await wrapper.get('button[data-action="host.document.replace"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="portable-host-confirm"]').exists()).toBe(true);
        expect(wrapper.get('button[data-action="plugin.run"]').attributes('disabled')).toBeDefined();
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('keeps typed fields and offers restart after a stopped activation', async () => {
        sourceMock.mockReturnValue({ descriptor: {}, workspaceId: 'ws-1', runtimeEntry: undefined });
        activations.set(
            'sample.plugin',
            activation({
                status: 'stopped',
                blockCode: 'activation-expired',
                blockMessage: "This plugin's contained session expired. Your typed values are kept below.",
                view: {
                    title: null,
                    nodes: [
                        { type: 'field.textarea', id: 'notes', label: 'Notes', value: 'kept' },
                    ],
                } as never,
            })
        );
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
        await flushPromises();
        // The tree survives the stop (disabled) so typed values are still there.
        expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('kept');
        expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
        // A stale stop explains itself instead of the generic ended text.
        expect(wrapper.get('[data-testid="portable-plugin-stopped"]').text()).toContain('expired');

        await wrapper.get('[data-testid="portable-plugin-stopped"] button').trigger('click');
        await flushPromises();
        expect(activateMock).toHaveBeenCalledWith(sourceMock.mock.results[0]!.value);
    })

    it('refuses a host write when the activation lacks write authority', async () => {
        prepareMock.mockResolvedValue({
            ok: false,
            code: 'write-authority-required',
            message: 'This plugin has not been approved to create or replace documents.',
        });
        const wrapper = shell([
            { type: 'button', id: 'save', label: 'Create document', action: 'host.document.create' },
        ]);
        await wrapper.get('button[data-action="host.document.create"]').trigger('click');
        await Promise.resolve();
        expect(executeMock).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('refuses an unknown host action instead of forwarding it', async () => {
        const wrapper = shell([
            { type: 'button', id: 'odd', label: 'Do odd thing', action: 'host.something.else' },
        ]);
        await wrapper.get('button[data-action="host.something.else"]').trigger('click');
        expect(prepareMock).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalled();
    })

    it('renders canonical host wording for reserved action buttons', () => {
        const wrapper = shell([
            { type: 'button', id: 'save', label: 'Totally not a write', action: 'host.document.create' },
        ]);
        const button = wrapper.get('button[data-action="host.document.create"]');
        expect(button.text()).toBe('Create document');
    })

    it('opens the document a host action wrote', async () => {
        executeMock.mockResolvedValue({
            ok: true,
            outcome: { status: 'created-document', documentId: 'doc_new' },
        });
        const wrapper = shell([
            { type: 'button', id: 'save', label: 'Create document', action: 'host.document.create' },
        ]);
        await wrapper.get('button[data-action="host.document.create"]').trigger('click');
        await Promise.resolve();
        await Promise.resolve();
        expect(navigateToMock).toHaveBeenCalledWith('/docs/doc_new');
    })

    it('opens a document through host navigation in the activation workspace', async () => {
        const wrapper = shell([
            { type: 'open-document', label: 'Open doc', documentId: 'doc_9' },
        ]);
        await wrapper.findAll('button').find((button) => button.text() === 'Open doc')!.trigger('click');
        await flushPromises();
        expect(getDocumentInDbMock).toHaveBeenCalledWith(expect.anything(), 'doc_9');
        expect(navigateToMock).toHaveBeenCalledWith('/docs/doc_9');
    });

    it.each(['unmount', 'revoke', 'replace'] as const)('drops pending document navigation after %s', async (change) => {
        let release!: (value: unknown) => void;
        getDocumentInDbMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const wrapper = shell([{ type: 'open-document', label: 'Open doc', documentId: 'doc_9' }]);
        await wrapper.findAll('button').find((button) => button.text() === 'Open doc')!.trigger('click');
        if (change === 'unmount') wrapper.unmount();
        else if (change === 'revoke') Object.assign(activations.get('sample.plugin') as object, { approvedGrants: [] });
        else activations.set('sample.plugin', activation({ generation: 2 }));
        release({ id: 'doc_9' });
        await flushPromises();
        expect(navigateToMock).not.toHaveBeenCalled();
        if (change !== 'unmount') wrapper.unmount();
    });

    it('refuses open-document navigation without the read grant', async () => {
        activations.set(
            'sample.plugin',
            activation({
                approvedGrants: [],
                view: {
                    title: null,
                    nodes: [{ type: 'open-document', label: 'Open doc', documentId: 'doc_9' }],
                } as never,
            })
        );
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
        await wrapper.findAll('button').find((button) => button.text() === 'Open doc')!.trigger('click');
        await flushPromises();
        expect(getDocumentInDbMock).not.toHaveBeenCalled();
        expect(navigateToMock).not.toHaveBeenCalled();
    });

    it('discards a pending plugin reply after its activation is replaced', async () => {
        let release!: (value: unknown) => void;
        invokeMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const wrapper = shell([
            { type: 'field.textarea', id: 'notes', label: 'Notes', value: 'old' },
            { type: 'button', id: 'load', label: 'Load', action: 'plugin.load' },
        ]);
        await wrapper.get('button[data-action="plugin.load"]').trigger('click');
        activations.set('sample.plugin', activation({ generation: 2, view: {
            title: null, nodes: [{ type: 'field.textarea', id: 'notes', label: 'Notes', value: 'replacement' }],
        } as never }));
        await flushPromises();
        release({ ok: true, result: { fieldValues: { notes: 'stale reply' } } });
        await flushPromises();
        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('replacement');
        wrapper.unmount();
    });

    it('refuses a document that has been deleted', async () => {
        getDocumentInDbMock.mockResolvedValue({ id: 'doc_9', deleted: true });
        const wrapper = shell([{ type: 'open-document', label: 'Open doc', documentId: 'doc_9' }]);
        await wrapper.findAll('button').find((button) => button.text() === 'Open doc')!.trigger('click');
        await flushPromises();
        expect(navigateToMock).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('applies a plugin field replacement even to a field the user edited', async () => {
        invokeMock.mockResolvedValue({
            ok: true,
            result: { fieldValues: { notes: 'Loaded preset' } },
        });
        const wrapper = shell([
            { type: 'field.textarea', id: 'notes', label: 'Notes', value: 'typed' },
            { type: 'button', id: 'load', label: 'Load', action: 'plugin.load' },
        ]);
        const textarea = wrapper.get('textarea');
        await textarea.setValue('user typed this');
        await wrapper.get('button[data-action="plugin.load"]').trigger('click');
        await Promise.resolve();
        expect(invokeMock).toHaveBeenCalled();
        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Loaded preset');
    })

    it('still forwards ordinary plugin actions to the plugin', async () => {
        invokeMock.mockResolvedValue({ ok: true, result: {} });
        const wrapper = shell([
            { type: 'button', id: 'run', label: 'Run', action: 'compare.run' },
        ]);
        await wrapper.get('button[data-action="compare.run"]').trigger('click');
        await Promise.resolve();
        expect(invokeMock).toHaveBeenCalledWith('sample.plugin', expect.objectContaining({ action: 'compare.run' }), expect.objectContaining({ workspaceId: 'ws-1', generation: 1 }));
        expect(prepareMock).not.toHaveBeenCalled();
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

    it('does not present a selection shortcut as a blocker for an already-rendered interface', async () => {
        fetchMock.mockResolvedValue({
            firstAction: { label: 'Open tasks', ready: false, reasonCode: 'selection-required', reason: 'Select a document' },
        });
        const wrapper = shell([{ type: 'button', id: 'create', label: 'Create list', action: 'tasks.create-list' }]);
        await flushPromises();
        expect(wrapper.find('[data-testid="portable-plugin-first-action"]').exists()).toBe(false);
        expect(wrapper.get('button[data-action="tasks.create-list"]').text()).toBe('Create list');
    });

    it('resolves a selected-context first action through the host handle and read grant', async () => {
        routeQuery.documentId = 'doc_1';
        activations.set(
            'sample.plugin',
            activation({ view: { title: null, nodes: [] } as never })
        );
        fetchMock
            .mockResolvedValueOnce({
                firstAction: { label: 'Summarize selection', ready: true, contextKind: 'selected' },
            })
            .mockResolvedValueOnce({
                status: 'ready',
                handle: {
                    handleId: 'sel_1_1',
                    kind: 'document',
                    generation: 1,
                    contextId: 'doc_from_handle',
                },
            });
        invokeMock.mockResolvedValue({ ok: true, result: {} });
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
        await flushPromises();
        await wrapper.get('[data-testid="portable-plugin-first-action"] button').trigger('click');
        await flushPromises();
        const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('first-action'));
        expect(call).toBeTruthy();
        expect((call?.[1] as { body?: unknown })?.body).toMatchObject({
            documentId: 'doc_1',
            generation: 1,
        });
        // The host reads exactly the server-authorized handle context, never the
        // route query again.
        expect(getDocumentInDbMock).toHaveBeenCalledWith(expect.anything(), 'doc_from_handle');
        expect(invokeMock).toHaveBeenCalledWith(
            'sample.plugin',
            expect.objectContaining({
                action: 'host.first-action.run',
                context: expect.objectContaining({ kind: 'selected', content: 'Selected text' }),
            }),
            expect.objectContaining({ workspaceId: 'ws-1', generation: 1 })
        );
    })
});


describe('portable surface recovery', () => {
    it('shows the main view in the sidebar when the plugin has no navigation tree', () => {
        activations.set('sample.plugin', activation({
            view: { title: null, nodes: [{ type: 'text', text: 'My tasks' }], navigation: [] },
        }));
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin', surface: 'sidebar' }, global });
        expect(wrapper.text()).toContain('My tasks');
        expect(wrapper.text()).not.toContain('has not rendered');
    });

    it('keeps a draft across a plugin view-key change instead of remounting it away', async () => {
        activations.set(
            'sample.plugin',
            activation({
                view: {
                    key: 'v1',
                    title: null,
                    nodes: [{ type: 'field.textarea', id: 'notes', label: 'Notes', value: 'declared' }],
                } as never,
            })
        );
        const wrapper = mount(PortableClientView, {
            props: { pluginId: 'sample.plugin', surface: 'pane' },
            global,
        });
        await flushPromises();
        await wrapper.get('textarea').setValue('typed');

        activations.set(
            'sample.plugin',
            activation({
                view: {
                    key: 'v2',
                    title: null,
                    nodes: [{ type: 'field.textarea', id: 'notes', label: 'Notes', value: 'declared' }],
                } as never,
            })
        );
        await flushPromises();
        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('typed');
    });

    it('preserves edited fields across unmount and remount, isolated by workspace', async () => {
        const view = { title: null, nodes: [{ type: 'field.textarea', id: 'notes', label: 'Notes', value: 'declared' }] };
        activations.set('sample.plugin', activation({ view: view as never }));
        let wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin', surface: 'pane' }, global });
        await flushPromises();
        await wrapper.get('textarea').setValue('draft');
        wrapper.unmount();
        wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin', surface: 'pane' }, global });
        await flushPromises();
        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('draft');
        activations.set('sample.plugin', activation({ workspaceId: 'ws-2', view: view as never }));
        await flushPromises();
        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('declared');
        wrapper.unmount();
    });

    it('restores the current tree after a source refresh without requiring another render event', async () => {
        const source = ref({ descriptor: { descriptorKey: 'old' }, workspaceId: 'ws-1' });
        sourceMock.mockImplementation(() => source.value);
        activations.set('sample.plugin', activation({
            view: { title: null, nodes: [{ type: 'text', text: 'My tasks' }] },
        }));
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
        await flushPromises();
        source.value = { descriptor: { descriptorKey: 'new' }, workspaceId: 'ws-1' };
        await flushPromises();
        expect(wrapper.text()).toContain('My tasks');
        expect(wrapper.text()).not.toContain('has not rendered');
    });

    it('restarts an active plugin that has not rendered a view', async () => {
        activations.set('sample.plugin', activation());
        sourceMock.mockReturnValue({ descriptor: {}, workspaceId: 'ws-1' });
        const wrapper = mount(PortableClientView, { props: { pluginId: 'sample.plugin' }, global });
        await flushPromises();
        await wrapper.findAll('button').find((button) => button.text() === 'Restart plugin')!.trigger('click');
        await flushPromises();
        expect(activateMock).toHaveBeenCalledOnce();
    });
});

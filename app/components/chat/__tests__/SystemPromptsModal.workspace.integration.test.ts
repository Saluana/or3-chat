import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { getWorkspaceDb, setActiveWorkspaceDb, evictWorkspaceDb, type Or3DB } from '~/db/client';
import { getDefaultPromptId, useDefaultPrompt } from '~/composables/chat/useDefaultPrompt';
import * as savedPrompts from '~/db/prompts';
import SystemPromptsModal from '../SystemPromptsModal.vue';
import AppModal from '~/components/ui/AppModal.vue';

vi.mock('#imports', async original => ({
    ...await original<typeof import('#imports')>(), useHooks: () => useHooks(),
}));
vi.mock('~/composables/core/usePanePrompt', () => ({
    clearPanePendingPrompt: vi.fn(),
    getPanePendingPrompt: vi.fn(() => null),
    setPanePendingPrompt: vi.fn(),
}));

vi.mock('~/composables/chat/useActivePrompt', () => ({
    useActivePrompt: () => ({
        activePromptId: ref(null),
        clearActivePrompt: vi.fn(),
    }),
}));

vi.mock('~/composables/core/useTokenizer', () => ({
    useTokenizer: () => ({
        countTokensBatch: vi.fn(async (items: Array<{ key: string }>) =>
            Object.fromEntries(items.map((item) => [item.key, 3]))
        ),
    }),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({}),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

const stubs = {
    DialogTitle: { template: '<h2><slot /></h2>' },
    DialogDescription: { template: '<p><slot /></p>' },
    UModal: {
        props: ['open'],
        template:
            '<div class="modal-stub"><slot name="header" /><slot name="body" /></div>',
    },
    UButton: {
        inheritAttrs: false,
        emits: ['click'],
        template:
            '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
    },
    UInput: {
        props: ['modelValue', 'size'],
        emits: ['update:modelValue'],
        template:
            '<input :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    USelectMenu: {
        template: '<select />',
    },
    UPopover: {
        template: '<div><slot /><slot name="content" /></div>',
    },
    UDropdownMenu: {
        template: '<div><slot /></div>',
    },
    UIcon: {
        template: '<i />',
    },
    LazyPromptsPromptEditor: {
        template: '<div class="editor-stub" />',
    },
};


const databases: Array<{ id: string; db: Or3DB }> = [];
let wrapper: VueWrapper | undefined;
function modalState() {
    return (wrapper!.vm.$ as unknown as { setupState: {
        loading: boolean; errorMessage: string; loadPrompts: () => Promise<void>;
        loadSelectionContext: () => Promise<void>; threadPromptId: string | null;
        startEditing: (id: string) => Promise<void>; stopEditing: () => Promise<void>;
        editingPromptId: string | null; view: string;
    } }).setupState;
}
afterEach(async () => {
    wrapper?.unmount(); wrapper = undefined;
    vi.restoreAllMocks(); setActiveWorkspaceDb(null);
    for (const { id, db } of databases.splice(0)) {
        evictWorkspaceDb(id); await Dexie.delete(db.name);
    }
    setHookEngine(null);
});
async function fixture(label: string, promptId = `${label}-prompt`) {
    const id = `prompt-library-${label}-${crypto.randomUUID()}`;
    const db = getWorkspaceDb(id);
    databases.push({ id, db });
    await db.posts.put({ id: promptId, title: `${label} synthetic saved prompt`,
        postType: 'prompt', content: JSON.stringify({ type: 'doc', content: [] }),
        created_at: 1, updated_at: 1, clock: 1, deleted: false });
    await db.kv.put({ id: 'same-default-row', name: 'default_system_prompt_id',
        value: promptId, created_at: 1, updated_at: 1, clock: 1, deleted: false });
    return { id, db, promptId };
}

describe('prompt library workspace continuation with real saved prompts', () => {
    it.each(['switch', 'close', 'return'] as const)('does not clear a destination default after a captured origin list finishes (%s)', async transition => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A'); const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        const defaults = useDefaultPrompt(); await defaults.ensureLoaded();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        useHooks().addFilter('db.prompts.list:filter:output', async records => {
            if (records.some(record => record.id === origin.promptId)) {
                entered(); await gate;
            }
            return records;
        });
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        // Also admit an explicit library refresh so its complete continuation
        // is awaitable even when a switch synchronously resets the spinner.
        const refreshing = modalState().loadPrompts();
        await reached;
        setActiveWorkspaceDb(target.id); await defaults.ensureLoaded();
        if (transition === 'return') { setActiveWorkspaceDb(origin.id); await defaults.ensureLoaded(); }
        if (transition === 'close') await wrapper.setProps({ showModal: false });
        try {
            release();
            await refreshing; await flushPromises();
        }
        finally { release(); await refreshing; }
        expect((await target.db.kv.get('same-default-row'))?.value).toBe(target.promptId);
        const currentId = transition === 'return' ? origin.promptId : target.promptId;
        expect(await getDefaultPromptId()).toBe(currentId);
        expect(defaults.defaultPromptId.value).toBe(currentId);
        if (transition !== 'close') {
            expect(wrapper.text()).not.toContain('A synthetic saved prompt');
        }
        expect(wrapper.emitted('update:showModal') ?? []).toContainEqual([false]);
    });

    it.each(['valid', 'missing'] as const)('keeps current-workspace library and default repair behavior (%s)', async selection => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        if (selection === 'missing') await current.db.kv.update('same-default-row', { value: 'missing-prompt' });
        setActiveWorkspaceDb(current.id);
        const defaults = useDefaultPrompt(); await defaults.ensureLoaded();
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        await vi.waitFor(async () => {
            await flushPromises();
            expect(modalState().loading).toBe(false);
        });
        expect(wrapper.text()).toContain('Current synthetic saved prompt');
        expect(await getDefaultPromptId()).toBe(selection === 'valid' ? current.promptId : null);
        expect(wrapper.emitted('update:showModal')).toBeUndefined();
    });

    it.each(['switch', 'close', 'dispose'] as const)('does not publish a captured origin library failure after %s', async transition => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A'); const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        const defaults = useDefaultPrompt(); await defaults.ensureLoaded();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        const list = savedPrompts.listPrompts;
        vi.spyOn(savedPrompts, 'listPrompts').mockImplementation(async limit => {
            await list(limit); entered(); await gate;
            throw new Error('Synthetic captured A library failure');
        });
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        const state = modalState(); const refreshing = state.loadPrompts();
        await reached;
        if (transition === 'switch') { setActiveWorkspaceDb(target.id); await defaults.ensureLoaded(); }
        else if (transition === 'close') await wrapper.setProps({ showModal: false });
        else { wrapper.unmount(); wrapper = undefined; }
        try { release(); await refreshing; await flushPromises(); }
        finally { release(); await refreshing; }
        expect(state.errorMessage).toBe('');
        if (transition !== 'dispose') expect(state.loading).toBe(false);
        expect(await getDefaultPromptId()).toBe(transition === 'switch' ? target.promptId : origin.promptId);
    });

    it('reports a current library failure and preserves its committed default', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current'); setActiveWorkspaceDb(current.id);
        const defaults = useDefaultPrompt(); await defaults.ensureLoaded();
        const list = savedPrompts.listPrompts;
        vi.spyOn(savedPrompts, 'listPrompts').mockImplementation(async limit => {
            await list(limit); throw new Error('Synthetic current library failure');
        });
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        await modalState().loadPrompts(); await flushPromises();
        expect(modalState().errorMessage).toBe('Synthetic current library failure');
        expect(modalState().loading).toBe(false);
        expect(await getDefaultPromptId()).toBe(current.promptId);
    });

    it('ignores a refresh admitted after the dialog has closed', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current'); setActiveWorkspaceDb(current.id);
        const list = vi.spyOn(savedPrompts, 'listPrompts');
        wrapper = mount(SystemPromptsModal, { props: { showModal: false, mode: 'home' }, global: { stubs } });
        await modalState().loadPrompts();
        expect(list).not.toHaveBeenCalled();
        expect(modalState().loading).toBe(false);
    });

    it('does not restore an old delete confirmation when the new library has the same prompt ID', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A', 'shared-prompt');
        const target = await fixture('B', 'shared-prompt');
        setActiveWorkspaceDb(origin.id);
        const defaults = useDefaultPrompt(); await defaults.ensureLoaded();
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        await modalState().loadPrompts(); await flushPromises();
        await wrapper.findAll('button').find(button => button.text() === 'Delete')!.trigger('click');
        expect(wrapper.findAllComponents(AppModal)[1]!.props('open')).toBe(true);
        setActiveWorkspaceDb(target.id); await defaults.ensureLoaded();
        await wrapper.setProps({ showModal: false });
        await wrapper.setProps({ showModal: true });
        await modalState().loadPrompts(); await flushPromises();
        expect(wrapper.text()).toContain('B synthetic saved prompt');
        expect(wrapper.findAllComponents(AppModal)[1]!.props('open')).toBe(false);
        expect((await target.db.posts.get('shared-prompt'))?.deleted).toBe(false);
    });

    it.each(['switch', 'return'] as const)('does not replace fresh selection context with a captured former request (%s)', async transition => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A'); const target = await fixture('B');
        for (const item of [origin, target]) await item.db.threads.put({ id: 'identical-modal-thread',
            title: 'Synthetic modal thread', system_prompt_id: item.promptId,
            created_at: 1, updated_at: 1, clock: 1, deleted: false,
            status: 'ready', pinned: false, forked: false });
        setActiveWorkspaceDb(origin.id);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        useHooks().addFilter('db.threads.getSystemPrompt:filter:output', async id => {
            if (id === origin.promptId) { entered(); await gate; }
            return id;
        });
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home', threadId: 'identical-modal-thread' }, global: { stubs } });
        const oldContext = modalState().loadSelectionContext(); await reached;
        setActiveWorkspaceDb(target.id);
        if (transition === 'return') {
            await origin.db.threads.update('identical-modal-thread', { system_prompt_id: 'A-refreshed-selection' });
            setActiveWorkspaceDb(origin.id);
        }
        await wrapper.setProps({ showModal: false }); await wrapper.setProps({ showModal: true });
        const expected = transition === 'return' ? 'A-refreshed-selection' : target.promptId;
        try {
            await modalState().loadSelectionContext();
            expect(modalState().threadPromptId).toBe(expected);
            release(); await oldContext; await flushPromises();
            expect(modalState().threadPromptId).toBe(expected);
        } finally { release(); await oldContext; }
    });

    it.each(['current', 'switch'] as const)('keeps leaving edit view in its admitted modal context (%s)', async transition => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A'); const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        wrapper = mount(SystemPromptsModal, { props: { showModal: true, mode: 'home' }, global: { stubs } });
        await modalState().loadPrompts(); await modalState().startEditing(origin.promptId);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        useHooks().addFilter('db.prompts.list:filter:output', async records => {
            if (records.some(record => record.id === origin.promptId)) { entered(); await gate; }
            return records;
        });
        const stopping = modalState().stopEditing(); await reached;
        try {
            if (transition === 'switch') {
                setActiveWorkspaceDb(target.id);
                await wrapper.setProps({ showModal: false }); await wrapper.setProps({ showModal: true });
                await modalState().loadPrompts(); await modalState().startEditing(target.promptId);
            }
            release(); await stopping; await flushPromises();
            expect(modalState().editingPromptId).toBe(transition === 'switch' ? target.promptId : null);
            expect(modalState().view).toBe(transition === 'switch' ? 'edit' : 'detail');
        } finally { release(); await stopping; }
    });
});

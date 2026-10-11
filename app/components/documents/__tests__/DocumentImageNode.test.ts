import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentImageNode from '../DocumentImageNode.vue';

const state = vi.hoisted(() => ({ db: { name: 'synthetic-owner' }, generation: 0,
    listeners: new Set<() => void>(), account: null as { value: string } | null,
    read: vi.fn() }));
vi.mock('~/db/files', () => ({ getFileBlob: (...args: unknown[]) => state.read(...args) }));
vi.mock('~/db/client', () => ({ getDb: () => state.db, getWorkspaceGeneration: () => state.generation,
    subscribeActiveWorkspaceDb: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); } }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => ({ user: { id: state.account?.value } }) }));
vi.mock('@tiptap/vue-3', () => ({ NodeViewWrapper: defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()); } }) }));

function deferred() { let resolve!: (blob: Blob | undefined) => void; let reject!: (error: Error) => void;
    const promise = new Promise<Blob | undefined>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject }; }
function node(hash: string) { return { attrs: { hash } }; }
function mountNode(hash = 'synthetic-hash') { return mount(DocumentImageNode, { props: {
    node: node(hash), selected: false, updateAttributes: vi.fn(), deleteNode: vi.fn(),
    editor: {}, extension: {}, view: {}, getPos: () => 0, decorations: [], innerDecorations: {}, HTMLAttributes: {},
} as never, global: { stubs: { UInput: true, USlider: true, UButton: true } } }); }

beforeEach(() => { state.db = { name: 'synthetic-owner' }; state.generation = 0;
    state.account = ref('synthetic-account-a'); state.listeners.clear(); state.read.mockReset();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:synthetic-image'), revokeObjectURL: vi.fn() }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('document image read ownership', () => {
    it('does not create a URL after its node unmounts', async () => {
        const read = deferred(); state.read.mockReturnValue(read.promise);
        const wrapper = mountNode(); wrapper.unmount();
        read.resolve(new Blob(['synthetic-image'])); await flushPromises();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
    it('does not deliver a pending image after its workspace generation changes', async () => {
        const read = deferred(); state.read.mockReturnValue(read.promise);
        const wrapper = mountNode();
        state.db = { name: 'synthetic-other' }; state.generation++;
        for (const listener of state.listeners) listener();
        read.resolve(new Blob(['owner-a-image'])); await flushPromises();
        expect(wrapper.find('img').exists()).toBe(false);
        expect(URL.createObjectURL).not.toHaveBeenCalled(); wrapper.unmount();
    });
    it('does not deliver or retain an image after the account changes', async () => {
        const read = deferred(); state.read.mockReturnValue(read.promise);
        const wrapper = mountNode(); state.account!.value = 'synthetic-account-b'; await nextTick();
        read.resolve(new Blob(['account-a-image'])); await flushPromises();
        expect(URL.createObjectURL).not.toHaveBeenCalled(); wrapper.unmount();
    });
    it('keeps a newer read loading when an older read finishes', async () => {
        const older = deferred(); const newer = deferred(); state.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const wrapper = mountNode('older'); await wrapper.setProps({ node: node('newer') } as never);
        older.resolve(new Blob(['older'])); await flushPromises();
        expect(wrapper.text()).toContain('Loading image');
        newer.resolve(new Blob(['newer'])); await flushPromises();
        expect(wrapper.find('img').attributes('src')).toBe('blob:synthetic-image'); wrapper.unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-image');
    });
    it('revokes an already displayed image immediately when its account changes', async () => {
        state.read.mockResolvedValue(new Blob(['owner-image'])); const wrapper = mountNode(); await flushPromises();
        expect(wrapper.find('img').exists()).toBe(true);
        expect(state.read).toHaveBeenCalledWith('synthetic-hash', state.db);
        state.account!.value = 'synthetic-account-b'; await nextTick();
        expect(wrapper.find('img').exists()).toBe(false);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-image'); wrapper.unmount();
        expect(state.listeners.size).toBe(0);
    });
    it('rejects an older read even when the image hash changes away and back', async () => {
        const older = deferred(); const middle = deferred(); const latest = deferred();
        state.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(latest.promise);
        const wrapper = mountNode('same-hash'); await wrapper.setProps({ node: node('middle') } as never);
        await wrapper.setProps({ node: node('same-hash') } as never);
        older.resolve(new Blob(['older-version'])); await flushPromises();
        expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('Loading image');
        latest.resolve(new Blob(['current-version'])); await flushPromises();
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1); wrapper.unmount();
        middle.resolve(undefined); await flushPromises();
    });
    it('reports a read failure through the unavailable placeholder', async () => {
        state.read.mockRejectedValue(new DOMException('Synthetic interrupted read', 'AbortError'));
        const wrapper = mountNode(); await flushPromises();
        expect(wrapper.text()).toContain('Image unavailable'); expect(wrapper.text()).not.toContain('Loading image'); wrapper.unmount();
    });

});

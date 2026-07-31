import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReactive, toRaw } from 'vue';
import {
    loadAdminPlugins,
    registerAdminPage,
    registerAdminWidget,
    resolveAdminComponent,
    state,
    useAdminPages,
    useAdminWidgets,
} from '../admin/useAdminPlugins';
import { loadEditorExtensions } from '../editor/useEditorExtensionLoader';
import {
    listEditorExtensions,
    listEditorMarks,
    listEditorNodes,
    listRegisteredEditorExtensionIds,
    listRegisteredEditorMarkIds,
    listRegisteredEditorNodeIds,
    registerEditorExtension,
    registerEditorMark,
    registerEditorNode,
    unregisterEditorExtension,
    unregisterEditorMark,
    unregisterEditorNode,
} from '../editor/useEditorNodes';

describe('V1 editor extension registry profile', () => {
    beforeEach(() => {
        listRegisteredEditorNodeIds().forEach(unregisterEditorNode);
        listRegisteredEditorMarkIds().forEach(unregisterEditorMark);
        listRegisteredEditorExtensionIds().forEach(unregisterEditorExtension);
    });

    it('stores caller identity, replaces by ID, and returns void', () => {
        const oldNode = { id: 'same', extension: { name: 'old' } as never };
        const node = { id: 'same', extension: { name: 'new' } as never };
        const mark = { id: 'mark', extension: { name: 'mark' } as never };
        const extension = { id: 'extension', extension: { name: 'extension' } as never };
        registerEditorNode(oldNode);
        expect(registerEditorNode(node)).toBeUndefined();
        expect(registerEditorMark(mark)).toBeUndefined();
        expect(registerEditorExtension(extension)).toBeUndefined();
        expect(isReactive(listEditorNodes()[0])).toBe(true);
        expect(toRaw(listEditorNodes()[0]!)).toBe(node);
        expect(toRaw(listEditorMarks()[0]!)).toBe(mark);
        expect(toRaw(listEditorExtensions()[0]!)).toBe(extension);
        expect(toRaw(listEditorNodes()[0]!.extension)).toBe(node.extension);
        expect(Object.isFrozen(listEditorNodes()[0])).toBe(false);
    });

    it('defaults to order 200 and ties every family by ID', () => {
        registerEditorNode({ id: 'z-node', extension: {} as never });
        registerEditorNode({ id: 'a-node', extension: {} as never });
        registerEditorMark({ id: 'z-mark', extension: {} as never });
        registerEditorMark({ id: 'a-mark', extension: {} as never });
        registerEditorExtension({ id: 'z-extension', extension: {} as never });
        registerEditorExtension({ id: 'a-extension', extension: {} as never });
        expect(listEditorNodes().map((item) => item.id)).toEqual(['a-node', 'z-node']);
        expect(listEditorMarks().map((item) => item.id)).toEqual(['a-mark', 'z-mark']);
        expect(listEditorExtensions().map((item) => item.id)).toEqual(['a-extension', 'z-extension']);
    });

    it('loads sequentially, preserves resolved identity, and skips failures within each family', async () => {
        const calls: string[] = [];
        const node = { name: 'node' };
        const mark = { name: 'mark' };
        const extension = { name: 'extension' };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await loadEditorExtensions(
            [
                { id: 'node-fail', factory: async () => { calls.push('node-fail'); throw new Error('node'); } },
                { id: 'node-ok', factory: async () => { calls.push('node-ok'); return node as never; } },
            ],
            [
                { id: 'mark-ok', extension: mark as never, factory: async () => { throw new Error('unused'); } },
            ],
            [
                { id: 'extension-ok', factory: async () => { calls.push('extension-ok'); return extension as never; } },
            ]
        );
        expect(calls).toEqual(['node-fail', 'node-ok', 'extension-ok']);
        expect(result).toEqual({ nodes: [node], marks: [mark], extensions: [extension] });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('V1 admin extension profile', () => {
    beforeEach(() => {
        state.pages = [];
        state.widgets = [];
    });

    it('normalizes pages, replaces pages/widgets in place, defaults order to zero, and returns void', () => {
        registerAdminPage({ id: 'first', label: 'First', component: {} });
        registerAdminPage({ id: 'target', label: 'Old', component: {} });
        registerAdminPage({ id: 'last', label: 'Last', component: {} });
        expect(registerAdminPage({ id: 'target', label: 'New', component: {} })).toBeUndefined();
        registerAdminWidget({ id: 'first-widget', slot: 'overview', component: {} });
        registerAdminWidget({ id: 'target-widget', slot: 'overview', component: {} });
        expect(registerAdminWidget({ id: 'target-widget', slot: 'system', component: {} })).toBeUndefined();

        expect(state.pages.map((page) => page.id)).toEqual(['first', 'target', 'last']);
        expect(state.pages[1]).toMatchObject({ label: 'New', path: 'target' });
        expect(useAdminPages().value.map((page) => page.id)).toEqual(['first', 'target', 'last']);
        expect(state.widgets.map((widget) => widget.id)).toEqual(['first-widget', 'target-widget']);
        expect(useAdminWidgets().value.map((widget) => widget.id)).toEqual(['first-widget', 'target-widget']);
    });

    it('caches by shared ID without replacement invalidation', () => {
        const first = resolveAdminComponent({ id: 'profile-cache-shared', component: async () => ({ name: 'Old' }) });
        const replacement = resolveAdminComponent({ id: 'profile-cache-shared', component: async () => ({ name: 'New' }) });
        expect(replacement).toBe(first);
    });

    it('bounds the async component cache to 50 entries with FIFO insertion eviction', () => {
        const prefix = `profile-bound-${crypto.randomUUID()}`;
        const firstDef = { id: `${prefix}-0`, component: async () => ({ name: 'First' }) };
        const first = resolveAdminComponent(firstDef);
        let last: unknown;
        let lastDef = firstDef;
        for (let index = 1; index <= 51; index++) {
            lastDef = { id: `${prefix}-${index}`, component: async () => ({ name: `Item${index}` }) };
            last = resolveAdminComponent(lastDef);
        }
        expect(resolveAdminComponent(firstDef)).not.toBe(first);
        expect(resolveAdminComponent(lastDef)).toBe(last);
    });

    it('freezes loaded-once discovery and per-plugin failure continuation in source and callable behavior', async () => {
        await expect(loadAdminPlugins()).resolves.toBeUndefined();
        await expect(loadAdminPlugins()).resolves.toBeUndefined();
        const source = readFileSync(resolve(process.cwd(), 'app/composables/admin/useAdminPlugins.ts'), 'utf8');
        expect(source).toContain('if (loaded.value) return');
        expect(source).toContain('loaded.value = true');
        expect(source).toContain("console.error('[admin-plugins] Failed to load admin plugin'");
    });
});

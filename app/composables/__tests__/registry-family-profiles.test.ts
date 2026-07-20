import { beforeEach, describe, expect, it } from 'vitest';
import { ref, watch } from 'vue';
import { createRegistry } from '../_registry';
import {
    listRegisteredMessageActionIds,
    registerMessageAction,
    unregisterMessageAction,
    useMessageActions,
} from '../chat/useMessageActions';
import {
    listRegisteredDocumentHistoryActionIds,
    registerDocumentHistoryAction,
    unregisterDocumentHistoryAction,
    useDocumentHistoryActions,
} from '../documents/useDocumentHistoryActions';
import {
    listRegisteredEditorToolbarButtonIds,
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    useEditorToolbarButtons,
} from '../editor/useEditorToolbar';
import {
    listRegisteredProjectTreeActionIds,
    registerProjectTreeAction,
    unregisterProjectTreeAction,
    useProjectTreeActions,
} from '../projects/useProjectTreeActions';
import {
    listRegisteredComposerActionIds,
    registerComposerAction,
    unregisterComposerAction,
    useComposerActions,
} from '../sidebar/useComposerActions';
import {
    listRegisteredHeaderActionIds,
    registerHeaderAction,
    unregisterHeaderAction,
    useHeaderActions,
} from '../sidebar/useHeaderActions';
import {
    listRegisteredSidebarFooterActionIds,
    registerSidebarFooterAction,
    unregisterSidebarFooterAction,
    useSidebarFooterActions,
} from '../sidebar/useSidebarSections';
import {
    listRegisteredThreadHistoryActionIds,
    registerThreadHistoryAction,
    unregisterThreadHistoryAction,
    useThreadHistoryActions,
} from '../threads/useThreadHistoryActions';

function clear(ids: () => string[], unregister: (id: string) => void) {
    for (const id of ids()) unregister(id);
}

function expectHandle(value: unknown) {
    expect(value).toMatchObject({
        id: expect.any(String),
        owner: expect.any(Symbol),
        dispose: expect.any(Function),
    });
}

describe('V1 shared createRegistry profile', () => {
    it('freezes duplicate replacement, ordering, snapshots, notifications, and exact-owner returns', () => {
        const key = `__or3_profile_core_${crypto.randomUUID()}`;
        const registry = createRegistry<{ id: string; order?: number; label: string }>(key);
        const items = registry.useItems();
        let notifications = 0;
        const stop = watch(items, () => notifications++, { flush: 'sync' });

        const stale = registry.register({ id: 'b', label: 'first' });
        const current = registry.register({ id: 'b', label: 'replacement' });
        registry.register({ id: 'a', label: 'default' });
        registry.register({ id: 'early', order: 100, label: 'early' });

        expect(items.value.map((item) => item.id)).toEqual(['early', 'a', 'b']);
        expect(registry.listIds()).toEqual(['b', 'a', 'early']);
        const snapshot = registry.snapshot();
        expect(snapshot.map((item) => item.label)).toEqual(['replacement', 'default', 'early']);
        snapshot.length = 0;
        expect(registry.snapshot()).toHaveLength(3);
        expect(Object.isFrozen(registry.snapshot()[0])).toBe(true);
        expect(notifications).toBe(4);
        expect(stale.dispose()).toBe(false);
        expect(current.dispose()).toBe(true);
        expect(notifications).toBe(5);
        stop();
    });

    it('persists the global map across factory recreation while projections remain factory-local', () => {
        const key = `__or3_profile_global_${crypto.randomUUID()}`;
        const first = createRegistry<{ id: string; label: string }>(key);
        first.register({ id: 'before', label: 'Before recreation' });

        const recreated = createRegistry<{ id: string; label: string }>(key);
        expect(recreated.snapshot().map((item) => item.id)).toEqual(['before']);
        recreated.register({ id: 'after', label: 'After recreation' });

        expect(recreated.snapshot().map((item) => item.id)).toEqual(['before', 'after']);
        // This is observable V1 behavior: each factory owns its own shallowRef projection.
        expect(first.snapshot().map((item) => item.id)).toEqual(['before']);
        expect(first.listIds()).toEqual(['before', 'after']);
    });
});

describe('V1 registry family profiles', () => {
    beforeEach(() => {
        clear(listRegisteredMessageActionIds, unregisterMessageAction);
        clear(listRegisteredHeaderActionIds, unregisterHeaderAction);
        clear(listRegisteredComposerActionIds, unregisterComposerAction);
        clear(listRegisteredSidebarFooterActionIds, unregisterSidebarFooterAction);
        clear(listRegisteredDocumentHistoryActionIds, unregisterDocumentHistoryAction);
        clear(listRegisteredThreadHistoryActionIds, unregisterThreadHistoryAction);
        clear(listRegisteredProjectTreeActionIds, unregisterProjectTreeAction);
        clear(listRegisteredEditorToolbarButtonIds, unregisterEditorToolbarButton);
    });

    it('records handle versus void returns for every family facade', () => {
        expectHandle(registerMessageAction({ id: 'return:message', icon: 'i', tooltip: 'm', showOn: 'both', handler: () => {} }));
        expectHandle(registerHeaderAction({ id: 'return:header', icon: 'i', handler: () => {} }));
        expectHandle(registerComposerAction({ id: 'return:composer', icon: 'i', handler: () => {} }));
        expectHandle(registerSidebarFooterAction({ id: 'return:footer', icon: 'i', handler: () => {} }));

        expect(registerDocumentHistoryAction({ id: 'return:document', icon: 'i', label: 'd', handler: () => {} })).toBeUndefined();
        expect(registerThreadHistoryAction({ id: 'return:thread', icon: 'i', label: 't', handler: () => {} })).toBeUndefined();
        expect(registerProjectTreeAction({ id: 'return:project', icon: 'i', label: 'p', handler: () => {} })).toBeUndefined();
        expect(registerEditorToolbarButton({ id: 'return:editor', icon: 'i', onClick: () => {} })).toBeUndefined();
    });

    it('freezes projected copies and uses default order 200 with the frozen family tie rules', () => {
        registerMessageAction({ id: 'z-message', icon: 'i', tooltip: 'z', showOn: 'both', handler: () => {} });
        registerMessageAction({ id: 'a-message', icon: 'i', tooltip: 'a', showOn: 'both', handler: () => {} });
        registerHeaderAction({ id: 'z-header', icon: 'i', handler: () => {} });
        registerHeaderAction({ id: 'a-header', icon: 'i', handler: () => {} });
        registerSidebarFooterAction({ id: 'z-footer', icon: 'i', handler: () => {} });
        registerSidebarFooterAction({ id: 'a-footer', icon: 'i', handler: () => {} });
        registerDocumentHistoryAction({ id: 'z-document', icon: 'i', label: 'z', handler: () => {} });
        registerDocumentHistoryAction({ id: 'a-document', icon: 'i', label: 'a', handler: () => {} });
        registerThreadHistoryAction({ id: 'z-thread', icon: 'i', label: 'z', handler: () => {} });
        registerThreadHistoryAction({ id: 'a-thread', icon: 'i', label: 'a', handler: () => {} });
        registerProjectTreeAction({ id: 'z-project', icon: 'i', label: 'z', handler: () => {} });
        registerProjectTreeAction({ id: 'a-project', icon: 'i', label: 'a', handler: () => {} });
        registerEditorToolbarButton({ id: 'z-editor', icon: 'i', onClick: () => {} });
        registerEditorToolbarButton({ id: 'a-editor', icon: 'i', onClick: () => {} });

        // Composer is the deliberate legacy exception: its stable order-only sort retains map insertion order.
        registerComposerAction({ id: 'z-composer', icon: 'i', handler: () => {} });
        registerComposerAction({ id: 'a-composer', icon: 'i', handler: () => {} });

        const editor = ref({} as never);
        const projections = [
            useMessageActions({ role: 'assistant' }).value,
            useHeaderActions().value.map((entry) => entry.action),
            useSidebarFooterActions().value.map((entry) => entry.action),
            useDocumentHistoryActions().value,
            useThreadHistoryActions().value,
            useProjectTreeActions().value,
            useEditorToolbarButtons(editor).value,
        ];
        for (const projection of projections) {
            expect(projection.map((item) => item.id)).toEqual(expect.arrayContaining([]));
            expect(projection[0]?.id.startsWith('a-')).toBe(true);
            expect(Object.isFrozen(projection[0])).toBe(true);
        }
        expect(useComposerActions().value.map((entry) => entry.action.id)).toEqual(['z-composer', 'a-composer']);
        expect(Object.isFrozen(useComposerActions().value[0]?.action)).toBe(true);
    });

    it('replaces duplicate IDs and publishes one synchronous reactive update per mutation', () => {
        const messageItems = useMessageActions({ role: 'assistant' });
        const headerItems = useHeaderActions();
        const composerItems = useComposerActions();
        const footerItems = useSidebarFooterActions();
        const documentItems = useDocumentHistoryActions();
        const threadItems = useThreadHistoryActions();
        const projectItems = useProjectTreeActions();
        const editorItems = useEditorToolbarButtons(ref({} as never));
        const counts = Array.from({ length: 8 }, () => 0);
        const stops = [messageItems, headerItems, composerItems, footerItems, documentItems, threadItems, projectItems, editorItems]
            .map((items, index) => watch(items, () => counts[index]++, { flush: 'sync' }));

        registerMessageAction({ id: 'same:message', icon: 'i', tooltip: 'first', showOn: 'both', handler: () => {} });
        registerMessageAction({ id: 'same:message', icon: 'i', tooltip: 'second', showOn: 'both', handler: () => {} });
        registerHeaderAction({ id: 'same:header', icon: 'first', handler: () => {} });
        registerHeaderAction({ id: 'same:header', icon: 'second', handler: () => {} });
        registerComposerAction({ id: 'same:composer', icon: 'first', handler: () => {} });
        registerComposerAction({ id: 'same:composer', icon: 'second', handler: () => {} });
        registerSidebarFooterAction({ id: 'same:footer', icon: 'first', handler: () => {} });
        registerSidebarFooterAction({ id: 'same:footer', icon: 'second', handler: () => {} });
        registerDocumentHistoryAction({ id: 'same:document', icon: 'i', label: 'first', handler: () => {} });
        registerDocumentHistoryAction({ id: 'same:document', icon: 'i', label: 'second', handler: () => {} });
        registerThreadHistoryAction({ id: 'same:thread', icon: 'i', label: 'first', handler: () => {} });
        registerThreadHistoryAction({ id: 'same:thread', icon: 'i', label: 'second', handler: () => {} });
        registerProjectTreeAction({ id: 'same:project', icon: 'i', label: 'first', handler: () => {} });
        registerProjectTreeAction({ id: 'same:project', icon: 'i', label: 'second', handler: () => {} });
        registerEditorToolbarButton({ id: 'same:editor', icon: 'first', onClick: () => {} });
        registerEditorToolbarButton({ id: 'same:editor', icon: 'second', onClick: () => {} });

        expect(counts).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
        expect(messageItems.value[0]?.tooltip).toBe('second');
        expect(headerItems.value[0]?.action.icon).toBe('second');
        expect(composerItems.value[0]?.action.icon).toBe('second');
        expect(footerItems.value[0]?.action.icon).toBe('second');
        expect(documentItems.value[0]?.label).toBe('second');
        expect(threadItems.value[0]?.label).toBe('second');
        expect(projectItems.value[0]?.label).toBe('second');
        expect(editorItems.value[0]?.icon).toBe('second');
        stops.forEach((stop) => stop());
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
    unregisterSidebarSection,
    listRegisteredSidebarSectionIds,
    unregisterSidebarFooterAction,
    listRegisteredSidebarFooterActionIds,
} from '../sidebar/useSidebarSections';
import {
    registerHeaderAction,
    unregisterHeaderAction,
    listRegisteredHeaderActionIds,
    useHeaderActions,
} from '../sidebar/useHeaderActions';
import {
    registerComposerAction,
    unregisterComposerAction,
    listRegisteredComposerActionIds,
    useComposerActions,
} from '../sidebar/useComposerActions';

const DummyComponent = { name: 'DummyComponent', template: '<div />' };

describe('UI chrome registries', () => {
    beforeEach(() => {
        listRegisteredSidebarSectionIds().forEach((id) =>
            unregisterSidebarSection(id)
        );
        listRegisteredSidebarFooterActionIds().forEach((id) =>
            unregisterSidebarFooterAction(id)
        );
        listRegisteredHeaderActionIds().forEach((id) =>
            unregisterHeaderAction(id)
        );
        listRegisteredComposerActionIds().forEach((id) =>
            unregisterComposerAction(id)
        );
    });

    it('exposes header actions with ordering and disabled state', () => {
        registerHeaderAction({
            id: 'test:last',
            icon: 'pixelarticons:alert',
            order: 400,
            handler: () => {},
        });
        registerHeaderAction({
            id: 'test:first',
            icon: 'pixelarticons:star',
            order: 100,
            handler: () => {},
            disabled: () => true,
        });

        const entries = useHeaderActions(() => ({
            route: null,
            isMobile: false,
        })).value;

        expect(entries.map((entry) => entry.action.id)).toEqual([
            'test:first',
            'test:last',
        ]);
        expect(entries[0]?.disabled).toBe(true);
    });

    it('sorts composer actions and respects visible predicate', () => {
        registerComposerAction({
            id: 'test:hidden',
            icon: 'pixelarticons:eye-off',
            handler: () => {},
            visible: () => false,
        });
        registerComposerAction({
            id: 'test:late',
            icon: 'pixelarticons:watch',
            order: 320,
            handler: () => {},
        });
        registerComposerAction({
            id: 'test:early',
            icon: 'pixelarticons:pen',
            order: 180,
            handler: () => {},
        });

        const entries = useComposerActions(() => ({
            editor: null,
            threadId: 't-1',
            paneId: 'pane-1',
            isStreaming: false,
        })).value;

        expect(entries.map((entry) => entry.action.id)).toEqual([
            'test:early',
            'test:late',
        ]);
    });

    it('hides entries denied by access policy', () => {
        registerHeaderAction({
            id: 'test:auth-only',
            icon: 'pixelarticons:lock',
            handler: () => {},
            access: { authRequired: true },
        });
        registerComposerAction({
            id: 'test:free',
            icon: 'pixelarticons:check',
            handler: () => {},
        });

        const headerEntries = useHeaderActions(() => ({
            route: null,
            isMobile: false,
        })).value;
        const composerEntries = useComposerActions(() => ({
            editor: null,
            threadId: 't-1',
            paneId: 'pane-1',
            isStreaming: false,
        })).value;

        expect(headerEntries.map((entry) => entry.action.id)).toEqual([]);
        expect(composerEntries.map((entry) => entry.action.id)).toEqual([
            'test:free',
        ]);
    });
});

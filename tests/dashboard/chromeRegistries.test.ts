import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerSidebarSection,
    unregisterSidebarSection,
    listRegisteredSidebarSectionIds,
    registerSidebarFooterAction,
    unregisterSidebarFooterAction,
    listRegisteredSidebarFooterActionIds,
    useSidebarSections,
    useSidebarFooterActions,
} from '../ui-extensions/chrome/useSidebarSections';
import {
    registerHeaderAction,
    unregisterHeaderAction,
    listRegisteredHeaderActionIds,
    useHeaderActions,
} from '../ui-extensions/chrome/useHeaderActions';
import {
    registerComposerAction,
    unregisterComposerAction,
    listRegisteredComposerActionIds,
    useComposerActions,
} from '../ui-extensions/chrome/useComposerActions';

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

    it('groups sidebar sections by placement and order', () => {
        registerSidebarSection({
            id: 'test:main',
            component: DummyComponent,
            order: 250,
        });
        registerSidebarSection({
            id: 'test:top',
            component: DummyComponent,
            placement: 'top',
            order: 150,
        });
        registerSidebarSection({
            id: 'test:bottom',
            component: DummyComponent,
            placement: 'bottom',
            order: 300,
        });

        const sections = useSidebarSections().value;
        expect(sections.top.map((s) => s.id)).toEqual(['test:top']);
        expect(sections.main.map((s) => s.id)).toEqual(['test:main']);
        expect(sections.bottom.map((s) => s.id)).toEqual(['test:bottom']);
    });

    it('filters sidebar footer actions using visible/disabled predicates', () => {
        registerSidebarFooterAction({
            id: 'test:visible',
            icon: 'pixelarticons:rocket',
            handler: () => {},
        });
        registerSidebarFooterAction({
            id: 'test:hidden',
            icon: 'pixelarticons:eye-off',
            handler: () => {},
            visible: () => false,
        });
        registerSidebarFooterAction({
            id: 'test:disabled',
            icon: 'pixelarticons:warning',
            handler: () => {},
            disabled: () => true,
        });

        const entries = useSidebarFooterActions(() => ({
            activeThreadId: 'abc',
            activeDocumentId: null,
            isCollapsed: false,
        })).value;

        expect(entries.map((entry) => entry.action.id)).toEqual([
            'test:visible',
            'test:disabled',
        ]);
        const disabledEntry = entries.find(
            (entry) => entry.action.id === 'test:disabled'
        );
        expect(disabledEntry?.disabled).toBe(true);
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
});

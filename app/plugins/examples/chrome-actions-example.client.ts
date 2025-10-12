export default defineNuxtPlugin(() => {
    const sidebarSectionId = 'example:sidebar:welcome-card';
    const sidebarFooterId = 'example:sidebar:footer-toast';
    const headerActionId = 'example:header:show-toast';
    const composerActionId = 'example:composer:insert-snippet';

    const ExampleSidebarSection = {
        name: 'ExampleSidebarSection',
        template: `
            <div class="border-2 border-dashed border-[var(--md-outline-variant)] rounded-md px-3 py-2 text-xs leading-relaxed bg-[var(--md-surface-container-low)]/70">
                <p class="font-semibold mb-1">Plugin Extension Slot</p>
                <p class="opacity-70">
                    This card is contributed via <code>useSidebarSections</code>.
                    Replace it with your own component to provide quick tips, stats,
                    or shortcut links.
                </p>
            </div>
        `,
    };

    registerSidebarSection({
        id: sidebarSectionId,
        component: ExampleSidebarSection,
        placement: 'top',
        order: 240,
    });

    registerSidebarFooterAction({
        id: sidebarFooterId,
        icon: 'pixelarticons:downasaur',
        tooltip: 'Show sample toast',
        order: 260,
        async handler(ctx: SidebarFooterActionContext) {
            useToast().add({
                title: 'Sidebar footer action',
                description: ctx.activeThreadId
                    ? `Active thread: ${ctx.activeThreadId}`
                    : 'No active thread',
            });
        },
    });

    registerHeaderAction({
        id: headerActionId,
        icon: 'pixelarticons:moon-stars',
        tooltip: 'Example header action',
        order: 280,
        async handler() {
            const toast = useToast();
            toast.add({
                title: 'Header action',
                description: 'This button is provided by useHeaderActions()',
            });
        },
    });

    registerComposerAction({
        id: composerActionId,
        icon: 'pixelarticons:edit',
        label: 'Insert snippet',
        tooltip: 'Insert a canned response',
        order: 240,
        disabled: ({ isStreaming }: ComposerActionContext) => !!isStreaming,
        handler({ editor }: ComposerActionContext) {
            if (!editor) return;
            editor
                .chain()
                .focus()
                .insertContent('— Plugin inserted snippet.')
                .run();
        },
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterSidebarSection?.(sidebarSectionId);
            unregisterSidebarFooterAction?.(sidebarFooterId);
            unregisterHeaderAction?.(headerActionId);
            unregisterComposerAction?.(composerActionId);
        });
    }
});

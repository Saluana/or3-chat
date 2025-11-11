const SidebarPopoverButtonConfig = {
    class: 'justify-start font-light !normal-case',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]!',
    },
};

export const sidebarOverrides = {
    /* --- Sidebar header --- */
    'button[data-id="sidebar.filter"]': {
        class: 'shadow',
    },
    'button#sidebar.filter-item': SidebarPopoverButtonConfig,

    'input#sidebar.search': {
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:ring-1 focus:ring-[color:var(--md-primary)] shadow',
        },
    },

    'button.sidebar': {
        class: 'font-[IBM_Plex_Sans] text-xs uppercase tracking-wide hover:bg-primary/10 active:bg-primary/20',
    },

    /* --- Sidenav content --- */

    // Sidebar item buttons
    'button#ui.glass-button': {
        activeClass: 'bg-blue-500',
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20',
    },
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20',
    },

    //Sidebar popover buttons
    'button#sidebar.thread-rename': SidebarPopoverButtonConfig,
    'button#sidebar.thread-add-to-project': SidebarPopoverButtonConfig,
    'button#sidebar.thread-delete': SidebarPopoverButtonConfig,
    'button#sidebar.thread-extra-action': SidebarPopoverButtonConfig,
    'button#sidebar.document-rename': SidebarPopoverButtonConfig,
    'button#sidebar.document-add-to-project': SidebarPopoverButtonConfig,
    'button#sidebar.document-delete': SidebarPopoverButtonConfig,
    'button#sidebar.document-extra-action': SidebarPopoverButtonConfig,
    'button#sidebar.project-rename': SidebarPopoverButtonConfig,
    'button#sidebar.project-delete': SidebarPopoverButtonConfig,
    'button#sidebar.project-extra-action': SidebarPopoverButtonConfig,

    /* --- Sidebar bottom nav buttons --- */
    'button#sidebar.bottom-nav.info': {
        class: 'min-h-[44px] flex flex-col items-center gap-1 py-1.5',
        variant: 'soft',
        color: 'neutral',
    },
    'button#sidebar.bottom-nav.connect': {
        class: 'min-h-[44px] flex flex-col items-center gap-1 py-1.5',
        variant: 'soft',
    },

    'button#sidebar.bottom-nav.dashboard': {
        class: 'min-h-[44px] flex flex-col items-center gap-1 py-1.5',
        variant: 'soft',
        color: 'neutral',
    },

    'button#sidebar.bottom-nav.activity': {
        class: 'justify-start text-sm',
        variant: 'ghost',
    },

    'button#sidebar.bottom-nav.credits': {
        class: 'justify-start text-sm',
        variant: 'ghost',
    },
};

const SidebarPopoverButtonConfig = {
    class: 'justify-start font-light !normal-case',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]!',
    },
};

export const sidebarOverrides = {
    /* --- core --- */
    'button.sidebar': {
        class: 'font-[IBM_Plex_Sans] text-xs uppercase tracking-wide hover:bg-primary/10 active:bg-primary/20',
    },

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

    /* --- Sidenav content --- */

    // Sidebar item buttons
    'button#ui.glass-button': {
        activeClass: 'bg-blue-500',
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20',
    },
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20',
    },
    'button#sidebar.new-chat': {
        variant: 'solid',
        color: 'primary',
        class: 'text-[color:var(--md-on-primary)] hover:bg-primary/90! active:bg-primary/90!',
        ui: {
            base: 'bg-primary text-[color:var(--md-on-primary)] hover:bg-primary! active:bg-primary/90!',
        },
    },

    //Sidebar popover buttons for threads, documents, projects
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

    'button#sidebar.bottom-nav.activity': SidebarPopoverButtonConfig,

    'button#sidebar.bottom-nav.credits': SidebarPopoverButtonConfig,

    /* --- Collapsed sidebar buttons --- */
    'button#sidebar.collapsed-page': {
        ui: {
            base: 'bg-transparent hover:bg-[var(--md-inverse-surface)]/10 active:bg-[var(--md-inverse-surface)]/20 border-0! shadow-none! text-[var(--md-on-surface)]',
            leadingIcon: 'w-5 h-5',
        },
    },
    'button#sidebar.collapsed-page:active': {
        ui: {
            base: 'border-[length:var(--md-border-width)] bg-[var(--md-primary)]/10 border-[color:var(--md-border-color)] active:bg-[var(--md-surface-variant)]/90 text-[var(--md-on-surface)]',
            leadingIcon: 'w-5 h-5',
        },
    },
};

export const sidebarCssSelectors = {
    // Sidebar container border
    '#sidebar-container-outer': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.sidenav-header-separator': {
        style: {
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.hud-button': {
        style: {
            background:
                'color-mix(in srgb, var(--md-surface) 30%, transparent)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow:
                '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        },
    },
};

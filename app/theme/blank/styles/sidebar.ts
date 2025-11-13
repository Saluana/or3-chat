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
    // Note: border for chat containers is applied via CSS selector below to avoid duplicate class merges

    /* --- Sidebar header --- */
    'button[data-id="sidebar.filter"]': {
        class: 'shadow',
    },
    'button#sidebar.filter-item': SidebarPopoverButtonConfig,

    'input#sidebar.search': {
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:ring-1 focus:ring-[color:var(--md-primary)] shadow text-[14px]! h-[40px]!',
        },
    },

    /* --- Sidenav content --- */

    // Sidebar item buttons
    'button#ui.glass-button': {
        activeClass: 'bg-blue-500',
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 backdrop-blur',
    },
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-primary)]/10! active:bg-[var(--md-primary)]/20 backdrop-blur',
    },
    'button#sidebar.new-chat': {
        variant: 'solid',
        color: 'primary',
        class: 'text-[color:var(--md-on-primary)] hover:bg-[var(--md-primary-hover)]! active:bg-[var(--md-primary-active)]!',
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
        class: 'h-[54px] w-[54px] flex flex-col items-center gap-1 py-1.5 bg-transparent border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] hover:bg-[var(--md-info-hover)]! active:bg-[var(--md-info-active)]!',
        variant: 'soft',
    },
    'button#sidebar.bottom-nav.connect': {
        class: 'h-[54px] w-[54px] flex flex-col items-center gap-1 py-1.5 bg-transparent border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] transition-colors duration-150',
        variant: 'soft',
    },
    'button#sidebar.bottom-nav.connect:connected': {
        class: 'bg-[var(--md-success)]/20 hover:border-[color:var(--md-error)]! hover:bg-[var(--md-error)]/30! active:bg-[var(--md-error)]/40! text-[color:var(--md-on-surface)]',
    },
    'button#sidebar.bottom-nav.connect:disconnected': {
        class: 'hover:bg-[var(--md-success)]/15! active:bg-[var(--md-success)]/25',
    },

    'button#sidebar.bottom-nav.dashboard': {
        class: 'h-[54px] w-[54px] flex flex-col items-center gap-1 py-1.5 bg-transparent border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] hover:bg-[var(--md-info-hover)]! active:bg-[var(--md-info-active)]! ',
        variant: 'soft',
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
    '#top-header': {
        style: {
            backgroundColor: 'var(--md-surface)',
        },
    },
    '#bottom-nav': {
        style: {
            backgroundColor: 'var(--md-surface)',
        },
    },
};

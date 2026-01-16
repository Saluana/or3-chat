const SidebarPopoverButtonConfig = {
    class: 'justify-start font-light !normal-case shadow-none!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]!',
    },
};

export const sidebarOverrides = {
    /* --- core --- */
    'button#sidebar.unified-item.trigger': {
        class: 'flex items-center justify-center shadow-none!',
    },
    // Note: border for chat containers is applied via CSS selector below to avoid duplicate class merges

    /* --- Sidebar header --- */
    'button#sidebar.filter': {
        variant: 'solid',
        color: 'on-surface',
        size: 'md',
    },
    'button#sidebar.filter-item': SidebarPopoverButtonConfig,

    'input#sidebar.search': {
        class: 'mb-4',
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:ring-1 focus:ring-[color:var(--md-primary)] text-[14px]! h-[40px]!',
        },
    },
    'selectmenu#sidebar.project-select': {
        class: 'w-full',
        ui: {
            base: 'text-[14px]!',
            value: 'text-[14px]!',
            placeholder: 'text-[14px]!',
            item: 'text-[14px]!',
            itemLabel: 'text-[14px]!',
            content:
                'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[14px]!',
        },
    },

    /* --- Sidenav content --- */

    // Sidebar item buttons
    'button#ui.glass-button': {
        activeClass: 'bg-blue-500',
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur',
    },
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur theme-shadow',
    },
    'button#sidebar.new-chat': {
        variant: 'solid',
        color: 'primary',
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
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

    'button#sidebar.toggle': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
    },
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

    // SSR Auth button (Clerk sign-in/account) - PRIMARY CTA
    // Uses subtle primary tint to draw attention as main action
    'button#sidebar.bottom-nav.auth': {
        class: 'h-[54px] w-[54px] flex flex-col items-center gap-1 py-1.5 bg-[var(--md-primary)]/8 border-[length:var(--md-border-width)] border-[color:var(--md-primary)]/30 rounded-[var(--md-border-radius)] text-[var(--md-primary)] hover:bg-[var(--md-primary)]/15! hover:border-[color:var(--md-primary)]/50! active:bg-[var(--md-primary)]/25!',
        variant: 'soft',
    },

    // Dashboard button - SECONDARY action (neutral styling)
    'button#sidebar.bottom-nav.dashboard': {
        class: 'h-[48px] w-[48px] flex flex-col items-center gap-1 py-1.5 bg-transparent border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)]/70 hover:bg-[var(--md-surface-hover)]! hover:text-[var(--md-on-surface)]! active:bg-[var(--md-surface-active)]!',
        variant: 'soft',
    },

    'button#sidebar.bottom-nav.activity': SidebarPopoverButtonConfig,

    'button#sidebar.bottom-nav.credits': SidebarPopoverButtonConfig,

    /* --- Collapsed sidebar buttons --- */
    'button#sidebar.collapsed-page': {
        ui: {
            base: 'bg-transparent hover:bg-[var(--md-surface-hover)] hover:ring-1 hover:ring-[var(--md-surface-active)] active:bg-[var(--md-surface-active)] text-[var(--md-on-surface)]',
            leadingIcon: 'w-6 h-6',
        },
    },
    'button#sidebar.collapsed-page:active': {
        ui: {
            base: 'bg-[var(--md-surface-active)] ring-1 ring-[var(--md-primary-border)]/20 hover:ring-1 hover:ring-[var(--md-primary-border)]/50 hover:bg-[var(--md-surface-active)]  text-[var(--md-on-surface)]',
            leadingIcon: 'w-6 h-6',
        },
    },
    'div#sidebar.header': {
        class: 'header-pattern flex items-center min-h-12 max-h-12 py-2 border-b-(--md-border-width) border-(--md-border-color)',
    },
    'div#sidebar.header:collapsed': {
        class: 'px-0 justify-center w-[63px]!',
        style: { width: '62px' },
    },
    'div#sidebar.header:expanded': {
        class: 'px-3 justify-between w-full',
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
            backgroundColor: 'var(--md-top-header-bg)',
        },
    },
    '#top-header[data-sidebar-state="collapsed"]': {
        style: {
            width: '62px !important',
            paddingLeft: '0',
            paddingRight: '0',
        },
    },
    '#bottom-nav': {
        style: {
            backgroundColor: 'transparent',
            width: '62px !important',
            paddingLeft: '0px !important',
        },
    },
    '.sidebar-section-heading': {
        style: {
            fontSize: '16px',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--md-on-surface)/70%',
        },
    },
    '#nav-top-section .iconify': {
        style: {
            fontSize: '25px !important',
        },
    },
    '#nav-collapsed-container': {
        style: {
            minWidth: '64px !important',
            maxWidth: '64px !important',
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '#nav-top-section, #nav-footer-section, #nav-pages-section, #nav-middle-section':
        {
            style: {
                backgroundColor: 'transparent',
            },
        },
};

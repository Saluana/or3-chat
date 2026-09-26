const SidebarPopoverButtonConfig = {
    class: 'justify-start font-light !normal-case shadow-none!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]!',
    },
};

// Keep pixel icons on their 24px grid, with one consistent, unboxed hit area.
const SidebarRailButtonConfig = {
    variant: 'ghost',
    square: true,
    class: 'h-[40px] w-[40px] shrink-0 flex items-center justify-center p-0! border-0! rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent! text-[var(--md-on-surface)]! hover:bg-[var(--md-primary)]/8! active:bg-[var(--md-primary)]/14! shadow-none! ring-0! backdrop-blur-none! transform-none! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    ui: { leadingIcon: 'size-6' },
};

const SidebarRailUtilityButtonConfig = {
    ...SidebarRailButtonConfig,
    class: `${SidebarRailButtonConfig.class} text-[var(--md-on-surface-variant)]! hover:text-[var(--md-on-surface)]!`,
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
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus-visible:ring-0! focus-visible:outline-none! text-[14px]! h-[var(--app-control-height-medium,40px)]!',
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
                'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] text-[14px]!',
        },
    },

    /* --- Sidenav content --- */

    // Sidebar item buttons
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-light border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur theme-shadow',
    },
    'button#sidebar.new-chat': SidebarRailButtonConfig,
    'button#sidebar.collapsed-search': SidebarRailButtonConfig,
    'button#sidebar.new-document': SidebarRailButtonConfig,
    'button#sidebar.new-project': SidebarRailButtonConfig,

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

    'button#sidebar.toggle': SidebarRailUtilityButtonConfig,
    /* --- Sidebar bottom nav buttons --- */
    'button#sidebar.bottom-nav.info': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.connect': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.auth': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.dashboard': SidebarRailUtilityButtonConfig,

    'button#sidebar.bottom-nav.activity': SidebarPopoverButtonConfig,

    'button#sidebar.bottom-nav.credits': SidebarPopoverButtonConfig,

    /* --- Mobile bottom nav bar (replaces rail on small screens) --- */
    'button#sidebar.mobile-nav.item': {
        class: 'text-[var(--md-on-surface)]/75 hover:bg-[var(--md-primary)]/8 hover:text-[var(--md-on-surface)] active:bg-[var(--md-primary)]/15',
    },
    'button#sidebar.mobile-nav.item:active': {
        class: 'text-[var(--md-primary)] bg-[var(--md-primary)]/12 hover:bg-[var(--md-primary)]/18 hover:text-[var(--md-primary)]',
    },
    'button#sidebar.mobile-nav.create': {
        class: 'text-[var(--md-on-surface)]/75 hover:text-[var(--md-on-surface)]',
    },
    'button#sidebar.mobile-nav.create-item': {
        class: 'border-[length:var(--md-border-width)] border-transparent hover:border-[color:var(--md-border-color)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
    },

    /* --- Collapsed sidebar buttons --- */
    'button#sidebar.collapsed-page': {
        ...SidebarRailButtonConfig,
        ui: {
            base: 'relative',
            leadingIcon: 'size-6',
        },
    },
    'button#sidebar.collapsed-page:active': {
        class: 'bg-[var(--md-primary)]/10! text-[var(--md-primary)]!',
    },
    'div#sidebar.header': {
        class: 'header-pattern flex items-center min-h-12 max-h-12 py-2',
    },
    'div#sidebar.header:collapsed': {
        class: 'px-0 justify-center w-[64px]!',
        style: { width: '64px' },
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
    '#sidebar-container-outer:has(#top-header[data-sidebar-state="collapsed"])': {
        style: { borderRight: 'none' },
    },
    '.sidenav-header-separator': {
        style: {
            borderBottom: 'var(--md-border-width-subtle, var(--md-border-width)) solid var(--md-border-color)',
        },
    },
    '.hud-button': {
        style: {
            background:
                'color-mix(in srgb, var(--md-surface) 30%, transparent)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
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
            width: '64px !important',
            paddingLeft: '0',
            paddingRight: '0',
            boxSizing: 'border-box',
        },
    },
    '.bottomnav-root': {
        style: {
            backgroundColor: 'transparent',
            width: '64px !important',
            gap: '8px',
            paddingTop: '12px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        },
    },
    '.bottomnav-root .iconify': {
        style: { width: '24px', height: '24px', fontSize: '24px' },
    },
    '.bottomnav-root .sidebar-rail-caption, .bottomnav-root .sb-bottom-border, .bottomnav-root .sidebar-connection-status-bar': {
        style: { display: 'none' },
    },
    '.bottomnav-root [data-connection-state]': {
        style: { position: 'relative' },
    },
    '.bottomnav-root [data-connection-state="connected"] .sidebar-connection-status-bar': {
        style: {
            display: 'block',
            position: 'absolute',
            right: '7px',
            bottom: '7px',
            width: '4px',
            height: '4px',
            boxShadow: '0 0 0 2px var(--md-surface)',
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
    '#nav-top-section .iconify, #nav-top-section .app-icon:has(> .iconify)': {
        style: { width: '24px', height: '24px', fontSize: '24px' },
    },
    '#nav-collapsed-container, #sidebar-content-collapsed': {
        style: {
            width: '64px !important',
            minWidth: '64px !important',
            maxWidth: '64px !important',
            alignItems: 'center',
            boxSizing: 'border-box',
            backgroundColor: 'color-mix(in srgb, var(--md-surface) 90%, transparent)',
            borderRight: '1px solid color-mix(in srgb, var(--md-border-color) 18%, transparent)',
            backdropFilter: 'none',
        },
    },
    '#nav-top-section, #nav-footer-section': {
        style: {
            width: '100%',
            alignItems: 'center',
            paddingLeft: '0',
            paddingRight: '0',
            scrollbarWidth: 'none',
        },
    },
    '#nav-top-section .new-chat-wrapper': {
        style: { paddingRight: '0' },
    },
    '#nav-pages-section': {
        style: {
            position: 'relative',
            alignItems: 'center',
            borderTop: 'none',
            marginTop: '12px',
            paddingTop: '16px',
        },
    },
    '#nav-pages-section::before': {
        style: {
            content: '""',
            position: 'absolute',
            top: '0',
            left: '8px',
            right: '8px',
            height: '1px',
            background: 'color-mix(in srgb, var(--md-border-color) 18%, transparent)',
        },
    },
    '#nav-pages-section button[aria-pressed="true"]::before': {
        style: {
            content: '""',
            position: 'absolute',
            left: '-4px',
            top: 'calc(50% - 2px)',
            width: '4px',
            height: '4px',
            background: 'var(--md-primary)',
        },
    },
    /* Mobile bottom nav bar — hard top edge + retro FAB */
    '#mobile-bottom-nav': {
        style: {
            backgroundColor: 'var(--md-surface)',
        },
    },
    '#mobile-bottom-nav .mobile-nav-create-fab': {
        style: {
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
            boxShadow: '2px 2px 0 var(--md-border-color)',
        },
    },
};

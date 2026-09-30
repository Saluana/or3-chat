const SidebarPopoverButtonConfig = {
    class: 'justify-start font-normal !normal-case shadow-none!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[13px]!',
    },
};

// The rail keeps Cyberpunk's angular silhouette; cyan marks selection, not every button.
const SidebarRailButtonConfig = {
    variant: 'ghost',
    square: true,
    class: 'h-[40px] w-[40px] shrink-0 flex items-center justify-center p-0! border-0! rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent! text-[var(--md-on-surface)]! hover:bg-[var(--md-primary)]/10! active:bg-[var(--md-primary)]/15! shadow-none! ring-0! backdrop-blur-none! transform-none! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    ui: { leadingIcon: 'size-6' },
};

const SidebarRailUtilityButtonConfig = {
    ...SidebarRailButtonConfig,
    class: `${SidebarRailButtonConfig.class} text-[var(--md-on-surface-variant)]! hover:text-[var(--md-on-surface)]!`,
    ui: { leadingIcon: 'size-5' },
};

export const sidebarOverrides = {
    /* --- core --- */
    'button#sidebar.unified-item.trigger': {
        class: 'flex items-center justify-center shadow-none!',
    },

    /* --- Sidebar header --- */
    'button#sidebar.filter': {
        variant: 'solid',
        color: 'on-surface',
        size: 'md',
    },
    'button#sidebar.filter-item': SidebarPopoverButtonConfig,

    'input#sidebar.search': {
        class: 'mb-3',
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus:border-[color:var(--md-primary)] ring-0! focus:ring-1 focus:ring-[color:var(--md-primary)] text-[13px]! h-[36px]!',
        },
    },
    'selectmenu#sidebar.project-select': {
        class: 'w-full',
        ui: {
            base: 'text-[13px]!',
            value: 'text-[13px]!',
            placeholder: 'text-[13px]!',
            item: 'text-[13px]!',
            itemLabel: 'text-[13px]!',
            content:
                'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[13px]!',
        },
    },

    /* --- Sidenav content --- */
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-normal border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur theme-shadow',
    },
    'button#sidebar.new-chat': SidebarRailButtonConfig,

    // Collapsed page buttons (Home, custom pages)
    'button#sidebar.collapsed-page': {
        ...SidebarRailButtonConfig,
        ui: {
            base: 'relative',
            leadingIcon: 'size-6',
        },
    },
    'button#sidebar.collapsed-page:active': {
        class: 'bg-[var(--md-primary)]/12! text-[var(--md-primary-shade)]! dark:text-[var(--md-primary-tint)]!',
    },

    // Sidebar popover buttons
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

    /* --- Collapsed sidebar action buttons (search, new doc, new project) --- */
    'button#sidebar.collapsed-search': SidebarRailButtonConfig,
    'button#sidebar.new-document': SidebarRailButtonConfig,
    'button#sidebar.new-project': SidebarRailButtonConfig,

    /* --- Sidebar bottom nav buttons --- */
    'button#sidebar.bottom-nav.dashboard': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.info': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.connect': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.auth': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.settings': SidebarRailUtilityButtonConfig,

    /* --- Mobile bottom nav bar (replaces rail on small screens) --- */
    'button#sidebar.mobile-nav.item': {
        class: 'text-[var(--md-on-surface)]/70 hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)] active:bg-[var(--md-surface-active)]',
    },
    'button#sidebar.mobile-nav.item:active': {
        class: 'bg-[var(--md-primary)]/15 text-[var(--md-primary-shade)] hover:bg-[var(--md-primary)]/20 hover:text-[var(--md-primary-shade)]',
    },
    'button#sidebar.mobile-nav.create-item': {
        class: 'border-[length:var(--md-border-width)] border-transparent hover:border-[color:var(--md-border-color)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
    },
};

export const sidebarCssSelectors = {
    // A quiet surface makes the icons readable over the circuit-board background.
    '#nav-collapsed-container, #sidebar-content-collapsed': {
        style: {
            width: '64px !important',
            minWidth: '64px !important',
            maxWidth: '64px !important',
            alignItems: 'center',
            boxSizing: 'border-box',
            backgroundColor: 'color-mix(in srgb, var(--md-surface) 86%, transparent)',
            borderRight: '1px solid color-mix(in srgb, var(--md-primary) 14%, transparent)',
            backdropFilter: 'none',
        },
    },
    '#top-header[data-sidebar-state="collapsed"]': {
        style: {
            width: '64px',
            boxSizing: 'border-box',
            borderBottom: 'none',
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
    '#nav-top-section .iconify, #nav-top-section .app-icon:has(> .iconify)': {
        style: { width: '24px', height: '24px', fontSize: '24px' },
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
            background: 'color-mix(in srgb, var(--md-primary) 22%, transparent)',
        },
    },
    '#nav-pages-section button[aria-pressed="true"]::before': {
        style: {
            content: '""',
            position: 'absolute',
            left: '0',
            top: '12px',
            bottom: '12px',
            width: '2px',
            background: 'var(--md-primary)',
        },
    },
    '.bottomnav-root': {
        style: {
            width: '64px !important',
            gap: '8px',
            paddingTop: '12px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        },
    },
    '.bottomnav-root .iconify': {
        style: { width: '20px', height: '20px', fontSize: '20px' },
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
            width: '5px',
            height: '5px',
            borderRadius: '1px',
            boxShadow: '0 0 0 2px var(--md-surface)',
        },
    },
    // Chat containers vertical dividers
    '.chat-container:not(:last-child)': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.chat-container:not(:first-child)': {
        style: {
            borderTop:
                'var(--md-border-width) solid var(--md-border-color) !important',
        },
    },
    '#app-sidebar': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    /* Mobile bottom nav bar — neon FAB glow */
    '#mobile-bottom-nav': {
        style: {
            backgroundColor: 'var(--md-surface)',
        },
    },
    '#mobile-bottom-nav .mobile-nav-create-fab': {
        style: {
            boxShadow:
                '0 0 14px color-mix(in srgb, var(--md-primary) 45%, transparent), 0 2px 6px rgb(0 0 0 / 0.25)',
        },
    },
};

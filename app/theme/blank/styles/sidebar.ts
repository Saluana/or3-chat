const SidebarPopoverButtonConfig = {
    class: 'justify-start font-normal !normal-case border-0 max-md:min-h-[44px]! max-md:text-[16px]!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]! max-md:text-[16px]!',
    },
};

const SidebarCollapsedTopButtonConfig = {
    variant: 'ghost',
    square: true,
    class: 'h-[40px] w-[40px] shrink-0 flex items-center justify-center p-0! bg-transparent! border-0! rounded-full text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    ui: { leadingIcon: 'size-[22px]' },
};

const SidebarRailUtilityButtonConfig = {
    ...SidebarCollapsedTopButtonConfig,
    class: `${SidebarCollapsedTopButtonConfig.class} text-[var(--md-on-surface-variant)]! hover:text-[var(--md-on-surface)]!`,
    ui: { leadingIcon: 'size-5' },
};

export const sidebarOverrides = {
    'div#sidebar.header:collapsed': {
        class: 'w-[64px]!',
    },
    'button[data-id="sidebar.filter"]': {
        class: 'border-0',
    },
    'button#sidebar.filter-item': SidebarPopoverButtonConfig,

    'input#sidebar.search': {
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface)] hover:bg-[var(--md-surface)] ring-0! focus:ring-2 focus:ring-[color:var(--md-primary)]/10 text-[14px]! h-[40px]! shadow-[0_1px_2px_rgba(15,23,42,0.04)] max-md:min-h-[44px]! max-md:text-[16px]!',
        },
    },
    'selectmenu#sidebar.project-select': {
        class: 'h-[36px] rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0 ring-0 data-[state=open]:bg-[var(--md-surface-hover)]! w-full cursor-pointer max-md:min-h-[44px]!',
        ui: {
            base: 'text-[14px]! max-md:text-[16px]!',
            value: 'text-[14px]! max-md:text-[16px]!',
            placeholder: 'text-[14px]! max-md:text-[16px]!',
            content:
                'ring-0! border-0! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] shadow-lg text-[14px]! max-md:text-[16px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[14px]! rounded-none rounded-t-[var(--md-border-radius-large,var(--md-border-radius))]! max-md:min-h-[44px]! max-md:text-[16px]!',
            },
        },
    },

    // Sidebar item buttons: ChatGPT style - clean, minimal, rounded
    'div#sidebar.project-group-container': {
        class: 'text-[14px] font-normal border-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-transparent text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
    },
    'button#sidebar.new-chat': SidebarCollapsedTopButtonConfig,
    'button#sidebar.collapsed-search': SidebarCollapsedTopButtonConfig,
    'button#sidebar.new-document': SidebarCollapsedTopButtonConfig,
    'button#sidebar.new-project': SidebarCollapsedTopButtonConfig,

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

    /* --- Bottom nav buttons: clean, borderless --- */
    'button#sidebar.bottom-nav.info': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.connect': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.auth': SidebarRailUtilityButtonConfig,
    'button#sidebar.bottom-nav.dashboard': SidebarRailUtilityButtonConfig,
    'button#sidebar.toggle': SidebarRailUtilityButtonConfig,

    'button#sidebar.bottom-nav.activity': SidebarPopoverButtonConfig,
    'button#sidebar.bottom-nav.credits': SidebarPopoverButtonConfig,

    /* --- Notification panel --- */
    'button#notifications.mark-all-read': {
        class: 'w-fit border-0',
        size: 'xs',
    },
    'button#notifications.clear-all': {
        size: 'xs',
        class: 'border-0',
    },
    'button#notifications.clear.cancel': {
        class: 'w-fit border-0',
        size: 'xs',
        ui: {
            base: 'px-[10px]! min-w-0!',
        },
    },
    'button#notifications.clear.confirm': {
        class: 'w-fit border-0',
        size: 'xs',
        ui: {
            base: 'px-[10px]! min-w-0!',
        },
    },

    /* --- Mobile bottom nav bar (replaces rail on small screens) --- */
    'button#sidebar.mobile-nav.item': {
        class: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)] active:bg-[var(--md-surface-active)]',
    },
    'button#sidebar.mobile-nav.item:active': {
        class: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] bg-[var(--md-surface-hover)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-active)] hover:text-[var(--md-on-surface)]',
    },
    'button#sidebar.mobile-nav.create-item': {
        class: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0 max-md:min-h-[44px]! max-md:text-[16px]!',
    },

    /* --- Collapsed sidebar --- */
    'button#sidebar.collapsed-page': {
        ...SidebarCollapsedTopButtonConfig,
        ui: {
            base: 'ring-0! shadow-none!',
            leadingIcon: 'size-[22px]',
        },
    },
    'button#sidebar.collapsed-page:active': {
        class: 'bg-[var(--md-surface-hover)]!',
    },
};

export const sidebarCssSelectors = {
    // Soft rail + white content panel
    '#sidebar-container-outer': {
        style: {
            borderRight: 'none',
            backgroundColor: 'var(--md-surface)',
        },
    },
    /* Expanded: hairline against main content (collapsed keeps rail-only edge) */
    '#sidebar-container-outer:has(#top-header[data-sidebar-state="expanded"])': {
        style: {
            borderRight:
                'var(--md-border-width-subtle, var(--md-border-width)) solid color-mix(in srgb, var(--md-border-color) 70%, transparent)',
            boxSizing: 'border-box',
        },
    },
    '.sidenav-header-separator': {
        style: {
            borderBottom: 'none',
        },
    },
    '.hud-button': {
        style: {
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
            boxShadow: 'none',
        },
    },
    '#top-header': {
        style: {
            backgroundColor: 'var(--md-surface)',
            borderBottom: 'none',
        },
    },
    '#top-header[data-sidebar-state="collapsed"]': {
        style: {
            backgroundColor: 'var(--md-surface)',
            borderBottom: 'none',
            width: '64px',
            boxSizing: 'border-box',
        },
    },
    '#nav-content-container': {
        style: {
            backgroundColor: 'var(--md-surface)',
        },
    },
    '#nav-header': {
        style: {
            paddingLeft: '0.5rem',
            paddingRight: '0.5rem',
            paddingBottom: '0.35rem',
        },
    },
    '.sidebar-section-heading': {
        style: {
            fontSize: '11px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--md-on-surface-variant)',
        },
    },
    '.page-link-btn': {
        style: {
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
            minHeight: '54px',
            marginBottom: '0.4rem',
        },
    },
    '.unified-sb-item': {
        style: {
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
            marginInline: '0',
            border: 'var(--md-border-width) solid transparent',
        },
    },
    '.unified-sb-item-active': {
        style: {
            background:
                'color-mix(in srgb, var(--md-primary) 8%, var(--md-surface))',
            borderColor:
                'color-mix(in srgb, var(--md-primary) 12%, transparent)',
        },
    },
    '.sb-group-header-label': {
        style: {
            fontSize: '11px',
            letterSpacing: '0.08em',
        },
    },
    '.time-group-header .sb-group-header-label': {
        style: {
            color: 'color-mix(in srgb, var(--md-on-surface-variant) 85%, transparent)',
            fontWeight: '600',
        },
    },
    '.time-group-header': {
        style: {
            marginBottom: '0.25rem',
        },
    },
    '.project-empty-state': {
        style: {
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
        },
    },
    /* Soft brand blue — pairs with docs green, echoes logo #2a8fd6 */
    '.page-link-accent-chats .page-link-icon-container': {
        style: {
            background:
                'color-mix(in srgb, var(--blank-brand-accent) 14%, var(--md-surface))',
            color: 'var(--blank-brand-accent)',
        },
    },
    '#nav-top-section .iconify': {
        style: {
            fontSize: '22px',
            width: '22px',
            height: '22px',
        },
    },
    '#nav-top-section .app-icon:has(> .iconify)': {
        style: { width: '22px', height: '22px' },
    },
    '.bottomnav-root .iconify': {
        style: {
            fontSize: '20px !important',
            width: '20px',
            height: '20px',
        },
    },
    // Always-visible 64px icon rail (expanded SideBar AND collapsed layout).
    // Do NOT set width:100% — that collapses the expanded panel.
    '#nav-collapsed-container': {
        style: {
            minWidth: '64px !important',
            maxWidth: '64px !important',
            width: '64px !important',
            backgroundColor: 'var(--md-surface)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            boxSizing: 'border-box',
            backdropFilter: 'none',
        },
    },
    '#sidebar-content-collapsed': {
        style: {
            width: '64px !important',
            minWidth: '64px !important',
            maxWidth: '64px !important',
        },
    },
    '.bottomnav-root': {
        style: {
            width: '64px !important',
            borderTop: 'none',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            paddingTop: '12px',
            gap: '8px',
        },
    },
    '#nav-pages-section': {
        style: {
            borderTop: 'none',
            alignItems: 'center',
            position: 'relative',
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
            background: 'color-mix(in srgb, var(--md-on-surface) 12%, transparent)',
        },
    },
    '#nav-top-section': {
        style: {
            alignItems: 'center',
            paddingLeft: '0',
            paddingRight: '0',
            width: '100%',
            scrollbarWidth: 'none',
        },
    },
    '#nav-top-section .new-chat-wrapper': {
        style: {
            paddingRight: '0',
            justifyContent: 'center',
        },
    },
    '.sb-empty-state button': {
        style: {
            fontSize: '12px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        },
    },
    '.bottomnav-root .sidebar-rail-caption': {
        style: { display: 'none' },
    },
    '.bottomnav-root .sb-bottom-border': {
        style: { display: 'none' },
    },
    '.bottomnav-root [data-connection-state]': {
        style: {
            position: 'relative',
        },
    },
    '.bottomnav-root .sidebar-connection-status-bar': {
        style: { display: 'none' },
    },
    '.bottomnav-root [data-connection-state="connected"] .sidebar-connection-status-bar': {
        style: {
            display: 'block',
            position: 'absolute',
            right: '7px',
            bottom: '7px',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            boxShadow: '0 0 0 2px var(--md-surface)',
        },
    },
    '#nav-footer-section': {
        style: {
            alignItems: 'center',
            paddingLeft: '0',
            paddingRight: '0',
        },
    },
    /* Mobile bottom nav bar — hairline top edge, soft FAB shadow */
    '#mobile-bottom-nav': {
        style: {
            backgroundColor: 'var(--md-surface)',
            borderTop:
                '1px solid color-mix(in srgb, var(--md-border-color) 70%, transparent)',
        },
    },
    '#mobile-bottom-nav .mobile-nav-create-fab': {
        style: {
            boxShadow: '0 6px 16px rgb(0 0 0 / 0.12), 0 1px 4px rgb(0 0 0 / 0.08)',
        },
    },
};

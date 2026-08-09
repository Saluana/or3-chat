const SidebarPopoverButtonConfig = {
    class: 'justify-start font-normal !normal-case border-0 max-md:min-h-[44px]! max-md:text-[16px]!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]! max-md:text-[16px]!',
    },
};

const SidebarCollapsedTopButtonConfig = {
    class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] max-md:min-h-[44px]! max-md:min-w-[44px]!',
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
            base: 'border border-[color:var(--md-border-color)] rounded-xl bg-[var(--md-surface)] hover:bg-[var(--md-surface)] ring-0! focus:ring-2 focus:ring-[color:var(--md-primary)]/10 text-[14px]! h-[40px]! shadow-[0_1px_2px_rgba(15,23,42,0.04)] max-md:min-h-[44px]! max-md:text-[16px]!',
        },
    },
    'selectmenu#sidebar.project-select': {
        class: 'h-[36px] rounded-xl border-0 ring-0 data-[state=open]:bg-[var(--md-surface-hover)]! w-full cursor-pointer max-md:min-h-[44px]!',
        ui: {
            base: 'text-[14px]! max-md:text-[16px]!',
            value: 'text-[14px]! max-md:text-[16px]!',
            placeholder: 'text-[14px]! max-md:text-[16px]!',
            content:
                'ring-0! border-0! rounded-xl bg-[var(--md-surface)] shadow-lg text-[14px]! max-md:text-[16px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[14px]! rounded-none rounded-t-xl! max-md:min-h-[44px]! max-md:text-[16px]!',
            },
        },
    },

    // Sidebar item buttons: ChatGPT style - clean, minimal, rounded
    'button#ui.glass-button': {
        activeClass: 'bg-[var(--md-surface-active)]',
        class: 'text-[14px] font-normal border-0 rounded-[10px] bg-transparent text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
    },
    'div#sidebar.project-group-container': {
        class: 'text-[14px] font-normal border-0 rounded-[10px] bg-transparent text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
    },
    'button#sidebar.new-chat': {
        variant: 'ghost',
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]! border-0! rounded-xl max-md:min-h-[44px]! max-md:min-w-[44px]!',
    },
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
    'button#sidebar.bottom-nav.info': {
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    },
    'button#sidebar.bottom-nav.connect': {
        variant: 'ghost',
        class: 'h-[48px]! w-[48px]! flex items-center justify-center p-0 border-0! rounded-xl text-[var(--md-on-surface-variant)]! hover:bg-[var(--md-surface-hover)]! hover:text-[var(--md-on-surface)]! active:bg-[var(--md-surface-active)]! transition-colors duration-150',
    },
    'button#sidebar.bottom-nav.connect:connected': {
        class: 'bg-[var(--md-surface-hover)] text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-active)]! hover:text-[var(--md-on-surface)]!',
    },
    'button#sidebar.bottom-nav.connect:disconnected': {
        class: 'hover:bg-[var(--md-surface-hover)]! hover:text-[var(--md-on-surface)]!',
    },

    'button#sidebar.bottom-nav.auth': {
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    },

    'button#sidebar.bottom-nav.dashboard': {
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]! max-md:min-h-[44px]! max-md:min-w-[44px]!',
    },

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
        class: 'rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] hover:text-[var(--md-on-surface)] active:bg-[var(--md-surface-active)]',
    },
    'button#sidebar.mobile-nav.item:active': {
        class: 'rounded-xl bg-[var(--md-surface-hover)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-active)] hover:text-[var(--md-on-surface)]',
    },
    'button#sidebar.mobile-nav.create-item': {
        class: 'rounded-xl border-0 max-md:min-h-[44px]! max-md:text-[16px]!',
    },

    /* --- Collapsed sidebar --- */
    'button#sidebar.collapsed-page': {
        ui: {
            base: 'h-[40px] w-[40px] flex items-center justify-center bg-transparent hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0 text-[var(--md-on-surface)] rounded-xl p-0! max-md:min-h-[44px]! max-md:min-w-[44px]!',
            leadingIcon: 'w-5 h-5',
        },
    },
    'button#sidebar.collapsed-page:active': {
        ui: {
            base: 'h-[40px] w-[40px] flex items-center justify-center bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] border-0 text-[var(--md-on-surface)] rounded-xl p-0! max-md:min-h-[44px]! max-md:min-w-[44px]!',
            leadingIcon: 'w-5 h-5',
        },
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
                '1px solid color-mix(in srgb, var(--md-border-color) 70%, transparent)',
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
            borderRadius: '12px',
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
            borderRadius: '14px',
            minHeight: '54px',
            marginBottom: '0.4rem',
        },
    },
    '.unified-sb-item': {
        style: {
            borderRadius: '12px',
            marginInline: '0',
            border: '1px solid transparent',
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
    '.project-empty-state': {
        style: {
            borderRadius: '14px',
        },
    },
    /* Soft brand blue — pairs with docs green, echoes logo #2a8fd6 */
    '.page-link-accent-chats .page-link-icon-container': {
        style: {
            background:
                'color-mix(in srgb, #2a8fd6 14%, var(--md-surface))',
            color: '#2a8fd6',
        },
    },
    '#nav-top-section .iconify': {
        style: {
            fontSize: '20px !important',
            width: '20px',
            height: '20px',
        },
    },
    '#nav-collapsed-container .iconify': {
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
            paddingBottom: '8px',
            paddingTop: '4px',
        },
    },
    '#nav-pages-section': {
        style: {
            borderTop: 'none',
            alignItems: 'center',
        },
    },
    '#nav-top-section': {
        style: {
            alignItems: 'center',
            paddingLeft: '0',
            paddingRight: '0',
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
    '.bottomnav-root [data-connection-state] .uppercase': {
        style: {
            letterSpacing: 'normal',
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

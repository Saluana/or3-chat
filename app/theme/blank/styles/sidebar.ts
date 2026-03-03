const SidebarPopoverButtonConfig = {
    class: 'justify-start font-normal !normal-case border-0',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[14px]!',
    },
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
            base: 'border-0 rounded-xl bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] ring-0! focus:ring-0 text-[14px]! h-[36px]!',
        },
    },
    'selectmenu#sidebar.project-select': {
        class: 'h-[36px] rounded-xl border-0 ring-0 data-[state=open]:bg-[var(--md-surface-hover)]! w-full cursor-pointer',
        ui: {
            base: 'text-[14px]!',
            value: 'text-[14px]!',
            placeholder: 'text-[14px]!',
            content:
                'ring-0! border-0! rounded-xl bg-[var(--md-surface)] shadow-lg text-[14px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[14px]! rounded-none rounded-t-xl!',
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
        class: 'text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)]! border-0! rounded-[10px]',
    },

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
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
    },
    'button#sidebar.bottom-nav.connect': {
        variant: 'ghost',
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 border-0! rounded-xl text-[var(--md-on-surface-variant)]! transition-colors duration-150',
    },
    'button#sidebar.bottom-nav.connect:connected': {
        class: 'bg-[var(--md-success)]/10 text-[var(--md-success)]! hover:bg-[var(--md-error)]/10! hover:text-[var(--md-error)]!',
    },
    'button#sidebar.bottom-nav.connect:disconnected': {
        class: 'hover:bg-[var(--md-success)]/10!',
    },

    'button#sidebar.bottom-nav.auth': {
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
    },

    'button#sidebar.bottom-nav.dashboard': {
        class: 'h-[40px] w-[40px] flex items-center justify-center p-0 bg-transparent border-0 rounded-xl text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
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

    /* --- Collapsed sidebar --- */
    'button#sidebar.collapsed-page': {
        ui: {
            base: 'h-[40px] w-[40px] flex items-center justify-center bg-transparent hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0 text-[var(--md-on-surface)] rounded-xl p-0!',
            leadingIcon: 'w-5 h-5',
        },
    },
    'button#sidebar.collapsed-page:active': {
        ui: {
            base: 'h-[40px] w-[40px] flex items-center justify-center bg-[var(--md-surface-active)] hover:bg-[var(--md-surface-active)] border-0 text-[var(--md-on-surface)] rounded-xl p-0!',
            leadingIcon: 'w-5 h-5',
        },
    },
};

export const sidebarCssSelectors = {
    // No border on sidebar - ChatGPT style
    '#sidebar-container-outer': {
        style: {
            borderRight: 'none',
            backgroundColor: 'var(--md-surface-variant)',
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
            borderRadius: '10px',
            boxShadow: 'none',
        },
    },
    '#top-header': {
        style: {
            backgroundColor: 'var(--md-surface-variant)',
        },
    },
    '.sidebar-section-heading': {
        style: {
            fontSize: '12px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--md-on-surface-variant)',
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
    '#nav-collapsed-container': {
        style: {
            minWidth: '64px !important',
            maxWidth: '64px !important',
            width: '64px !important',
            borderRight: 'none',
            backgroundColor: 'var(--md-surface-variant)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
        },
    },
    // Fix the wrapper width set by PageShell on the collapsed slot
    '#sidebar-content-collapsed': {
        style: {
            width: '64px !important',
            minWidth: '64px !important',
            maxWidth: '64px !important',
        },
    },
    // Bottom nav: match rail width and center contents
    '.bottomnav-root': {
        style: {
            width: '64px !important',
            borderTop: 'none',
            paddingBottom: '8px',
            paddingTop: '4px',
        },
    },
    // Page buttons section: center within the 64px rail
    '#nav-pages-section': {
        style: {
            borderTop: 'none',
            alignItems: 'center',
        },
    },
    // Top section buttons: center within the 64px rail
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
    // Footer section: center
    '#nav-footer-section': {
        style: {
            alignItems: 'center',
            paddingLeft: '0',
            paddingRight: '0',
        },
    },
};

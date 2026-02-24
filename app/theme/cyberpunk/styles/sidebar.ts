const SidebarPopoverButtonConfig = {
    class: 'justify-start font-normal !normal-case shadow-none!',
    variant: 'ghost',
    size: 'sm',
    ui: {
        base: 'text-[13px]!',
    },
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
    'button#ui.glass-button': {
        activeClass: 'bg-[var(--md-primary)]/20',
        class: 'font-[IBM_Plex_Sans] text-[12px] font-normal border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur',
    },
    'div#sidebar.project-group-container': {
        class: 'font-[IBM_Plex_Sans] text-[12px] font-normal border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/30 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] backdrop-blur theme-shadow',
    },
    'button#sidebar.new-chat': {
        variant: 'solid',
        color: 'primary',
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-primary-shade)]! rounded-[var(--md-border-radius)] text-[var(--md-on-primary)]!',
        },
    },

    // Collapsed page buttons (Home, custom pages)
    'button#sidebar.collapsed-page': {
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]',
            leadingIcon: 'w-5 h-5',
        },
    },
    'button#sidebar.collapsed-page:active': {
        ui: {
            base: 'bg-[var(--md-primary)]/20 border-[length:var(--md-border-width)] border-[color:var(--md-primary-border)] rounded-[var(--md-border-radius)] text-[var(--md-primary-shade)]',
            leadingIcon: 'w-5 h-5',
        },
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

    'button#sidebar.toggle': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
    },

    /* --- Collapsed sidebar action buttons (search, new doc, new project) --- */
    'button#sidebar.collapsed-search': {
        size: 'sb-square' as const,
        square: true,
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
        },
    },
    'button#sidebar.new-document': {
        size: 'sb-square' as const,
        square: true,
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
        },
    },
    'button#sidebar.new-project': {
        size: 'sb-square' as const,
        square: true,
        ui: {
            base: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
        },
    },

    /* --- Sidebar bottom nav buttons --- */
    'button#sidebar.bottom-nav.dashboard': {
        class: 'h-[48px] w-[48px]! flex flex-col items-center gap-1 py-1.5 border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
    },
    'button#sidebar.bottom-nav.info': {
        class: 'h-[48px] w-[48px] flex flex-col items-center gap-1 py-1.5 bg-transparent border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)] hover:bg-[var(--md-info-hover)]! active:bg-[var(--md-info-active)]!',
    },
    'button#sidebar.bottom-nav.connect': {
        variant: 'outline',
        class: 'h-[48px] w-[48px] flex flex-col items-center gap-1 py-1.5 border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface)]! transition-colors duration-150',
    },
    'button#sidebar.bottom-nav.settings': {
        variant: 'outline',
        class: 'h-[48px] w-[48px] flex flex-col items-center gap-1 py-1.5 border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface)]! transition-colors duration-150',
    },
};

export const sidebarCssSelectors = {
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
};

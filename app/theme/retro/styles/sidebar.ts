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

// Project settings use the same surface, border and elevation tokens as the sidebar.
const ProjectSettingsFieldConfig = {
    ui: {
        base: 'border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-small,var(--md-border-radius))]! bg-[var(--md-surface)]! text-[var(--md-on-surface)]! text-[17px]! ring-0! shadow-[var(--app-elevation-low)]! hover:border-[color:var(--md-primary)]! focus-visible:border-[color:var(--md-primary)]! focus-visible:outline-2! focus-visible:outline-[var(--md-primary)]! focus-visible:outline-offset-2!',
    },
};
const ProjectSettingsSelectConfig = {
    ...ProjectSettingsFieldConfig,
    ui: {
        ...ProjectSettingsFieldConfig.ui,
        base: `${ProjectSettingsFieldConfig.ui.base} min-h-[var(--app-control-height-medium,40px)]! max-md:min-h-[44px]!`,
        content: 'bg-[var(--md-surface)]! text-[var(--md-on-surface)]! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-small,var(--md-border-radius))]! ring-0! shadow-[var(--app-elevation-medium)]!',
        item: 'text-[17px]!',
        trailingIcon: 'size-6!',
    },
};
const ProjectSettingsButtonConfig = {
    size: 'sm',
    variant: 'outline',
    class: 'text-[17px]! min-h-[var(--app-control-height-small,32px)]! max-md:min-h-[44px]! ring-0! focus-visible:outline-2! focus-visible:outline-[var(--md-primary)]! focus-visible:outline-offset-2!',
};

// Native project fields retain Blank's geometry and browser validation.
const ProjectResourceFieldConfig = {
    class: 'border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-small,var(--md-border-radius))]! bg-[var(--md-surface)]! text-[var(--md-on-surface)]! text-[17px]! shadow-[var(--app-elevation-low)]! focus-visible:outline-2! focus-visible:outline-[var(--md-primary)]! focus-visible:outline-offset-2!',
};
const ProjectResourceMenuConfig = {
    ui: {
        content: 'bg-[var(--md-surface)]! text-[var(--md-on-surface)]! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-small,var(--md-border-radius))]! ring-0! shadow-[var(--app-elevation-medium)]!',
        item: 'text-[17px]! min-h-[var(--app-control-height-medium,40px)]! max-md:min-h-[44px]!',
        itemLeadingIcon: 'size-6!',
    },
};

export const sidebarOverrides = {
    /* --- Project Knowledge and Memory --- */
    'input#sidebar.project-content.field': ProjectResourceFieldConfig,
    'textarea#sidebar.project-content.field': ProjectResourceFieldConfig,
    'select#sidebar.project-content.field': {
        class: `${ProjectResourceFieldConfig.class} min-h-[var(--app-control-height-medium,40px)]! max-md:min-h-[44px]!`,
    },
    'button#sidebar.project-content.action': ProjectSettingsButtonConfig,
    'button#sidebar.project-content.save': {
        ...ProjectSettingsButtonConfig,
        color: 'primary',
        variant: 'solid',
        class: `${ProjectSettingsButtonConfig.class} bg-[var(--md-primary)]! text-[var(--md-on-primary)]! hover:bg-[var(--md-primary-hover)]! active:bg-[var(--md-primary-active)]!`,
        ui: { leadingIcon: 'size-6!' },
    },
    'button#sidebar.project-content.source-menu-item': {
        variant: 'ghost',
        class: 'border-0! shadow-none! text-[17px]! min-h-[var(--app-control-height-medium,40px)]! max-md:min-h-[44px]! text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)]! active:bg-[var(--md-surface-active)]!',
        ui: { leadingIcon: 'size-6!' },
    },
    'popover#sidebar.project-content.source-menu': ProjectResourceMenuConfig,
    'dropdownmenu#sidebar.project-content.memory-menu': ProjectResourceMenuConfig,
    'button#sidebar.project-content.memory-actions': {
        variant: 'ghost',
        class: 'border-0! shadow-none! size-8! max-md:size-11! p-0! text-[var(--md-on-surface-variant)]! hover:bg-[var(--md-surface-hover)]! hover:text-[var(--md-on-surface)]! focus-visible:outline-2! focus-visible:outline-[var(--md-primary)]! focus-visible:outline-offset-2!',
        ui: { leadingIcon: 'size-6!' },
    },
    /* --- Project settings --- */
    'textarea#sidebar.project-settings.instructions': ProjectSettingsFieldConfig,
    'textarea#sidebar.project-settings.repositories': ProjectSettingsFieldConfig,
    'selectmenu#sidebar.project-settings.model': ProjectSettingsSelectConfig,
    'input#sidebar.project-settings.tool-search': {
        ...ProjectSettingsFieldConfig,
        ui: {
            ...ProjectSettingsFieldConfig.ui,
            base: `${ProjectSettingsFieldConfig.ui.base} h-[var(--app-control-height-medium,40px)]! max-md:h-[44px]!`,
            leadingIcon: 'size-6!',
        },
    },
    'select#sidebar.project-settings.permission': ProjectSettingsSelectConfig,
    'button#sidebar.project-settings.save': {
        ...ProjectSettingsButtonConfig,
        color: 'primary',
        variant: 'solid',
        class: `${ProjectSettingsButtonConfig.class} disabled:opacity-100! disabled:bg-[var(--md-surface-container-low)]! disabled:text-[var(--md-on-surface-variant)]! disabled:shadow-none!`,
    },
    'button#sidebar.project-settings.discard': ProjectSettingsButtonConfig,
    'button#sidebar.project-settings.action': ProjectSettingsButtonConfig,
    'button#sidebar.project-settings.remove': {
        ...ProjectSettingsButtonConfig,
        ui: { leadingIcon: 'size-6!' },
    },
    'switch#sidebar.project-settings.memory': { size: 'md' },
    /* --- core --- */
    'button#sidebar.unified-item.trigger': {
        class: 'flex items-center justify-center shadow-none!',
    },
    'button#sidebar.family-toggle': {
        icon: 'pixelarticons:chevron-right',
        ui: { leadingIcon: 'size-6' },
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

const shellChromeButton = {
    variant: 'ghost' as const,
    color: 'neutral' as const,
    size: 'sm' as const,
    class: 'theme-btn workspace-chrome-action bg-transparent!',
    ui: { base: 'theme-btn workspace-chrome-action' },
};

export const shellOverrides = {
    'modal#shell.tab-switcher': {
        class: 'workspace-tab-switcher-root',
    },
    // Mobile header hamburger — icon only, no chrome box.
    'button#shell.sidebar-toggle': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
        class: 'bg-transparent! border-0! shadow-none! [--tw-shadow:none]! ring-0!',
        ui: {
            base: 'bg-transparent! border-0! shadow-none! [--tw-shadow:none]! ring-0!',
        },
    },
    'button#shell.tab-new': shellChromeButton,
    'button#shell.tab-overflow': {
        ...shellChromeButton,
        class: `${shellChromeButton.class} gap-1`,
    },
    'input#shell.tab-switcher-search': {
        variant: 'soft' as const,
        color: 'neutral' as const,
        size: 'md' as const,
        class: 'w-full',
        ui: {
            root: 'w-full',
            base: 'w-full',
        },
    },
    'button#shell.tab-switcher-new': {
        variant: 'outline' as const,
        color: 'neutral' as const,
        size: 'md' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-switcher-done': {
        variant: 'solid' as const,
        color: 'primary' as const,
        size: 'md' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'selectmenu#shell.tab-switcher-sort': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
    },
    'button#shell.tab-close': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
        class: 'theme-btn bg-transparent!',
        ui: { base: 'theme-btn' },
    },
};

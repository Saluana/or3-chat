const shellChromeButton = {
    variant: 'ghost' as const,
    color: 'neutral' as const,
    size: 'sm' as const,
    class:
        'theme-btn workspace-chrome-action border-0! shadow-none! bg-transparent! hover:bg-[var(--md-surface-hover)]!',
    ui: { base: 'theme-btn' },
};

export const shellOverrides = {
    'button#shell.tab-new': shellChromeButton,
    'button#shell.tab-overflow': {
        ...shellChromeButton,
        class: `${shellChromeButton.class} gap-1`,
    },
    'button#shell.tab-close': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
        class: 'theme-btn border-0 shadow-none',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-active': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        class: 'border-0 shadow-none',
    },
    'modal#shell.tab-switcher': {
        class: 'workspace-tab-switcher-root',
    },
    'input#shell.tab-switcher-search': {
        variant: 'soft' as const,
        color: 'neutral' as const,
        size: 'lg' as const,
        class: 'w-full',
        ui: {
            root: 'w-full',
            base: 'w-full',
        },
    },
    'button#shell.tab-switcher-new': {
        variant: 'outline' as const,
        color: 'neutral' as const,
        size: 'lg' as const,
        class: 'theme-btn border border-[color:var(--md-border-color)]',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-switcher-done': {
        variant: 'solid' as const,
        color: 'primary' as const,
        size: 'lg' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'selectmenu#shell.tab-switcher-sort': {
        variant: 'soft' as const,
        color: 'neutral' as const,
        size: 'md' as const,
    },
};

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
    'button#shell.tab-new': shellChromeButton,
    'button#shell.tab-overflow': {
        ...shellChromeButton,
        class: `${shellChromeButton.class} gap-1`,
    },
    'button#shell.tab-switcher-new': {
        variant: 'outline' as const,
        color: 'neutral' as const,
        size: 'lg' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-switcher-done': {
        variant: 'solid' as const,
        color: 'primary' as const,
        size: 'lg' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-switcher-sort': {
        variant: 'outline' as const,
        color: 'neutral' as const,
        size: 'md' as const,
        class: 'theme-btn',
        ui: { base: 'theme-btn' },
    },
    'button#shell.tab-close': {
        variant: 'ghost' as const,
        color: 'neutral' as const,
        size: 'sm' as const,
        class: 'theme-btn bg-transparent!',
        ui: { base: 'theme-btn' },
    },
};

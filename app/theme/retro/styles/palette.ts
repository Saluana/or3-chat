/** Command palette overrides: hard borders, offset shadow, pixel type. */
const paletteActionButton = {
    color: 'on-surface' as const,
    variant: 'ghost' as const,
    size: 'sm' as const,
    class: 'justify-start font-light !normal-case shadow-none!',
    ui: {
        base: 'text-[14px]! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] bg-[var(--md-surface)]/40',
    },
};

export const paletteOverrides = {
    'modal#modal.command-palette': {
        class: 'theme-shadow border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] ring-0',
        ui: {
            overlay: 'bg-black/50',
        },
    },
    'command-palette#command-palette.shell': {
        class: 'font-[IBM_Plex_Sans]',
    },
    'button#command-palette.primary-action': {
        color: 'primary' as const,
        variant: 'solid' as const,
        size: 'sm' as const,
        class: 'justify-start !normal-case',
        ui: {
            base: 'text-[14px]! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)]',
        },
    },
    'button#command-palette.secondary-action': paletteActionButton,
};

export const paletteCssSelectors = {
    // Category chips read as pixel tabs rather than pills.
    '.or3-palette-chip': {
        style: {
            borderRadius: 'var(--md-border-radius)',
            borderWidth: 'var(--md-border-width)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
        },
    },
    '.or3-palette-option-icon': {
        style: {
            borderWidth: 'var(--md-border-width)',
        },
    },
    '.or3-palette-query': {
        style: {
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
};

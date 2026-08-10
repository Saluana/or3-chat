/** Command palette overrides: soft, rounded, borderless surfaces. */
const paletteActionButton = {
    color: 'neutral' as const,
    variant: 'ghost' as const,
    size: 'sm' as const,
    ui: {
        base: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0 text-[color:var(--md-on-surface)] hover:bg-[color:var(--md-surface-hover)] active:bg-[color:var(--md-surface-active)]',
    },
};

export const paletteOverrides = {
    'modal#modal.command-palette': {
        class: 'sm:rounded-[var(--md-border-radius-large,var(--md-border-radius))] shadow-2xl ring-0',
        ui: {
            overlay: 'bg-black/40 backdrop-blur-[2px]',
        },
    },
    'command-palette#command-palette.shell': {
        class: 'sm:rounded-[var(--md-border-radius-large,var(--md-border-radius))]',
    },
    'button#command-palette.primary-action': {
        color: 'primary' as const,
        variant: 'solid' as const,
        size: 'sm' as const,
        ui: { base: 'rounded-[var(--md-border-radius-small,var(--md-border-radius))] border-0' },
    },
    'button#command-palette.secondary-action': paletteActionButton,
};

export const paletteCssSelectors = {
    '.or3-palette-option': {
        style: {
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius))',
        },
    },
};

/** Command palette overrides: soft, rounded, borderless surfaces. */
const paletteActionButton = {
    color: 'neutral' as const,
    variant: 'ghost' as const,
    size: 'sm' as const,
    ui: {
        base: 'rounded-xl border-0 text-[color:var(--md-on-surface)] hover:bg-[color:var(--md-surface-hover)] active:bg-[color:var(--md-surface-active)]',
    },
};

export const paletteOverrides = {
    'modal#modal.command-palette': {
        class: 'sm:rounded-2xl shadow-2xl ring-0',
        ui: {
            overlay: 'bg-black/40 backdrop-blur-[2px]',
        },
    },
    'command-palette#command-palette.shell': {
        class: 'sm:rounded-2xl',
    },
    'button#command-palette.primary-action': {
        color: 'primary' as const,
        variant: 'solid' as const,
        size: 'sm' as const,
        ui: { base: 'rounded-xl border-0' },
    },
    'button#command-palette.secondary-action': paletteActionButton,
};

export const paletteCssSelectors = {
    '.or3-palette-option': {
        style: {
            borderRadius: '12px',
        },
    },
};

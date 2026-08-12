/** Command palette overrides: angular frame, neon glow, mono labels. */
const paletteActionButton = {
    color: 'neutral' as const,
    variant: 'outline' as const,
    size: 'sm' as const,
    class: 'justify-start',
    ui: {
        base: 'text-[13px]! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[color:var(--md-on-surface)]! hover:border-[color:var(--md-primary)] transition-colors duration-150',
    },
};

export const paletteOverrides = {
    'modal#modal.command-palette': {
        class: 'theme-shadow border-[length:var(--md-border-width)] border-[color:var(--md-primary)]/60 ring-0',
        ui: {
            overlay: 'bg-black/65 backdrop-blur-[1px]',
        },
    },
    'command-palette#command-palette.shell': {
        class: 'font-[IBM_Plex_Sans]',
    },
    'button#command-palette.primary-action': {
        color: 'primary' as const,
        variant: 'solid' as const,
        size: 'sm' as const,
        class: 'justify-start uppercase tracking-wider',
        ui: {
            base: 'text-[13px]! rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-primary)]',
        },
    },
    'button#command-palette.secondary-action': paletteActionButton,
};

export const paletteCssSelectors = {
    '.or3-palette-chip': {
        style: {
            borderRadius: 'var(--md-border-radius)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
        },
    },
    '.or3-palette-option-icon': {
        style: {
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.or3-palette-listbox [aria-selected="true"]': {
        style: {
            boxShadow: 'inset 0 0 12px color-mix(in srgb, var(--md-primary) 22%, transparent)',
        },
    },
    '.or3-palette-footer': {
        style: {
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
        },
    },
};

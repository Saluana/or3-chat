// Shared button config for attach and settings buttons
const chatInputButtonConfig = {
    variant: 'soft' as const,
    size: 'sm' as const,
    class: 'min-h-[32px] w-[32px] text-primary flex items-center justify-center p-0 rounded-[var(--md-border-radius)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
};

export const chatOverrides = {
    'div#chat.input-main-container': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus-within:border-[color:var(--md-primary)] focus-within:ring-1 focus-within:ring-[color:var(--md-primary)] shadow-lg',
    },
    'button#chat.attach': chatInputButtonConfig,
    'button#chat.settings': chatInputButtonConfig,
    'selectmenu#chat.model-select': {
        class: 'h-[32px] text-sm rounded-md border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px] ring-0! hover:ring-1! focus-visible:ring-1! cursor-pointer focus-visible:ring-[color:var(--md-primary)]!',
    },
    // All ChatMessage action buttons (copy/retry/branch/edit/etc.)
    'button.message': {
        class: 'flex items-center justify-center bg-info text-[var(--md-on-surface)]/90 hover:bg-primary/10 active:bg-[var(--md-info)]/80',
    },
};

export const chatCssSelectors = {
    '#btn-reasoning-toggle': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.reasoning-box': {
        style: {
            background: 'var(--md-surface)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.cm-text-user': {
        style: {
            fontFamily:
                '"IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important',
            fontSize: '16px',
        },
    },
    '.cm-action-group': {
        style: {
            backgroundColor: 'var(--md-surface-container-high)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        },
    },
};

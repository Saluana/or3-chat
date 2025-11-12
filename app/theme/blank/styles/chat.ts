// Shared button config for attach and settings buttons
const chatInputButtonConfig = {
    variant: 'soft' as const,
    size: 'sm' as const,
    class: 'min-h-[32px] w-[32px] text-primary flex items-center justify-center p-0 rounded-[var(--md-border-radius)] hover:bg-[var(--md-primary)]/10 active:bg-[var(--md-primary)]/20 border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
};

export const chatOverrides = {
    /* --- Chat Content --- */
    'button#shell.pane-close': {
        class: 'backdrop-blur!',
    },
    // All ChatMessage action buttons (copy/retry/branch/edit/etc.)
    'button.message': {
        class: 'flex items-center justify-center bg-info text-[var(--md-on-surface)]/90 hover:bg-primary/10 active:bg-[var(--md-info)]/80',
    },
    /* --- Chat Input --- */
    'div#chat.editor': {
        class: 'font-[IBM_Plex_Sans] text-[16px]',
    },
    'div#chat.input-main-container': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus-within:border-[color:var(--md-primary)] focus-within:ring-1 focus-within:ring-[color:var(--md-primary)] shadow-lg',
    },
    'button#chat.attach': chatInputButtonConfig,
    'button#chat.settings': chatInputButtonConfig,
    'selectmenu#chat.model-select': {
        class: 'h-[32px] text-sm rounded-md border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px] ring-0! hover:ring-1! focus-visible:ring-1! cursor-pointer focus-visible:ring-[color:var(--md-primary)]!',
    },
    'button.settings': {
        class: 'rounded-none text-[var(--md-on-surface)]/90 hover:bg-primary/10 active:bg-[var(--md-info)]/80 not-last:border-b-[length:var(--md-border-width)] not-last:border-b-[color:var(--md-border-color)] last:rounded-b-[var(--md-border-radius)]',
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
    // Chat container vertical dividers: apply a right border to every chat container except the last one
    '.chat-container-root:not(:last-child)': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    // Only add a top border when there are multiple panes: apply to any pane that is not the first child
    '.chat-container-root:not(:first-child)': {
        style: {
            borderTop:
                'var(--md-border-width) solid var(--md-border-color) !important',
        },
    },
    '.cm-assistant': {
        style: {
            backgroundColor: 'transparent',
        },
    },
};

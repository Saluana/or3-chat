// Shared config for chat input action buttons
const chatInputButtonConfig = {
    variant: 'soft' as const,
    size: 'sm' as const,
    class: 'min-h-[32px] w-[32px] text-primary flex items-center justify-center p-0 rounded-[var(--md-border-radius)] hover:bg-[var(--md-info-hover)] active:bg-[var(--md-surface-active)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)]',
};

export const chatOverrides = {
    /* --- Chat Content --- */
    'button#shell.pane-close': {
        class: 'backdrop-blur! flex items-center justify-center theme-btn',
    },
    'button#chat.scroll-to-bottom': {
        trailing: true,
        class: 'text-xs bg-primary/20 text-[var(--md-on-surface)] backdrop-blur-xl hover:bg-primary/30 active:bg-primary/40 rounded-full border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] p-2 flex items-center justify-center',
        label: 'Scroll to bottom',
    },
    // User message container — darker cyan bg for readability
    'div#message.user-container': {
        class: 'bg-[var(--md-primary-container)]! text-[var(--md-on-primary-container)]!',
    },
    // Chat message action buttons
    'button.message': {
        class: 'flex items-center justify-center bg-info text-[var(--md-on-info)] hover:bg-[var(--md-info-hover)] active:bg-[var(--md-info)]/80 shadow-none!',
    },
    'button#message.reasoning-toggle': {
        class: 'flex items-center justify-center bg-info/20 text-[var(--md-on-surface)]/90 hover:bg-[var(--md-info-hover)]/30 active:bg-[var(--md-info)]/80',
    },

    /* --- Chat Input --- */
    'button#chat.send': {
        variant: 'solid',
        color: 'primary',
        class: 'theme-btn flex items-center justify-center bg-primary hover:bg-[var(--md-primary-hover)]! active:bg-[var(--md-primary-active)]! disabled:bg-primary! disabled:opacity-40! aria-disabled:bg-primary! aria-disabled:opacity-40! text-[var(--md-on-primary)]!',
    },
    'button#chat.stop': {
        variant: 'solid',
        color: 'error',
        class: 'theme-btn',
    },
    'div#chat.editor': {
        class: 'font-[IBM_Plex_Sans] text-[15px]',
    },
    'div#chat.input-main-container': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus-within:border-[color:var(--md-primary)] focus-within:ring-1 focus-within:ring-[color:var(--md-primary)] shadow-lg',
    },
    'button#chat.attach': chatInputButtonConfig,
    'button#chat.settings': chatInputButtonConfig,
    'selectmenu#chat.model-select': {
        class: 'h-[32px] rounded-[var(--md-border-radius)] border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] px-2 bg-[var(--md-surface)] w-full min-w-[100px] max-w-[320px] ring-0! hover:ring-1! focus-visible:ring-1! cursor-pointer focus-visible:ring-[color:var(--md-primary)]! text-[13px]!',
        ui: {
            base: 'text-[13px]!',
            value: 'text-[13px]!',
            placeholder: 'text-[13px]!',
            item: 'text-[13px]!',
            itemLabel: 'text-[13px]!',
            content:
                'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[13px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[13px]! rounded-none border-x-0 border-t-0 border-b-[length:var(--md-border-width)] border-b-[color:var(--md-border-color)]',
            },
        },
    },
    'button.settings': {
        variant: 'basic',
        class: 'rounded-none border-x-0 border-t-0 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] not-last:border-b-[length:var(--md-border-width)] not-last:border-b-[color:var(--md-border-color)] last:border-b-0 last:rounded-b-[var(--md-border-radius)]',
        ui: {
            label: 'text-[13px]!',
        },
    },
    'modal#dashboard.shell': {
        ui: {
            body: 'p-0!',
        },
    },
};

export const chatCssSelectors = {
    '#btn-reasoning-toggle': {
        style: {
            backgroundColor: 'var(--md-surface) !important',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '#btn-reasoning-toggle:hover': {
        style: {
            backgroundColor: 'var(--md-surface-hover) !important',
        },
    },

    /* --- Tool Call Indicators --- */
    '.tool-call-indicator': {
        style: {
            borderRadius: 'var(--md-border-radius)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            overflow: 'hidden',
            marginTop: '8px',
            marginBottom: '8px',
        },
    },
    '.tool-call-indicator-details': {
        style: {
            background: 'transparent !important',
            border: 'none !important',
        },
    },
    '.tool-call-indicator-summary': {
        style: {
            background: 'transparent !important',
            padding: '10px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
    },
    '.tool-call-indicator-summary:hover': {
        style: {
            backgroundColor: 'var(--md-surface-hover) !important',
        },
    },
    '.tool-call-expanded-content': {
        style: {
            borderTop: 'var(--md-border-width) solid var(--md-border-color)',
            padding: '12px',
            backgroundColor: 'var(--md-surface-container-lowest)',
        },
    },
    '.retro-tool-call-content': {
        style: {
            backgroundColor: 'var(--md-surface) !important',
            border: 'none !important',
            borderRadius: 'var(--md-border-radius) !important',
            fontFamily: '"IBM Plex Mono", monospace !important',
            fontSize: '12px !important',
            padding: '12px !important',
            margin: '8px 0 !important',
            overflowX: 'auto',
            color: 'var(--md-on-surface)',
        },
    },
    '.tool-call-header-text': {
        style: {
            color: 'var(--md-on-surface)',
            fontSize: '13px',
            fontWeight: '500',
            fontFamily: '"IBM Plex Mono", monospace',
        },
    },
    '.tool-call-header-text:nth-of-type(2)': {
        style: {
            fontSize: '10px !important',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontFamily: '"IBM Plex Mono", monospace !important',
            padding: '2px 8px',
            borderRadius: 'var(--md-border-radius)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.tool-call-indicator-summary-icon': {
        style: {
            color: 'var(--md-primary) !important',
            display: 'flex',
            alignItems: 'center',
        },
    },
    '.tool-call-indicator-summary-icon .iconify': {
        style: {
            color: 'var(--md-primary) !important',
        },
    },
};

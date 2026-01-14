// Shared button config for attach and settings buttons
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
        class: 'text-xs bg-primary/20 text-[var(--md-on-surface)] backdrop-blur-xl hover:bg-primary/30 active:bg-primary/40 retro-shadow rounded-full border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] p-2 flex items-center justify-center',
        label: 'Scroll to bottom',
    },
    // All ChatMessage action buttons (copy/retry/branch/edit/etc.)
    'button.message': {
        class: 'flex items-center justify-center bg-info text-[var(--md-on-info)] hover:bg-[var(--md-info-hover)] active:bg-[var(--md-info)]/80 shadow-none!',
    },
    'button#message.reasoning-toggle': {
        class: 'flex items-center justify-center bg-info/20 text-[var(--md-on-surface)]/90 hover:bg-[var(--md-info-hover)]/30 active:bg-[var(--md-info)]/80 retro-shadow',
    },
    /* --- Chat Input --- */
    'button#chat.send': {
        variant: 'solid',
        color: 'primary',
        class: 'theme-btn flex items-center justify-center bg-primary hover:bg-[var(--md-primary-hover)]! active:bg-[var(--md-primary-active)]! disabled:bg-primary! disabled:opacity-40! aria-disabled:bg-primary! aria-disabled:opacity-40! text-white! retro-press',
    },
    'button#chat.stop': {
        variant: 'solid',
        color: 'error',
        class: 'theme-btn retro-press',
    },
    'div#chat.editor': {
        class: 'font-[IBM_Plex_Sans] text-[16px]',
    },
    'div#chat.input-main-container': {
        class: 'border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] hover:border-[color:var(--md-primary)] focus-within:border-[color:var(--md-primary)] focus-within:ring-1 focus-within:ring-[color:var(--md-primary)] shadow-lg',
    },
    'button#chat.attach': chatInputButtonConfig,
    'button#chat.settings': chatInputButtonConfig,
    'selectmenu#chat.model-select': {
        class: 'h-[32px] rounded-md border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] px-2 bg-white dark:bg-gray-800 w-full min-w-[100px] max-w-[320px] ring-0! hover:ring-1! focus-visible:ring-1! cursor-pointer focus-visible:ring-[color:var(--md-primary)]! text-[14px]!',
        ui: {
            base: 'text-[14px]!',
            value: 'text-[14px]!',
            placeholder: 'text-[14px]!',
            item: 'text-[14px]!',
            itemLabel: 'text-[14px]!',
            content:
                'ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[14px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[14px]! rounded-none border-x-0 border-t-0 border-b-[length:var(--md-border-width)] border-b-[color:var(--md-border-color)]',
            },
        },
    },
    'button.settings': {
        variant: 'basic',
        class: 'rounded-none border-x-0 border-t-0 text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] not-last:border-b-[length:var(--md-border-width)] not-last:border-b-[color:var(--md-border-color)] last:border-b-0 last:rounded-b-[var(--md-border-radius)]',
        ui: {
            label: 'text-[14px]!',
        },
    },
    'modal#dashboard.shell': {
        ui: {
            body: 'p-0!',
        },
    },
    'div#message.user-container': {
        class: 'px-4! pt-3! pb-8! bg-[var(--md-primary-border)] rounded-[var(--md-border-radius)] retro-shadow',
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
            boxShadow: '2px 2px 0 var(--md-border-color)',
            opacity: '0',
            transition: 'opacity 0.2s ease-in-out',
        },
    },
    '.group:hover .cm-action-group': {
        style: {
            opacity: '1',
        },
    },
    '.group:focus-within .cm-action-group': {
        style: {
            opacity: '1',
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
            boxShadow: '2px 2px 0 var(--md-border-color)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.cm-user': {
        style: {
            boxShadow: '2px 2px 0 var(--md-border-color)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            marginBottom: '20px',
        },
    },
    '.chat-settings-switch': {
        style: {
            height: '32px',
        },
    },
    '#btn-collapse-attachments': {
        style: {
            backgroundColor: 'transparent !important',
            color: 'var(--md-on-primary) !important',
            cursor: 'pointer',
        },
    },
    // Tool call indicator styling
    '.tool-call-indicator': {
        style: {
            backgroundColor: 'var(--md-surface)',
            borderRadius: 'var(--md-border-radius)',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            overflow: 'hidden',
            boxShadow: '2px 2px 0 var(--md-border-color)',
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
            backgroundColor: 'var(--md-surface-container) !important',
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
            fontSize: '14px',
            fontWeight: '500',
        },
    },
    // Status text (second span)
    '.tool-call-header-text:nth-of-type(2)': {
        style: {
            fontSize: '10px !important',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            backgroundColor: 'var(--md-surface-container-high)',
            color: 'var(--md-on-surface) !important',
            padding: '2px 8px',
            borderRadius: 'var(--md-border-radius)',
            border: 'var(--md-border-width) solid var(--md-outline-variant)',
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
    '.cm-actions-user': {
        style: {
            bottom: '-24px !important',
        },
    },
};

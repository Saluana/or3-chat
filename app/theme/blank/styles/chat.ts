// ChatGPT-style button config: minimal, borderless, round
const chatInputButtonConfig = {
    variant: 'ghost' as const,
    size: 'sm' as const,
    class: 'min-h-[36px] w-[36px] text-[var(--md-on-surface-variant)] flex items-center justify-center p-0 rounded-full hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0',
};

export const chatOverrides = {
    'button#shell.pane-close': {
        class: 'flex items-center justify-center border-0',
    },
    'button#chat.scroll-to-bottom': {
        trailing: true,
        class: 'text-xs bg-[var(--md-surface)] text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] shadow-md rounded-full border-0 p-2 flex items-center justify-center',
        label: 'Scroll to bottom',
    },
    // Message action buttons: subtle gray icons
    'button.message': {
        class: 'flex items-center justify-center bg-transparent text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0 rounded-lg',
    },
    'button#message.reasoning-toggle': {
        class: 'flex items-center justify-center bg-transparent text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0 rounded-lg',
    },
    /* --- Chat Input --- */
    'button#chat.send': {
        variant: 'solid',
        color: 'primary',
        class: 'theme-btn flex items-center justify-center bg-[var(--md-on-surface)] hover:bg-[var(--md-on-surface)]/80! active:bg-[var(--md-on-surface)]/70! disabled:opacity-30! aria-disabled:opacity-30! text-[var(--md-surface)]! rounded-full! border-0!',
    },
    'button#chat.stop': {
        variant: 'solid',
        color: 'error',
        class: 'rounded-full! border-0!',
    },
    'div#chat.editor': {
        class: 'text-[16px]',
    },
    'div#chat.input-main-container': {
        class: 'rounded-[28px] shadow-[0_4px_8px_rgba(0,0,0,0.04)] border-0 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] focus-within:shadow-[0_4px_16px_rgba(0,0,0,0.1)]',
    },
    'button#chat.attach': chatInputButtonConfig,
    'button#chat.settings': chatInputButtonConfig,
    'selectmenu#chat.model-select': {
        class: 'h-[36px] rounded-full border-0 px-3 bg-transparent w-full min-w-[100px] max-w-[320px] ring-0! hover:bg-[var(--md-surface-hover)]! cursor-pointer text-[14px]!',
        ui: {
            base: 'text-[14px]!',
            value: 'text-[14px]!',
            placeholder: 'text-[14px]!',
            item: 'text-[14px]!',
            itemLabel: 'text-[14px]!',
            content:
                'ring-0! border-0! rounded-xl bg-[var(--md-surface)] shadow-lg text-[14px]!',
        },
        searchInput: {
            ui: {
                base: 'text-[14px]! rounded-none shadow-none! rounded-t-xl!',
            },
        },
    },
    'button.settings': {
        class: 'rounded-none text-[var(--md-on-surface)] hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)] border-0',
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
        class: 'px-4! py-3! bg-[var(--md-surface-hover)] rounded-[18px]',
    },
};

export const chatCssSelectors = {
    '#btn-reasoning-toggle': {
        style: {
            backgroundColor: 'var(--md-surface-hover)',
            border: 'none',
            borderRadius: '10px',
        },
    },
    '#btn-reasoning-toggle:hover': {
        style: {
            backgroundColor: 'var(--md-surface-active)',
        },
    },
    '.reasoning-box': {
        style: {
            background: 'var(--md-surface-hover)',
            border: 'none',
            borderRadius: '12px',
        },
    },
    '.cm-text-user': {
        style: {
            fontSize: '16px',
            color: 'var(--md-on-surface)',
        },
    },
    '.cm-action-group': {
        style: {
            backgroundColor: 'var(--md-surface)',
            border: 'none',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
            borderRadius: '8px',
            opacity: '0',
            transition: 'opacity 0.15s ease',
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
    '.chat-container-root:not(:last-child)': {
        style: {
            borderRight: '1px solid var(--md-border-color)',
        },
    },
    '.chat-container-root:not(:first-child)': {
        style: {
            borderTop: '1px solid var(--md-border-color) !important',
        },
    },
    '.cm-assistant': {
        style: {
            backgroundColor: 'transparent',
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
            color: 'var(--md-on-surface-variant) !important',
            cursor: 'pointer',
        },
    },
    '.tool-call-indicator': {
        style: {
            backgroundColor: 'var(--md-surface-hover)',
            borderRadius: '12px',
            border: 'none',
            overflow: 'hidden',
            boxShadow: 'none',
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
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
    },
    '.tool-call-indicator-summary:hover': {
        style: {
            backgroundColor: 'var(--md-surface-active) !important',
        },
    },
    '.tool-call-expanded-content': {
        style: {
            borderTop: '1px solid var(--md-border-color)',
            padding: '12px',
            backgroundColor: 'var(--md-surface)',
        },
    },
    '.retro-tool-call-content': {
        style: {
            backgroundColor: 'var(--md-surface-hover) !important',
            border: 'none !important',
            borderRadius: '8px !important',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace !important',
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
    '.tool-call-header-text:nth-of-type(2)': {
        style: {
            fontSize: '10px !important',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            backgroundColor: 'var(--md-surface-active)',
            color: 'var(--md-on-surface) !important',
            padding: '2px 8px',
            borderRadius: '999px',
            border: 'none',
        },
    },
    '.tool-call-indicator-summary-icon': {
        style: {
            color: 'var(--md-on-surface-variant) !important',
            display: 'flex',
            alignItems: 'center',
        },
    },
    '.tool-call-indicator-summary-icon .iconify': {
        style: {
            color: 'var(--md-on-surface-variant) !important',
        },
    },
    '.cm-actions-user': {
        style: {
            bottom: '-24px !important',
        },
    },
};

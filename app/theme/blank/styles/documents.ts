export const documentsOverrides = {
    'button.document': {
        class: 'bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] border-0 rounded-xl',
    },
};
export const documentsStyles = {
    '.document-editor-root': {
        style: {
            fontFamily: 'var(--font-sans)',
        },
    },
    '.document-editor-root .editor-topbar': {
        style: {
            borderBottom: '1px solid var(--md-border-color)',
        },
    },
    '.document-editor-root .document-editor-toolbar': {
        style: {
            borderBottom: '1px solid var(--md-border-color)',
            boxShadow: '0 1px 2px color-mix(in srgb, var(--md-on-surface) 4%, transparent)',
        },
    },
    '.document-editor-root .document-inspector': {
        style: {
            borderLeft: '1px solid var(--md-border-color)',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .document-ai-composer': {
        style: {
            border: '1px solid var(--md-border-color)',
            borderRadius: '18px',
            boxShadow: '0 12px 36px color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
        },
    },
    '.document-editor-root .toolbar-overflow': {
        style: {
            border: '1px solid var(--md-border-color)',
            borderRadius: '12px',
            boxShadow: '0 12px 36px color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
        },
    },
    '.document-editor-root .selection-menu': {
        style: {
            border: '1px solid var(--md-border-color)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
        },
    },
    '.document-editor-root .slash-menu': {
        style: {
            border: '1px solid var(--md-border-color)',
            borderRadius: '12px',
            boxShadow: '0 18px 48px color-mix(in srgb, var(--md-on-surface) 12%, transparent)',
        },
    },
    '.document-editor-shell:not(:last-child)': {
        style: {
            borderRight: '1px solid var(--md-border-color)',
        },
    },
    '.document-editor-shell:not(:first-child)': {
        style: {
            borderTop: '1px solid var(--md-border-color) !important',
        },
    },
};

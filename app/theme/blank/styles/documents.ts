export const documentsOverrides = {
    'button.document': {
        class: 'bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] border-0 rounded-xl',
    },
};
export const documentsStyles = {
    '.document-editor-toolbar': {
        style: {
            borderBottom: '1px solid var(--md-border-color)',
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

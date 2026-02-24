export const documentsOverrides = {
    'button.document': {
        variant: 'solid',
        color: 'info',
        class: 'text-[var(--md-primary)] dark:text-[var(--md-primary-tint)]',
    },
};

export const documentsStyles = {
    '.document-editor-toolbar': {
        style: {
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.document-editor-shell:not(:last-child)': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.document-editor-shell:not(:first-child)': {
        style: {
            borderTop:
                'var(--md-border-width) solid var(--md-border-color) !important',
        },
    },
};

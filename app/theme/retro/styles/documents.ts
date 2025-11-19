export const documentsOverrides = {
    'button.document': {
        variant: 'solid',
        color: 'info',
        class: 'text-[var(--md-primary-shade)] dark:text-[var(--md-primary-tint)]',
    },
};
export const documentsStyles = {
    '.document-editor-toolbar': {
        style: {
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    // Chat container vertical dividers: apply a right border to every chat container except the last one
    '.document-editor-shell:not(:last-child)': {
        style: {
            borderRight: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    // Only add a top border when there are multiple panes: apply to any pane that is not the first child
    '.document-editor-shell:not(:first-child)': {
        style: {
            borderTop:
                'var(--md-border-width) solid var(--md-border-color) !important',
        },
    },
};

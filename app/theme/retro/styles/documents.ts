export const documentsOverrides = {
    'button.document': {
        variant: 'solid',
        color: 'info',
        class: 'text-[var(--md-primary-shade)] dark:text-[var(--md-primary-tint)]',
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
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
        },
    },
    '.document-editor-root .document-editor-toolbar': {
        style: {
            borderBottom: 'var(--md-border-width) solid var(--md-border-color)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 24%, transparent)',
        },
    },
    '.document-editor-root .document-inspector': {
        style: {
            borderLeft: 'var(--md-border-width) solid var(--md-border-color)',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .document-ai-composer': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '3px 3px 0 color-mix(in srgb, var(--md-border-color) 70%, transparent)',
            backdropFilter: 'none',
        },
    },
    '.document-editor-root .toolbar-overflow': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '3px 3px 0 color-mix(in srgb, var(--md-border-color) 70%, transparent)',
        },
    },
    '.document-editor-root .selection-menu': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '3px 3px 0 color-mix(in srgb, var(--md-border-color) 70%, transparent)',
        },
    },
    '.document-editor-root .slash-menu': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '3px 3px 0 color-mix(in srgb, var(--md-border-color) 70%, transparent)',
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

export const documentsOverrides = {
    'button.document': {
        variant: 'solid',
        color: 'info',
        class: 'text-[var(--md-primary-shade)] dark:text-[var(--md-primary-tint)]',
    },
};
const documentReadingFont =
    '"IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const documentCodeFont = '"IBM Plex Mono", ui-monospace, monospace';

export const documentsStyles = {
    '.document-editor-root': {
        style: {
            fontFamily: 'var(--font-sans)',
        },
    },
    // Keep chrome/UI on the retro face; use the same readable stack as chat for the writing surface.
    '.document-editor-root .document-canvas': {
        style: {
            fontFamily: `${documentReadingFont} !important`,
        },
    },
    '.document-editor-root .document-title-field textarea': {
        style: {
            fontFamily: `${documentReadingFont} !important`,
            letterSpacing: '-0.02em',
        },
    },
    '.document-editor-root .document-content': {
        style: {
            fontFamily: `${documentReadingFont} !important`,
        },
    },
    '.document-editor-root .document-content h1, .document-editor-root .document-content h2, .document-editor-root .document-content h3':
        {
            style: {
                fontFamily: `${documentReadingFont} !important`,
                letterSpacing: '-0.015em',
            },
        },
    '.document-editor-root .document-content pre, .document-editor-root .document-content code': {
        style: {
            fontFamily: `${documentCodeFont} !important`,
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
    '.document-editor-root .setting-card': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 45%, transparent)',
        },
    },
    '.document-editor-root .quick-action-row': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 35%, transparent)',
        },
    },
    '.document-editor-root .quick-action-fields': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .quick-action-empty': {
        style: {
            border: 'var(--md-border-width) dashed var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .attachment-chip': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .selection-context': {
        style: {
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .scope-control [role="tablist"]': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .revision-item': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 35%, transparent)',
        },
    },
    '.document-editor-root .outline-item': {
        style: {
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .preview-body': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .info-grid > div': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .outline-empty': {
        style: {
            border: 'var(--md-border-width) dashed var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .send-button': {
        style: {
            borderRadius: 'var(--md-border-radius)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 55%, transparent)',
        },
    },
    '.document-editor-root .attachment-button': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
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

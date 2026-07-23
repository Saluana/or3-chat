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
    '.document-editor-root .document-ai-change-marker': {
        style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.5rem',
            height: '1.5rem',
            margin: '0.15rem 0.35rem 0.15rem 0',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            background: 'var(--md-surface)',
            color: 'var(--md-on-surface)',
            boxShadow: '2px 2px 0 color-mix(in srgb, var(--md-border-color) 55%, transparent)',
            fontFamily: 'var(--font-display)',
            fontSize: '0.8rem',
            fontWeight: '700',
            cursor: 'pointer',
        },
    },
    '.document-editor-root .document-ai-change-marker.is-active': {
        style: {
            borderColor: 'var(--md-primary)',
            background: 'var(--md-primary)',
            color: 'var(--md-on-primary)',
        },
    },
    '.document-editor-root .document-ai-hunk': {
        style: {
            display: 'grid',
            gap: '0.5rem',
            margin: '0.5rem 0',
            padding: '0.65rem 0.7rem',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            background: 'var(--md-surface)',
            boxShadow: '3px 3px 0 color-mix(in srgb, var(--md-border-color) 55%, transparent)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            maxWidth: '100%',
        },
    },
    '.document-editor-root .document-ai-hunk-header': {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            minWidth: '0',
        },
    },
    '.document-editor-root .document-ai-hunk-badge': {
        style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.5rem',
            height: '1.5rem',
            flex: '0 0 auto',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            background: 'var(--md-primary)',
            color: 'var(--md-on-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: '0.8rem',
            fontWeight: '700',
        },
    },
    '.document-editor-root .document-ai-hunk-title': {
        style: {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-display)',
            fontSize: '0.9rem',
        },
    },
    '.document-editor-root .document-ai-hunk-body': {
        style: {
            display: 'grid',
            gap: '0.35rem',
        },
    },
    '.document-editor-root .document-ai-hunk-body.is-expanded': {
        style: {
            maxHeight: 'min(42vh, 18rem)',
            overflow: 'auto',
            overscrollBehavior: 'contain',
        },
    },
    '.document-editor-root .document-ai-hunk-pane': {
        style: {
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gap: '0.4rem',
            alignItems: 'start',
            padding: '0.45rem 0.55rem',
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before': {
        style: {
            background: 'color-mix(in srgb, var(--md-error) 14%, var(--md-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after': {
        style: {
            background: 'color-mix(in srgb, #2f9d6a 14%, var(--md-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-mark': {
        style: {
            marginTop: '0.05rem',
            fontFamily: 'var(--font-display)',
            fontSize: '0.95rem',
            fontWeight: '700',
            lineHeight: '1',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-stack': {
        style: {
            display: 'grid',
            gap: '0.1rem',
            minWidth: '0',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-label': {
        style: {
            fontFamily: 'var(--font-display)',
            fontSize: '0.75rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-mark': {
        style: {
            color: 'var(--md-error)',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-mark': {
        style: {
            color: '#1f7a4d',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-text': {
        style: {
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: '1.45',
        },
    },
    '.document-editor-root .document-ai-hunk-actions': {
        style: {
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: '0.35rem',
        },
    },
    '.document-editor-root .document-ai-hunk-toggle, .document-editor-root .document-ai-hunk-discard': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius)',
            padding: '0.2rem 0.55rem',
            background: 'var(--md-surface)',
            fontFamily: 'var(--font-display)',
            fontSize: '0.8rem',
            cursor: 'pointer',
        },
    },
    '.document-editor-root .document-ai-hunk-accept': {
        style: {
            border: 'var(--md-border-width) solid #1f7a4d',
            borderRadius: 'var(--md-border-radius)',
            padding: '0.2rem 0.65rem',
            background: '#2f9d6a',
            color: '#ffffff',
            fontFamily: 'var(--font-display)',
            fontSize: '0.8rem',
            cursor: 'pointer',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-replace': {
        style: {
            background: 'color-mix(in srgb, var(--md-primary) 12%, transparent)',
            outline: 'var(--md-border-width) solid var(--md-primary)',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-replace.is-active': {
        style: {
            background: 'color-mix(in srgb, var(--md-primary) 18%, transparent)',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-delete': {
        style: {
            background: 'color-mix(in srgb, var(--md-error) 14%, transparent)',
            outline: 'var(--md-border-width) solid var(--md-error)',
        },
    },
};

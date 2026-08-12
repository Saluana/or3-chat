export const documentsOverrides = {
    'button.document': {
        class: 'bg-[var(--md-surface-hover)] hover:bg-[var(--md-surface-active)] border-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
    },
};
export const documentsStyles = {
    '.document-editor-root': {
        style: {
            fontFamily: 'var(--font-sans)',
        },
    },
    '.document-editor-root .document-content .ProseMirror:focus-visible': {
        style: {
            outline: 'none',
        },
    },
    '.document-editor-root .editor-topbar': {
        style: {
            borderBottom: 'var(--md-border-width-subtle, var(--md-border-width)) solid var(--md-border-color)',
        },
    },
    '.document-editor-root .document-editor-toolbar': {
        style: {
            borderBottom:
                'var(--md-border-width-subtle, var(--md-border-width)) solid var(--md-border-color)',
            boxShadow: '0 1px 2px color-mix(in srgb, var(--md-on-surface) 4%, transparent)',
        },
    },
    '.document-editor-root .document-inspector': {
        style: {
            borderLeft:
                'var(--md-border-width) solid color-mix(in srgb, var(--md-border-color) 70%, transparent)',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .document-ai-composer': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--chat-composer-border-radius, 28px)',
            boxShadow: '0 12px 36px color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
        },
    },
    '.document-editor-root .toolbar-overflow': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius-large, var(--md-border-radius))',
            boxShadow: '0 12px 36px color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
        },
    },
    '.document-editor-root .selection-menu': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius-large, var(--md-border-radius))',
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
    '.document-editor-root .setting-card': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '14px',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .quick-action-row': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '14px',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .quick-action-fields': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 8%, transparent)',
            borderRadius: '12px',
        },
    },
    '.document-editor-root .quick-action-empty': {
        style: {
            border: '1px dashed color-mix(in srgb, var(--md-on-surface) 14%, transparent)',
            borderRadius: '14px',
        },
    },
    '.document-editor-root .attachment-chip': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '12px',
        },
    },
    '.document-editor-root .selection-context': {
        style: {
            borderRadius: '12px',
        },
    },
    '.document-editor-root .scope-control [role="tablist"]': {
        style: {
            border: '0',
            borderRadius: '999px',
        },
    },
    '.document-editor-root .revision-item': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '14px',
            boxShadow: '0 1px 1px color-mix(in srgb, var(--md-on-surface) 4%, transparent)',
        },
    },
    '.document-editor-root .outline-item': {
        style: {
            borderRadius: '14px',
        },
    },
    '.document-editor-root .preview-body': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '12px',
        },
    },
    '.document-editor-root .info-grid > div': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 10%, transparent)',
            borderRadius: '14px',
        },
    },
    '.document-editor-root .outline-empty': {
        style: {
            border: '1px dashed color-mix(in srgb, var(--md-on-surface) 14%, transparent)',
            borderRadius: '14px',
        },
    },
    '.document-editor-root .send-button': {
        style: {
            borderRadius: '999px',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .attachment-button': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 12%, transparent)',
            borderRadius: '999px',
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
    '.document-editor-root .document-ai-change-marker': {
        style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.45rem',
            height: '1.45rem',
            margin: '0.15rem 0.35rem 0.15rem 0',
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 14%, transparent)',
            borderRadius: '999px',
            background: 'var(--md-surface)',
            color: 'var(--md-on-surface-variant)',
            boxShadow: '0 1px 2px color-mix(in srgb, var(--md-on-surface) 8%, transparent)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.7rem',
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
            boxSizing: 'border-box',
            display: 'block',
            width: '100%',
            maxWidth: '100%',
            margin: '0.75rem 0',
            padding: '0',
            border: '0',
            borderRadius: '0',
            background: 'transparent',
            boxShadow: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.875rem',
        },
    },
    '.document-editor-root .document-ai-hunk-header': {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            minWidth: '0',
            marginBottom: '0.45rem',
        },
    },
    '.document-editor-root .document-ai-hunk-badge': {
        style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.45rem',
            height: '1.45rem',
            flex: '0 0 auto',
            borderRadius: '999px',
            background: 'var(--md-primary)',
            color: 'var(--md-on-primary)',
            fontSize: '0.7rem',
            fontWeight: '700',
        },
    },
    '.document-editor-root .document-ai-hunk-title': {
        style: {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '0.84rem',
            fontWeight: '650',
        },
    },
    '.document-editor-root .document-ai-hunk-body': {
        style: {
            position: 'relative',
            display: 'grid',
            gap: '0.35rem',
        },
    },
    '.document-editor-root .document-ai-hunk-body.is-collapsed::after': {
        style: {
            content: '""',
            position: 'absolute',
            left: '0',
            right: '0',
            bottom: '0',
            height: '1.75rem',
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom, transparent, var(--md-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-body.is-expanded': {
        style: {
            maxHeight: 'none',
            overflow: 'visible',
        },
    },
    '.document-editor-root .document-ai-hunk-pane': {
        style: {
            boxSizing: 'border-box',
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gap: '0.45rem',
            alignItems: 'start',
            width: '100%',
            maxWidth: '100%',
            padding: '0.5rem 0.65rem',
            borderRadius: '0',
            border: '0',
            borderLeft: '3px solid transparent',
            background: 'transparent',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before': {
        style: {
            color: 'var(--md-on-surface)',
            background: 'color-mix(in srgb, #f8e8e8 70%, var(--md-surface))',
            borderLeftColor: '#c45c5c',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after': {
        style: {
            color: 'var(--md-on-surface)',
            background: 'color-mix(in srgb, #e4f3e8 70%, var(--md-surface))',
            borderLeftColor: '#2f9d6a',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-mark': {
        style: {
            marginTop: '0.05rem',
            fontSize: '0.9rem',
            fontWeight: '700',
            lineHeight: '1',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-stack': {
        style: {
            display: 'grid',
            gap: '0.15rem',
            minWidth: '0',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-label': {
        style: {
            fontSize: '0.62rem',
            fontWeight: '700',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-mark': {
        style: {
            color: '#a54848',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-mark': {
        style: {
            color: '#1f7a4d',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-text': {
        style: {
            color: 'var(--md-on-surface)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: '1.55',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-text': {
        style: {
            textDecoration: 'line-through',
            textDecorationColor: 'color-mix(in srgb, #a54848 40%, transparent)',
            opacity: '0.9',
        },
    },
    '.document-editor-root .document-ai-hunk-actions': {
        style: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.45rem',
            marginTop: '0.45rem',
        },
    },
    '.document-editor-root .document-ai-hunk-decisions': {
        style: {
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: '0.35rem',
            marginLeft: 'auto',
        },
    },
    '.document-editor-root .document-ai-hunk-toggle': {
        style: {
            border: '0',
            borderRadius: '0',
            padding: '0.2rem 0',
            background: 'transparent',
            color: 'var(--md-primary)',
            fontSize: '0.75rem',
            fontWeight: '600',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '0.15em',
        },
    },
    '.document-editor-root .document-ai-hunk-discard': {
        style: {
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 14%, transparent)',
            borderRadius: '999px',
            padding: '0.28rem 0.7rem',
            background: 'var(--md-surface)',
            color: 'var(--md-on-surface)',
            fontSize: '0.72rem',
            cursor: 'pointer',
        },
    },
    '.document-editor-root .document-ai-hunk-accept': {
        style: {
            border: '0',
            borderRadius: '999px',
            padding: '0.28rem 0.8rem',
            background: '#2f9d6a',
            color: '#ffffff',
            fontSize: '0.72rem',
            fontWeight: '650',
            cursor: 'pointer',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-replace': {
        style: {
            background: 'transparent',
            borderRadius: '0',
            boxShadow: 'none',
            borderLeft: '2px solid color-mix(in srgb, var(--md-primary) 55%, transparent)',
            paddingLeft: '0.55rem',
            marginLeft: '0',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-replace.is-active': {
        style: {
            background: 'color-mix(in srgb, var(--md-primary) 5%, transparent)',
            borderLeftColor: 'var(--md-primary)',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-delete': {
        style: {
            background: 'color-mix(in srgb, #e85d5d 6%, transparent)',
            borderRadius: '0',
            boxShadow: 'none',
            borderLeft: '2px solid color-mix(in srgb, #e85d5d 70%, transparent)',
            paddingLeft: '0.55rem',
            marginLeft: '0',
        },
    },
    '.document-editor-root .document-ai-scope-target.is-block': {
        style: {
            background: 'transparent',
            borderRadius: '0',
            boxShadow: 'none',
        },
    },
    '.document-editor-root .document-ai-scope-target.is-selection': {
        style: {
            background: 'color-mix(in srgb, var(--md-tertiary, var(--md-primary)) 12%, transparent)',
            borderRadius: '2px',
        },
    },
};

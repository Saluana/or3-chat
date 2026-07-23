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
            display: 'grid',
            gap: '0.55rem',
            margin: '0.55rem 0',
            padding: '0.75rem 0.8rem',
            border: '1px solid color-mix(in srgb, var(--md-on-surface) 12%, transparent)',
            borderRadius: '14px',
            background: 'var(--md-surface)',
            boxShadow: '0 10px 28px color-mix(in srgb, var(--md-on-surface) 8%, transparent)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.8rem',
            maxWidth: '100%',
        },
    },
    '.document-editor-root .document-ai-hunk-header': {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            minWidth: '0',
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
            display: 'grid',
            gap: '0.4rem',
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
            gap: '0.45rem',
            alignItems: 'start',
            padding: '0.55rem 0.65rem',
            borderRadius: '10px',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before': {
        style: {
            color: 'color-mix(in srgb, #9b3b3b 55%, var(--md-on-surface))',
            background: 'color-mix(in srgb, #e85d5d 12%, var(--md-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after': {
        style: {
            color: 'color-mix(in srgb, #1f7a4d 40%, var(--md-on-surface))',
            background: 'color-mix(in srgb, #2f9d6a 12%, var(--md-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-pane-mark': {
        style: {
            marginTop: '0.05rem',
            fontSize: '0.9rem',
            fontWeight: '700',
            lineHeight: '1',
            opacity: '0.85',
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
            opacity: '0.78',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-before .document-ai-hunk-pane-mark': {
        style: {
            color: 'color-mix(in srgb, #9b3b3b 70%, var(--md-on-surface))',
        },
    },
    '.document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-label, .document-editor-root .document-ai-hunk-pane.is-after .document-ai-hunk-pane-mark': {
        style: {
            color: 'color-mix(in srgb, #1f7a4d 55%, var(--md-on-surface))',
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
            background: 'color-mix(in srgb, var(--md-primary) 8%, transparent)',
            borderRadius: '8px',
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--md-primary) 22%, transparent)',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-replace.is-active': {
        style: {
            background: 'color-mix(in srgb, var(--md-primary) 12%, transparent)',
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--md-primary) 35%, transparent)',
        },
    },
    '.document-editor-root .document-ai-hunk-target.is-delete': {
        style: {
            background: 'color-mix(in srgb, #e85d5d 10%, transparent)',
            borderRadius: '8px',
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, #e85d5d 28%, transparent)',
        },
    },
};

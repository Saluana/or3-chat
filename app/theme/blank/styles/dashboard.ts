export const dashboardOverrides = {
    'button#dashboard.back': {
        variant: 'basic' as const,
        ui: {
            base: 'ml-0! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]!',
        },
    },
};
export const dashboardStyles = {
    '.dashboard-plugin-icon-label': {
        style: {
            fontFamily:
                '"IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important',
            fontSize: '12px',
        },
    },
    '.dashboard-plugin-icon-button': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius) !important',
            backgroundColor: 'var(--md-surface)',
            color: 'var(--md-on-surface)',
        },
    },
    '.dashboard-plugin-icon-button:hover': {
        style: {
            backgroundColor: 'var(--md-surface-hover)',
        },
    },
    '.dashboard-plugin-icon-button:active': {
        style: {
            backgroundColor: 'var(--md-surface-active)',
        },
    },
    '.dashboard-landing-item': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius) !important',
            backgroundColor: 'var(--md-surface)',
            color: 'var(--md-on-surface)',
            cursor: 'pointer',
        },
    },
    '.dashboard-landing-item:hover': {
        style: {
            backgroundColor: 'var(--md-surface-hover)',
        },
    },
    '.section-card': {
        style: {
            backgroundColor: 'var(--md-surface)',
            border: 'var(--md-border-width) solid var(--md-border-color) !important',
            borderRadius: 'var(--md-border-radius) !important',
            padding: '20px 16px',
        },
    },
};

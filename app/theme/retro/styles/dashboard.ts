const galleryButtons =
    'bg-white/10! backdrop-blur-md! hover:bg-white/20! active:bg-white/30! flex items-center justify-center retro-shadow';
const destructiveOutlineButton = {
    color: 'neutral' as const,
    ui: {
        base: 'text-[var(--md-error)] border-[color:var(--md-error)]/40 hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15',
    },
};

export const dashboardOverrides = {
    'button.image-viewer': {
        color: 'on-surface' as const,
        variant: 'solid',
        class: 'retro-press',
    },
    'selectmenu#dashboard.workspace.logout-policy': {
        class: 'w-full',
        ui: {
            content:
                'z-[30] ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius)] bg-[var(--md-surface)] text-[14px]!',
        },
    },
    'button#dashboard.back': {
        variant: 'basic' as const,
        ui: {
            base: 'ml-0! border-[length:var(--md-border-width)] border-[color:var(--md-border-color)] rounded-[var(--md-border-radius)] text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]!',
        },
    },
    'button#dashboard.theme.copy-color': {
        class: 'flex items-center justify-center',
    },
    'button#dashboard.workspace.import-mode': {
        variant: 'solid',
        color: 'on-surface',
    },
    'button#images.gallery.download': {
        class: galleryButtons,
    },
    'button#images.gallery.copy': {
        class: galleryButtons,
    },
    'button#images.delete': destructiveOutlineButton,
    'button#images.delete-selection': destructiveOutlineButton,
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

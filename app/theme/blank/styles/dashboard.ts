const galleryButtons =
    'bg-black/10! backdrop-blur-md! hover:bg-black/20! active:bg-black/30! flex items-center justify-center border-0 rounded-full';
const destructiveOutlineButton = {
    color: 'neutral' as const,
    ui: {
        base: 'text-[var(--md-error)] hover:bg-[var(--md-error)]/10 active:bg-[var(--md-error)]/15 border-0',
    },
};

export const dashboardOverrides = {
    'button.image-viewer': {
        color: 'on-surface' as const,
        variant: 'solid',
        class: 'border-0',
    },
    'selectmenu#dashboard.workspace.logout-policy': {
        class: 'w-full',
        ui: {
            content:
                'z-[30] ring-0! border-0! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] shadow-lg text-[14px]!',
        },
    },
    'button#dashboard.back': {
        variant: 'ghost' as const,
        ui: {
            base: 'ml-0! border-0 rounded-[var(--md-border-radius-small,var(--md-border-radius))] text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]!',
        },
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
    '#dashboard-page-header': {
        style: {
            // Blank zeroes the subtle divider width, which erased this seam. Match the modal title bar above it.
            borderBottom: 'var(--md-border-width) solid var(--md-border-color) !important',
        },
    },
    '.dashboard-page-scroll': {
        style: {
            backgroundColor: 'var(--md-surface) !important',
        },
    },
    '.dashboard-plugin-icon-label': {
        style: {
            fontSize: '12px',
        },
    },
    '.dashboard-plugin-icon-button': {
        style: {
            border: 'none',
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius)) !important',
            backgroundColor: 'var(--md-surface-hover)',
            color: 'var(--md-on-surface)',
        },
    },
    '.dashboard-plugin-icon-button:hover': {
        style: {
            backgroundColor: 'var(--md-surface-active)',
        },
    },
    '.dashboard-plugin-icon-button:active': {
        style: {
            backgroundColor: 'var(--md-surface-active)',
        },
    },
    '.dashboard-landing-item': {
        style: {
            border: 'none',
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius)) !important',
            backgroundColor: 'var(--md-surface-hover)',
            color: 'var(--md-on-surface)',
            cursor: 'pointer',
        },
    },
    '.dashboard-landing-item:hover': {
        style: {
            backgroundColor: 'var(--md-surface-active)',
        },
    },
    '.section-card': {
        style: {
            backgroundColor: 'var(--md-surface)',
            border: 'var(--md-border-width) solid var(--md-border-color) !important',
            borderRadius: 'var(--md-border-radius-large, var(--md-border-radius)) !important',
            padding: '16px',
            boxShadow: 'var(--app-elevation-low)',
            minWidth: '0',
            maxWidth: '100%',
            boxSizing: 'border-box',
        },
    },
};

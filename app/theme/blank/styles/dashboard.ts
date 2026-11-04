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
        class: 'border-0',
    },
    'selectmenu#dashboard.workspace.logout-policy': {
        class: 'w-full',
        ui: {
            content:
                'z-[30] ring-0! border-0! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] shadow-lg text-[14px]!',
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
    // Same surface as the app's icon rail (see styles/sidebar.ts).
    '#dashboard-sidebar': {
        style: {
            backgroundColor: 'var(--blank-rail-bg)',
            borderRight: '1px solid color-mix(in srgb, var(--md-border-color) 70%, transparent)',
        },
    },
    '.dashboard-page-scroll': {
        style: {
            backgroundColor: 'var(--md-surface) !important',
        },
    },
    '.dashboard-plugin-icon-button': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius-large, var(--md-border-radius)) !important',
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

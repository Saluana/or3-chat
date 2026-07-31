const galleryButtons = 'bg-black/10! backdrop-blur-md! hover:bg-black/20! active:bg-black/30! flex items-center justify-center border-0 rounded-full';
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
                'z-[30] ring-0! border-0! rounded-xl bg-[var(--md-surface)] shadow-lg text-[14px]!',
        },
    },
    'button#dashboard.back': {
        variant: 'ghost' as const,
        ui: {
            base: 'ml-0! border-0 rounded-xl text-[var(--md-on-surface)]! hover:bg-[var(--md-surface-hover)] active:bg-[var(--md-surface-active)]!',
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
    '.dashboard-plugin-icon-label': {
        style: {
            fontSize: '12px',
        },
    },
    '.dashboard-plugin-icon-button': {
        style: {
            border: 'none',
            borderRadius: '12px !important',
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
            borderRadius: '12px !important',
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
            border: 'none !important',
            borderRadius: '12px !important',
            padding: '20px 16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        },
    },
};

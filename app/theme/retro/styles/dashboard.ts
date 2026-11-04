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
        class: 'retro-press',
    },
    'selectmenu#dashboard.workspace.logout-policy': {
        class: 'w-full',
        ui: {
            content:
                'z-[30] ring-0! border-[length:var(--md-border-width)]! border-[color:var(--md-border-color)]! rounded-[var(--md-border-radius-large,var(--md-border-radius))] bg-[var(--md-surface)] text-[14px]!',
        },
    },
    'button#dashboard.theme.copy-color': {
        class: 'flex items-center justify-center theme-btn',
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
            backgroundColor: 'color-mix(in srgb, var(--md-surface) 90%, transparent)',
            borderRight: '1px solid color-mix(in srgb, var(--md-border-color) 18%, transparent)',
        },
    },
    // VT323 reads small, so Retro sizes the dashboard's text up (as its other pages do).
    // Press Start 2P is too wide for titles at modal widths; headings use VT323.
    '.dashboard-shell-title': {
        style: {
            fontFamily: 'var(--font-sans) !important',
            fontSize: '34px',
            fontWeight: '400',
            letterSpacing: 'normal',
            lineHeight: '1.1',
        },
    },
    '.dashboard-back-button': {
        style: { fontSize: '19px !important' },
    },
    '.dashboard-nav-item': {
        style: { fontSize: '19px !important' },
    },
    '.dashboard-plugin-icon-label': {
        style: {
            fontFamily: 'var(--font-sans) !important',
            fontSize: '20px',
            fontWeight: '400',
        },
    },
    '.dashboard-plugin-icon-description': {
        style: { fontSize: '17px', lineHeight: '1.25' },
    },
    '.dashboard-list-heading': {
        style: {
            fontFamily: 'var(--font-sans) !important',
            fontSize: '19px',
            fontWeight: '400',
        },
    },
    '.dashboard-list-label': {
        style: { fontSize: '20px', fontWeight: '400', lineHeight: '1.2' },
    },
    '.dashboard-list-description, .dashboard-list-value, .profile-effect-value': {
        style: { fontSize: '17px !important', lineHeight: '1.25' },
    },
    '.dashboard-list-footnote': {
        style: { fontSize: '16px', lineHeight: '1.3' },
    },
    // Pages written before this shell size small text for proportional faces.
    '.dashboard-page-scroll .text-xs': {
        style: { fontSize: '15px', lineHeight: '1.3' },
    },
    '.dashboard-page-scroll .text-sm': {
        style: { fontSize: '17px', lineHeight: '1.3' },
    },
    '.dashboard-page-description, .dashboard-page-frame .supporting-text': {
        style: { fontSize: '17px', lineHeight: '1.3' },
    },
    '.ai-model-results .text-xs': {
        style: { fontSize: '15px' },
    },
    '.dashboard-plugin-icon-button': {
        style: {
            border: 'var(--md-border-width) solid var(--md-border-color)',
            borderRadius: 'var(--md-border-radius-small, var(--md-border-radius)) !important',
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
            borderRadius: 'var(--md-border-radius) !important',
            padding: '20px 16px',
            minWidth: '0',
            maxWidth: '100%',
            boxSizing: 'border-box',
        },
    },
};

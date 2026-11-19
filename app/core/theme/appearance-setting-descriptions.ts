/** Help shared by the Appearance controls and the model-facing tools. */
export const APPEARANCE_SETTING_DESCRIPTIONS = {
    mode: 'Switches the app between light and dark mode, each with its own customizations.',
    colors: {
        enabled: 'Applies custom colors for this mode and restores the base palette when turned off.',
    },
    backdropOpacity: 'Controls how much the page dims behind a dialog through the dialog backdrop color’s alpha channel.',
    typography: {
        bodyFont: 'Sets the typeface for controls, messages, and supporting text.',
        headingFont: 'Sets the typeface for titles, section labels, and display text.',
        baseFontPx: 'Sets the base size for interface text that follows the shared root size.',
        uiScale: 'Resizes the desktop interface while keeping message and document text at its own size.',
    },
    shape: {
        enabled: 'Applies custom borders and corners for this mode and restores the base theme’s shape when turned off.',
        borderWidthSubtlePx: 'Sets the thickness of dividers between rows and sections.',
        borderWidthPx: 'Sets the standard border thickness around controls and panels.',
        borderWidthStrongPx: 'Sets the thickness of emphasized outlines such as the selected base theme card.',
        borderRadiusSmallPx: 'Rounds the corners of compact controls such as buttons and inputs.',
        borderRadiusPx: 'Sets the standard corner rounding for surfaces such as cards and panels.',
        borderRadiusLargePx: 'Rounds larger surfaces such as dialogs and chat bubbles.',
    },
} as const;

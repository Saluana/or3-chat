/** Canonical color token to CSS custom-property mapping. */
export const COLOR_TOKEN_REGISTRY = {
    primary: '--md-primary',
    onPrimary: '--md-on-primary',
    primaryContainer: '--md-primary-container',
    onPrimaryContainer: '--md-on-primary-container',
    secondary: '--md-secondary',
    onSecondary: '--md-on-secondary',
    secondaryContainer: '--md-secondary-container',
    onSecondaryContainer: '--md-on-secondary-container',
    tertiary: '--md-tertiary',
    onTertiary: '--md-on-tertiary',
    tertiaryContainer: '--md-tertiary-container',
    onTertiaryContainer: '--md-on-tertiary-container',
    error: '--md-error',
    onError: '--md-on-error',
    errorContainer: '--md-error-container',
    onErrorContainer: '--md-on-error-container',
    surface: '--md-surface',
    onSurface: '--md-on-surface',
    surfaceVariant: '--md-surface-variant',
    onSurfaceVariant: '--md-on-surface-variant',
    surfaceContainerLowest: '--md-surface-container-lowest',
    surfaceContainerLow: '--md-surface-container-low',
    surfaceContainer: '--md-surface-container',
    surfaceContainerHigh: '--md-surface-container-high',
    surfaceContainerHighest: '--md-surface-container-highest',
    surfaceHover: '--md-surface-hover',
    surfaceActive: '--md-surface-active',
    inverseSurface: '--md-inverse-surface',
    inverseOnSurface: '--md-inverse-on-surface',
    outline: '--md-outline',
    outlineVariant: '--md-outline-variant',
    borderColor: '--md-border-color',
    primaryHover: '--md-primary-hover',
    primaryActive: '--md-primary-active',
    errorHover: '--md-error-hover',
    errorActive: '--md-error-active',
    success: '--md-success',
    warning: '--md-warning',
    info: '--md-info',
    infoHover: '--md-info-hover',
    infoActive: '--md-info-active',
} as const;

export type RegisteredColorToken = keyof typeof COLOR_TOKEN_REGISTRY;

/** Compatibility variables consumed by Nuxt UI's semantic color bridge. */
export const COLOR_TOKEN_ALIASES: Partial<
    Record<RegisteredColorToken, readonly string[]>
> = {
    success: ['--md-extended-color-success-color'],
    warning: ['--md-extended-color-warning-color'],
};

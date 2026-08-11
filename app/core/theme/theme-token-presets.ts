import type {
    DensityPreset,
    ElevationPreset,
} from './user-overrides-types';

export const DENSITY_TOKEN_VARIABLES = [
    '--app-control-height-small',
    '--app-control-height-medium',
    '--app-control-height-large',
    '--app-space-control',
    '--app-space-section',
] as const;

export const ELEVATION_TOKEN_VARIABLES = [
    '--app-elevation-low',
    '--app-elevation-medium',
    '--app-elevation-high',
] as const;

type TokenMap = Record<string, string>;

const densityPresets: Record<Exclude<DensityPreset, 'theme'>, TokenMap> = {
    compact: {
        '--app-control-height-small': '28px',
        '--app-control-height-medium': '32px',
        '--app-control-height-large': '40px',
        '--app-space-control': '6px',
        '--app-space-section': '12px',
    },
    comfortable: {
        '--app-control-height-small': '32px',
        '--app-control-height-medium': '36px',
        '--app-control-height-large': '44px',
        '--app-space-control': '8px',
        '--app-space-section': '16px',
    },
    spacious: {
        '--app-control-height-small': '36px',
        '--app-control-height-medium': '44px',
        '--app-control-height-large': '52px',
        '--app-space-control': '12px',
        '--app-space-section': '24px',
    },
};

const elevationPresets: Record<Exclude<ElevationPreset, 'theme'>, TokenMap> = {
    flat: {
        '--app-elevation-low': 'none',
        '--app-elevation-medium': 'none',
        '--app-elevation-high': 'none',
    },
    subtle: {
        '--app-elevation-low': '0 1px 2px rgb(0 0 0 / 0.05)',
        '--app-elevation-medium': '0 2px 6px rgb(0 0 0 / 0.08)',
        '--app-elevation-high': '0 8px 20px rgb(0 0 0 / 0.12)',
    },
    expressive: {
        '--app-elevation-low': '0 2px 4px rgb(0 0 0 / 0.1)',
        '--app-elevation-medium': '0 6px 14px rgb(0 0 0 / 0.14)',
        '--app-elevation-high': '0 16px 36px rgb(0 0 0 / 0.2)',
    },
};

export function isDensityPreset(value: unknown): value is DensityPreset {
    return (
        value === 'theme' ||
        value === 'compact' ||
        value === 'comfortable' ||
        value === 'spacious'
    );
}

export function isElevationPreset(value: unknown): value is ElevationPreset {
    return (
        value === 'theme' ||
        value === 'flat' ||
        value === 'subtle' ||
        value === 'expressive'
    );
}

export function getDensityPresetTokens(
    preset: unknown
): Readonly<TokenMap> | null {
    return isDensityPreset(preset) && preset !== 'theme'
        ? densityPresets[preset]
        : null;
}

export function getElevationPresetTokens(
    preset: unknown
): Readonly<TokenMap> | null {
    return isElevationPreset(preset) && preset !== 'theme'
        ? elevationPresets[preset]
        : null;
}

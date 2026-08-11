import { describe, expect, it } from 'vitest';
import {
    DENSITY_TOKEN_VARIABLES,
    ELEVATION_TOKEN_VARIABLES,
    getDensityPresetTokens,
    getElevationPresetTokens,
    isDensityPreset,
    isElevationPreset,
} from '../theme-token-presets';

describe('theme token presets', () => {
    it('maps every density preset to the complete shared token set', () => {
        for (const preset of ['compact', 'comfortable', 'spacious'] as const) {
            expect(Object.keys(getDensityPresetTokens(preset) ?? {}).sort()).toEqual(
                [...DENSITY_TOKEN_VARIABLES].sort()
            );
        }
        expect(getDensityPresetTokens('theme')).toBeNull();
        expect(getDensityPresetTokens('unknown')).toBeNull();
    });

    it('maps every elevation preset to the complete shared token set', () => {
        for (const preset of ['flat', 'subtle', 'expressive'] as const) {
            expect(Object.keys(getElevationPresetTokens(preset) ?? {}).sort()).toEqual(
                [...ELEVATION_TOKEN_VARIABLES].sort()
            );
        }
        expect(getElevationPresetTokens('flat')).toEqual({
            '--app-elevation-low': 'none',
            '--app-elevation-medium': 'none',
            '--app-elevation-high': 'none',
        });
        expect(getElevationPresetTokens('theme')).toBeNull();
        expect(getElevationPresetTokens('unknown')).toBeNull();
    });

    it('accepts only documented preset names', () => {
        expect(isDensityPreset('comfortable')).toBe(true);
        expect(isDensityPreset('dense')).toBe(false);
        expect(isElevationPreset('expressive')).toBe(true);
        expect(isElevationPreset('raised')).toBe(false);
    });
});

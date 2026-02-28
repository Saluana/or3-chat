import { FALLBACK_THEME_NAME } from './constants';
import { sanitizeThemeName } from './theme-core';

export interface DefaultThemeInputs {
    manifestNames: string[];
    manifestDefaultName: string | null;
    configuredDefaultName: string | null;
    fallbackThemeName?: string;
}

export interface DefaultThemeDecision {
    defaultTheme: string;
    reason:
        | 'runtime-config'
        | 'manifest-isDefault'
        | 'first-manifest-entry'
        | 'fallback-constant';
    warnings: string[];
}

export function pickDefaultTheme(
    inputs: DefaultThemeInputs
): DefaultThemeDecision {
    const fallbackThemeName = inputs.fallbackThemeName ?? FALLBACK_THEME_NAME;
    const availableThemes = new Set(inputs.manifestNames);
    const warnings: string[] = [];

    const configured = sanitizeThemeName(
        inputs.configuredDefaultName,
        availableThemes
    );

    if (configured) {
        if (
            inputs.manifestDefaultName &&
            configured !== inputs.manifestDefaultName
        ) {
            warnings.push(
                `[theme] runtimeConfig.public.branding.defaultTheme ("${configured}") overrides manifest default ("${inputs.manifestDefaultName}").`
            );
        }
        return {
            defaultTheme: configured,
            reason: 'runtime-config',
            warnings,
        };
    }

    if (inputs.manifestDefaultName) {
        return {
            defaultTheme: inputs.manifestDefaultName,
            reason: 'manifest-isDefault',
            warnings,
        };
    }

    if (inputs.manifestNames[0]) {
        return {
            defaultTheme: inputs.manifestNames[0],
            reason: 'first-manifest-entry',
            warnings,
        };
    }

    return {
        defaultTheme: fallbackThemeName,
        reason: 'fallback-constant',
        warnings,
    };
}

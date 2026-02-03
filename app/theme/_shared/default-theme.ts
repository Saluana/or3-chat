import { sanitizeThemeName } from './theme-core';

export interface DefaultThemeInputs {
    manifestNames: string[];
    manifestDefaultName: string | null;
    configuredDefaultName: string | null;
    fallbackThemeName: string;
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
    const availableThemes = new Set(inputs.manifestNames);
    const configuredDefault = sanitizeThemeName(
        inputs.configuredDefaultName,
        availableThemes
    );
    const manifestDefault = sanitizeThemeName(
        inputs.manifestDefaultName,
        availableThemes
    );
    const warnings: string[] = [];

    if (configuredDefault) {
        if (manifestDefault && configuredDefault !== manifestDefault) {
            warnings.push(
                `[theme] Runtime config default "${configuredDefault}" overrides manifest default "${manifestDefault}".`
            );
        }
        return {
            defaultTheme: configuredDefault,
            reason: 'runtime-config',
            warnings,
        };
    }

    if (manifestDefault) {
        return {
            defaultTheme: manifestDefault,
            reason: 'manifest-isDefault',
            warnings,
        };
    }

    if (inputs.manifestNames.length > 0) {
        return {
            defaultTheme: inputs.manifestNames[0]!,
            reason: 'first-manifest-entry',
            warnings,
        };
    }

    return {
        defaultTheme: inputs.fallbackThemeName,
        reason: 'fallback-constant',
        warnings,
    };
}

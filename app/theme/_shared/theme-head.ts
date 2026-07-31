import type { CompiledTheme } from './types';

export interface ResolvedThemeStylesheet {
    source: string;
    href: string;
}

export interface ThemeHeadStyle {
    id: string;
    innerHTML: string;
    tagPriority: 'critical';
    'data-theme-style': string;
}

export interface ThemeHeadLink {
    key: string;
    rel: 'stylesheet';
    href: string;
    tagPriority?: 'critical';
    'data-theme-css'?: string;
    'data-theme-stylesheet'?: string;
}

export interface ThemeHeadInput {
    htmlAttrs: {
        'data-theme': string;
    };
    style: ThemeHeadStyle[];
    link: ThemeHeadLink[];
}

/**
 * Build the complete request-scoped head contribution for an SSR theme.
 *
 * This helper deliberately contains no Vue or Nuxt composable calls. Theme
 * loading may cross any number of async boundaries before the returned value is
 * assigned to the reactive head entry registered by the server plugin.
 */
export function buildThemeHead(
    themeName: string,
    theme: CompiledTheme,
    stylesheets: readonly ResolvedThemeStylesheet[] = []
): ThemeHeadInput {
    const style: ThemeHeadStyle[] = [];
    const link: ThemeHeadLink[] = [];

    if (theme.cssVariables) {
        style.push({
            id: `or3-theme-vars-${themeName}`,
            innerHTML: theme.cssVariables,
            tagPriority: 'critical',
            'data-theme-style': themeName,
        });
    }

    if (theme.hasStyleSelectors) {
        link.push({
            key: `or3-theme-css-${themeName}`,
            rel: 'stylesheet',
            href: `/themes/${themeName}.css`,
            tagPriority: 'critical',
            'data-theme-css': themeName,
        });
    }

    for (const stylesheet of stylesheets) {
        link.push({
            key: `or3-theme-extra-${themeName}-${stylesheet.source}`,
            rel: 'stylesheet',
            href: stylesheet.href,
            'data-theme-stylesheet': themeName,
        });
    }

    return {
        htmlAttrs: {
            'data-theme': themeName,
        },
        style,
        link,
    };
}

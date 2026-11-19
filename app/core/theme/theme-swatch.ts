/** Read the surface and accent colors a compiled theme uses in one color mode. */
export function readThemeSwatch(cssVariables: string, mode: 'light' | 'dark') {
    const colors: Record<string, string> = {};
    for (const block of cssVariables.split('}')) {
        const [selector = '', body = ''] = block.split('{');
        if (selector.includes('.dark') && mode !== 'dark') continue;
        for (const [, token = '', value = ''] of body.matchAll(
            /--md-(primary|secondary|tertiary|surface):\s*([^;]+);/g
        )) {
            colors[token] = value.trim();
        }
    }
    return {
        surface: colors.surface,
        accents: ['primary', 'secondary', 'tertiary'].flatMap((token) => colors[token] ?? []),
    };
}

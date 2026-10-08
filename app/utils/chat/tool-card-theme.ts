import type { ToolCardTheme } from '@or3/plugin-sdk/cards';
import { COLOR_TOKEN_REGISTRY } from '~/theme/_shared/design-token-registry';
const names = [
    ...Object.values(COLOR_TOKEN_REGISTRY),
    '--md-border-radius',
    '--md-border-radius-sm',
    '--md-border-radius-lg',
    '--md-border-width',
    '--md-border-width-subtle',
    '--font-sans',
    '--font-heading',
    '--font-mono'
];
export function readToolCardTheme(el: HTMLElement): ToolCardTheme {
    const style = getComputedStyle(el);
    const tokens: Record<`--${string}`, string> = {};
    for (const name of names) {
        const value = style.getPropertyValue(name).trim();
        if (value) tokens[name as `--${string}`] = value;
    }
    return {
        mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        tokens
    };
}

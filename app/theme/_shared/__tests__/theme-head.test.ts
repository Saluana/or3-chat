import { describe, expect, it } from 'vitest';
import type { CompiledTheme } from '../types';
import { buildThemeHead } from '../theme-head';

function compiledTheme(
    overrides: Partial<CompiledTheme> = {}
): CompiledTheme {
    return {
        name: 'retro',
        isDefault: true,
        displayName: 'Retro',
        cssVariables: '',
        overrides: {},
        ...overrides,
    } as CompiledTheme;
}

describe('buildThemeHead', () => {
    it('builds the complete SSR head contribution for a compiled theme', () => {
        const head = buildThemeHead(
            'retro',
            compiledTheme({
                cssVariables: ':root { --md-primary: #123456; }',
                hasStyleSelectors: true,
            }),
            [
                {
                    source: './fonts.css',
                    href: '/themes/retro/fonts.css',
                },
            ]
        );

        expect(head).toEqual({
            htmlAttrs: {
                'data-theme': 'retro',
            },
            style: [
                {
                    id: 'or3-theme-vars-retro',
                    innerHTML: ':root { --md-primary: #123456; }',
                    tagPriority: 'critical',
                    'data-theme-style': 'retro',
                },
            ],
            link: [
                {
                    key: 'or3-theme-css-retro',
                    rel: 'stylesheet',
                    href: '/themes/retro.css',
                    tagPriority: 'critical',
                    'data-theme-css': 'retro',
                },
                {
                    key: 'or3-theme-extra-retro-./fonts.css',
                    rel: 'stylesheet',
                    href: '/themes/retro/fonts.css',
                    'data-theme-stylesheet': 'retro',
                },
            ],
        });
    });

    it('returns an empty style and link set when the theme has no CSS assets', () => {
        expect(buildThemeHead('blank', compiledTheme({ name: 'blank' }))).toEqual(
            {
                htmlAttrs: {
                    'data-theme': 'blank',
                },
                style: [],
                link: [],
            }
        );
    });

    it('creates a fresh replacement config when the active theme changes', () => {
        const first = buildThemeHead(
            'retro',
            compiledTheme({ cssVariables: ':root { --theme: retro; }' })
        );
        const second = buildThemeHead(
            'nature',
            compiledTheme({
                name: 'nature',
                cssVariables: ':root { --theme: nature; }',
            })
        );

        expect(first).not.toBe(second);
        expect(second.htmlAttrs).toEqual({ 'data-theme': 'nature' });
        expect(second.style).toEqual([
            expect.objectContaining({
                id: 'or3-theme-vars-nature',
                'data-theme-style': 'nature',
            }),
        ]);
    });
});

import { describe, expect, it } from 'vitest';
import { compileThemeDefinition } from '../compile-theme';
import type { ThemeDefinition } from '../types';

describe('compileThemeDefinition', () => {
    it('compiles immutable overrides with props, selector identity, and specificity', () => {
        const definition: ThemeDefinition = {
            name: 'parity',
            colors: { primary: '#123456', secondary: '#654321', surface: '#fff' },
            overrides: {
                button: { class: 'base', style: { color: 'red' } },
                'button.chat': { variant: 'ghost' },
                input: { variant: 'outline' },
                'button#chat.send[type="submit"]:hover': {
                    variant: 'solid', size: 'md',
                },
            },
            cssSelectors: { '.portal': { style: { color: 'blue' } } },
        };
        const assets = { stylesheets: ['./styles.css'], icons: { send: 'test:send' } };

        const compiled = compileThemeDefinition(definition, assets);

        expect(compiled.overrides).toMatchObject([
            {
                component: 'button',
                identifier: 'chat.send',
                state: 'hover',
                selector: 'button#chat.send[type="submit"]:hover',
                specificity: 41,
                attributes: [{ attribute: 'type', operator: '=', value: 'submit' }],
                props: { variant: 'solid', size: 'md' },
            },
            {
                component: 'button', context: 'chat', specificity: 11,
                props: { variant: 'ghost' },
            },
            {
                component: 'input', specificity: 1,
                props: { variant: 'outline' },
            },
            {
                component: 'button', specificity: 1,
                props: { class: 'base', style: { color: 'red' } },
            },
        ]);
        expect(Object.isFrozen(compiled)).toBe(true);
        expect(Object.isFrozen(compiled.overrides[0]?.props)).toBe(true);
    });
});


// Public authoring/compiler boundary: these cases guard dropped configuration,
// unsafe persisted input, and merges that accidentally restore disabled art/actions.
describe('empty chat theme contract', () => {
    const base = { name: 'empty-chat', colors: { primary: '#123456', secondary: '#654321', surface: '#fff' } };
    it('retains immutable empty-state configuration through compilation', () => {
        const appearance = { heading: 'Welcome', hero: { src: '/bird.webp', width: 600, height: 400 }, actions: [], dark: false as const };
        const compiled = compileThemeDefinition({ ...base, chatEmptyState: appearance });
        expect(compiled.chatEmptyState).toEqual(appearance);
        expect(Object.isFrozen(compiled.chatEmptyState)).toBe(true);
        expect(compileThemeDefinition(base).chatEmptyState).toBeUndefined();
    });
    it('replaces mode objects and arrays, preserving explicit removals', async () => {
        const { resolveChatEmptyState } = await import('../chat-empty-state');
        const config = { heading: 'Welcome', hero: { src: '/day.webp', width: 600, height: 400 },
            actions: [{ id: 'start-chat' as const }], dark: { heading: false as const, hero: false as const, actions: [] } };
        expect(resolveChatEmptyState(config, 'light')?.actions[0]?.label).toBe('Start a chat');
        expect(resolveChatEmptyState(config, 'dark')).toMatchObject({ heading: false, hero: false, actions: [] });
        expect(resolveChatEmptyState({ ...config, dark: false }, 'dark')).toBeNull();
        expect(resolveChatEmptyState(undefined, 'light')).toBeNull();
        expect(resolveChatEmptyState(false, 'light')).toBeNull();
    });
    it('rejects malformed author configuration and disables malformed persisted input', async () => {
        const { validateThemeDefinition } = await import('../validate-theme');
        const { resolveChatEmptyState } = await import('../chat-empty-state');
        for (const config of [[], { actions: [{ id: 'delete-workspace' }] },
            { actions: [{ id: 'start-chat' }, { id: 'start-chat' }] },
            { hero: { src: 'javascript:alert(1)', width: 100, height: 100 } },
            { hero: { src: '/image.webp', width: 0, height: 100 } }, { dark: { layout: 'unknown' } }]) {
            const result = validateThemeDefinition({ ...base, chatEmptyState: config } as unknown as ThemeDefinition);
            expect(result.errors.some(error => error.message.includes('chatEmptyState'))).toBe(true);
            expect(resolveChatEmptyState(config, 'light')).toBeNull();
        }
    });
});

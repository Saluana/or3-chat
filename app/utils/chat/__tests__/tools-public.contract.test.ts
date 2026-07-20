import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { defineTool, useToolRegistry } from '../tools-public';

const registered: string[] = [];
afterEach(() => {
    const registry = useToolRegistry();
    registered.splice(0).forEach((name) => registry.unregisterTool(name));
});

describe('public tool API contract', () => {
    it('binds defineTool argument types and exposes the reactive runtime shape', () => {
        const definition = defineTool<{ city: string }>({
            type: 'function',
            function: {
                name: 'public_weather',
                description: 'weather',
                parameters: {
                    type: 'object',
                    properties: { city: { type: 'string' } },
                    required: ['city'],
                },
            },
        });
        registered.push(definition.function.name);
        const registry = useToolRegistry();
        const registration = registry.registerTool(definition, (args) => {
            expectTypeOf(args.city).toEqualTypeOf<string>();
            return args.city;
        }, { override: true });

        expect(Array.isArray(registry.listTools.value)).toBe(true);
        registry.hydrate({ public_weather: false });
        expect(registration.enabled.value).toBe(false);
        expect(registration.dispose()).toBe(true);
    });

    it('rejects a malformed definition before it reaches the registry', () => {
        expect(() => defineTool({
            type: 'function',
            function: {
                name: 'broken_public',
                description: 'broken',
                parameters: { type: 'object', properties: {}, required: 'not-an-array' as never },
            },
        })).toThrow('Invalid tool definition');
    });
});

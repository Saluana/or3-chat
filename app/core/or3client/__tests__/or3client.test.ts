/**
 * OR3 Client Unit Tests
 *
 * Tests the define helpers and module structure.
 * Note: Full adapter tests require Nuxt environment and are tested via integration tests.
 */

import { describe, it, expect, vi } from 'vitest';

// Test define helpers - these work without Nuxt since they just return input unchanged
describe('Define Helpers', () => {
    it('defineSidebarPage returns input unchanged', async () => {
        const { defineSidebarPage } = await import('~/core/or3client/define');

        const pageDef = {
            id: 'test-page',
            label: 'Test Page',
            icon: 'carbon:home',
            component: {} as any,
        };

        const result = defineSidebarPage(pageDef);
        expect(result).toBe(pageDef);
    });

    it('definePaneApp returns input unchanged', async () => {
        const { definePaneApp } = await import('~/core/or3client/define');

        const appDef = {
            id: 'test-app',
            label: 'Test App',
            icon: 'carbon:application',
            component: {} as any,
        };

        const result = definePaneApp(appDef);
        expect(result).toBe(appDef);
    });

    it('defineDashboardPlugin returns input unchanged', async () => {
        const { defineDashboardPlugin } = await import('~/core/or3client/define');

        const pluginDef = {
            id: 'test-plugin',
            label: 'Test Plugin',
            icon: 'carbon:apps',
        };

        const result = defineDashboardPlugin(pluginDef);
        expect(result).toBe(pluginDef);
    });

    it('defineTool returns input unchanged', async () => {
        const { defineTool } = await import('~/core/or3client/define');

        const toolDef = {
            type: 'function' as const,
            function: {
                name: 'test-tool',
                description: 'A test tool',
                parameters: {
                    type: 'object' as const,
                    properties: {},
                },
            },
        };

        const result = defineTool(toolDef);
        expect(result).toBe(toolDef);
    });

    it('defineMessageAction returns input unchanged', async () => {
        const { defineMessageAction } = await import('~/core/or3client/define');

        const actionDef = {
            id: 'test-action',
            icon: 'carbon:copy',
            tooltip: 'Copy',
            showOn: 'both' as const,
            handler: vi.fn(),
        };

        const result = defineMessageAction(actionDef);
        expect(result).toBe(actionDef);
    });
});

// Test type re-exports don't throw
describe('Type Re-exports', () => {
    it('exports sidebar types', async () => {
        const types = await import('~/core/or3client/types');
        expect(types).toBeDefined();
    });
});

// Test utils can be imported
describe('Utility Functions', () => {
    it('exports clientOnlyAdapter', async () => {
        const { clientOnlyAdapter } = await import('~/core/or3client/utils');
        expect(typeof clientOnlyAdapter).toBe('function');
    });

    it('exports clientOnlyServiceAdapter', async () => {
        const { clientOnlyServiceAdapter } = await import('~/core/or3client/utils');
        expect(typeof clientOnlyServiceAdapter).toBe('function');
    });
});

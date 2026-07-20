import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReactive } from 'vue';
import { usePaneApps } from '../core/usePaneApps';
import { useSidebarPages } from '../sidebar/useSidebarPages';

const originalClient = process.client;

function setClient(value: boolean) {
    Object.defineProperty(process, 'client', { value, configurable: true });
}

describe('V1 sidebar page profile', () => {
    beforeEach(() => {
        const registry = (globalThis as { __or3SidebarPagesRegistry?: Map<string, unknown> }).__or3SidebarPagesRegistry;
        registry?.clear();
        setClient(true);
    });

    it('freezes exact validation messages and server no-op behavior', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();
        expect(() => registerSidebarPage({ id: 'Bad ID', label: 'Page', icon: 'i', component: {} }))
            .toThrow('Page id must be lowercase alphanumeric with hyphens');
        expect(() => registerSidebarPage({ id: 'valid', label: '', icon: 'i', component: {} }))
            .toThrow('Label is required');
        expect(() => registerSidebarPage({ id: 'valid', label: 'Page', icon: '', component: {} }))
            .toThrow('Icon is required');

        setClient(false);
        const dispose = registerSidebarPage({ id: 'server-page', label: 'Server', icon: 'i', component: {} });
        expect(getSidebarPage('server-page')).toBeUndefined();
        expect(dispose()).toBeUndefined();
        consoleError.mockRestore();
    });

    it('normalizes defaults, marks static components raw, and preserves order-only ties', () => {
        const { registerSidebarPage, getSidebarPage, listSidebarPages } = useSidebarPages();
        const firstComponent = { name: 'First' };
        registerSidebarPage({ id: 'z-page', label: 'Z', icon: 'i', component: firstComponent });
        registerSidebarPage({ id: 'a-page', label: 'A', icon: 'i', component: { name: 'Second' } });
        registerSidebarPage({ id: 'sidebar-home', label: 'Home', icon: 'i', component: {} });

        expect(listSidebarPages.value.map((page) => page.id)).toEqual(['z-page', 'a-page', 'sidebar-home']);
        expect(getSidebarPage('z-page')).toMatchObject({ order: 200, usesDefaultHeader: false });
        expect(getSidebarPage('sidebar-home')?.usesDefaultHeader).toBe(true);
        expect(getSidebarPage('z-page')?.component).toBe(firstComponent);
        expect(isReactive(getSidebarPage('z-page')?.component)).toBe(false);
    });

    it('wraps async components, retries twice, uses the frozen timeout, and then fails', async () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();
        const eventual = { name: 'Eventual' };
        const succeedsOnThird = vi.fn()
            .mockRejectedValueOnce(new Error('first'))
            .mockRejectedValueOnce(new Error('second'))
            .mockResolvedValue(eventual);
        registerSidebarPage({ id: 'retry-page', label: 'Retry', icon: 'i', component: succeedsOnThird });
        const wrapped = getSidebarPage('retry-page')?.component as { __asyncLoader?: () => Promise<unknown> };
        expect(wrapped).not.toBe(succeedsOnThird);
        expect(await wrapped.__asyncLoader?.()).toBe(eventual);
        expect(succeedsOnThird).toHaveBeenCalledTimes(3);

        const alwaysFails = vi.fn().mockRejectedValue(new Error('still broken'));
        registerSidebarPage({ id: 'failed-page', label: 'Failed', icon: 'i', component: alwaysFails });
        const failed = getSidebarPage('failed-page')?.component as { __asyncLoader?: () => Promise<unknown> };
        await expect(failed.__asyncLoader?.()).rejects.toThrow('still broken');
        expect(alwaysFails).toHaveBeenCalledTimes(3);

        const source = readFileSync(resolve(process.cwd(), 'app/composables/sidebar/useSidebarPages.ts'), 'utf8');
        expect(source).toContain('timeout: 15000');
        expect(source).toContain('suspensible: false');
        expect(source).toContain('if (attempts <= 2) retry()');
    });

    it('filters denied pages and stale disposers cannot remove replacements', () => {
        const { registerSidebarPage, getSidebarPage, listSidebarPages } = useSidebarPages();
        registerSidebarPage({ id: 'denied-page', label: 'Denied', icon: 'i', component: {}, access: { authRequired: true } });
        expect(listSidebarPages.value.map((page) => page.id)).not.toContain('denied-page');
        expect(getSidebarPage('denied-page')).toBeDefined();

        const stale = registerSidebarPage({ id: 'owned-page', label: 'Old', icon: 'i', component: {} });
        const current = registerSidebarPage({ id: 'owned-page', label: 'Current', icon: 'i', component: {} });
        stale();
        expect(getSidebarPage('owned-page')?.label).toBe('Current');
        current();
        expect(getSidebarPage('owned-page')).toBeUndefined();
    });
});

describe('V1 pane app profile', () => {
    beforeEach(() => {
        setClient(originalClient ?? true);
        const paneApps = usePaneApps();
        for (const app of paneApps.listPaneApps.value) paneApps.unregisterPaneApp(app.id);
    });

    it('freezes exact validation messages', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { registerPaneApp } = usePaneApps();
        expect(() => registerPaneApp({ id: 'Bad ID', label: 'Pane', component: {} }))
            .toThrow('App id must be lowercase alphanumeric with hyphens');
        expect(() => registerPaneApp({ id: 'valid', label: '', component: {} }))
            .toThrow('Label is required');
        consoleError.mockRestore();
    });

    it('defaults order, preserves order-only ties, marks identity raw, and does not wrap async loaders', () => {
        const { registerPaneApp, getPaneApp, listPaneApps } = usePaneApps();
        const firstComponent = { name: 'First' };
        const loader = async () => ({ name: 'Async' });
        registerPaneApp({ id: 'z-pane', label: 'Z', component: firstComponent });
        registerPaneApp({ id: 'a-pane', label: 'A', component: loader });

        expect(listPaneApps.value.map((app) => app.id)).toEqual(['z-pane', 'a-pane']);
        expect(getPaneApp('z-pane')?.order).toBe(200);
        expect(getPaneApp('z-pane')?.component).toBe(firstComponent);
        expect(isReactive(getPaneApp('z-pane')?.component)).toBe(false);
        expect(getPaneApp('a-pane')?.component).toBe(loader);
    });

    it('returns exact-owner handles and has no access-policy filtering surface', () => {
        const { registerPaneApp, getPaneApp, listPaneApps } = usePaneApps();
        const stale = registerPaneApp({ id: 'owned-pane', label: 'Old', component: {} });
        const current = registerPaneApp({ id: 'owned-pane', label: 'Current', component: {} });
        expect(stale.dispose()).toBe(false);
        expect(getPaneApp('owned-pane')?.label).toBe('Current');
        expect(listPaneApps.value.map((app) => app.id)).toEqual(['owned-pane']);
        expect(current.dispose()).toBe(true);
        expect(getPaneApp('owned-pane')).toBeUndefined();
    });
});

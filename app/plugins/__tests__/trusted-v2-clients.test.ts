import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as Vue from 'vue';
import { describe, expect, it } from 'vitest';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { TrustedV2ClientManager } from '~/composables/plugins/trusted-v2-manager';
import { createTrustedHostContext } from '~/composables/plugins/trusted-host-context';
import { applyTrustedEditorExtensions, slashFixtureExtension } from '~/composables/plugins/trusted-editor';

// Execute the actual Nuxt plugin with the HMR metadata supplied by this loader.
// The engine and contribution registry survive module disposal, as in 00-hooks.
function loadHostPlugin(hooks: ReturnType<typeof createTypedHookEngine>, dispose: Array<() => void>) {
    const source = readFileSync(resolve(process.cwd(), 'app/plugins/02-trusted-v2-clients.client.ts'), 'utf8');
    const compiled = ts.transpileModule(source.replaceAll('import.meta.hot', '__hmr'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const modules: Record<string, unknown> = {
        '@or3/plugin-sdk': {},
        '~/composables/plugins/trusted-runtime-services': { createTrustedRuntimeServices: () => ({}) },
        vue: Vue,
        '#imports': { useRuntimeConfig: () => ({ public: { ssrAuthEnabled: true, admin: { pluginRuntimeV2Enabled: true } } }) },
        '~/composables/auth/useSessionContext': { useSessionContext: () => ({ data: Vue.ref(null) }) },
        '~/core/hooks/useHooks': { useHooks: () => hooks },
        '~/composables/plugins/trusted-host-context': { createTrustedHostContext },
        '~/composables/plugins/trusted-editor': { applyTrustedEditorExtensions },
        '~/composables/plugins/trusted-v2-manager': { TrustedV2ClientManager, installTrustedV2ClientManager: () => {} },
        '~/composables/plugins/workspace-plugin-coordinator': { getWorkspacePluginCoordinator: () => ({ register: () => () => {} }) },
        '~~/shared/plugins/host-esm-facade-runtime': { createProductionModuleV2Loader: () => ({}) },
        '~~/shared/plugins/module-v2-loader': { buildPluginPackageAssetUrl: () => '' },
    };
    const exports: { default?: (app: { runWithContext<T>(callback: () => T): T }) => void } = {};
    const require = (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected plugin dependency: ${name}`);
        return modules[name];
    };
    const evaluate = new Function('require', 'exports', 'defineNuxtPlugin', '__hmr', compiled);
    evaluate(require, exports, (plugin: unknown) => plugin, { dispose: (callback: () => void) => dispose.push(callback) });
    exports.default!({ runWithContext: (callback) => callback() });
}

describe('trusted editor host bridge lifecycle', () => {
    it('removes the old host filter on HMR and keeps the bridge after an individual plugin is disabled', async () => {
        const hooks = createTypedHookEngine(createHookEngine());
        const hotDisposers: Array<() => void> = [];
        const trusted = createTrustedHostContext({ pluginId: 'fixture.editor.lifecycle', version: '1.0.0', grants: ['chat.editor.extension'] });
        const extension = slashFixtureExtension('owned-extension');
        trusted.context.contributions.register({ kind: 'editor.extension', id: 'owned-extension', definition: { extension } });
        const base = { name: 'base' };
        try {
            loadHostPlugin(hooks, hotDisposers);
            expect(await hooks.applyFilters('ui.chat.editor:filter:extensions', [base])).toEqual([base, extension]);
            hotDisposers[0]!();
            hotDisposers[0]!();
            expect(await hooks.applyFilters('ui.chat.editor:filter:extensions', [base])).toEqual([base]);
            loadHostPlugin(hooks, hotDisposers);
            expect(await hooks.applyFilters('ui.chat.editor:filter:extensions', [base])).toEqual([base, extension]);
            await trusted.dispose('plugin-disabled');
            expect(await hooks.applyFilters('ui.chat.editor:filter:extensions', [base])).toEqual([base]);
            const other = createTrustedHostContext({ pluginId: 'fixture.editor.other', version: '1.0.0', grants: ['chat.editor.extension'] });
            try {
                other.context.contributions.register({ kind: 'editor.extension', id: 'other-extension', definition: { extension } });
                expect(await hooks.applyFilters('ui.chat.editor:filter:extensions', [base])).toEqual([base, extension]);
            } finally { await other.dispose(); }
        } finally {
            await trusted.dispose();
            for (const dispose of hotDisposers) dispose();
        }
    });
});

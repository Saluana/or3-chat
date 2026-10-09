import * as Sdk from '@or3/plugin-sdk';
import { createApp } from 'vue';
import * as Vue from 'vue';
import {
    HOST_ESM_FACADE_IMPORTS,
    importMapPrecedesModuleScripts,
    type HostEsmFacadeEvidence,
} from '~~/shared/plugins/host-esm-facade';
import {
    publishTrustedHostUiEvidence,
    vueCompilerHelpersMatch,
} from '~~/shared/plugins/host-esm-facade-runtime';

type FacadeModule = Record<string, unknown>;

async function compiledRenderMatchesHost(): Promise<boolean> {
    try {
        // Keep the compiled module external so its Vue import exercises the
        // host import map, using a same-origin asset allowed by production CSP.
        const url = '/_plugins/host-render-proof.mjs';
        const compiled = (await import(/* @vite-ignore */ url)) as {
            render: (ctx: { label: string }) => unknown;
        };
        const host = document.createElement('div');
        const app = createApp({
            render() {
                return compiled.render({ label: 'host-vue-proof' });
            },
        });
        app.mount(host);
        const matched = host.querySelector('#or3-host-abi-proof')?.textContent === 'host-vue-proof';
        app.unmount();
        return matched;
    } catch {
        return false;
    }
}

/** Measure the live import map and publish the kill-gate decision for ModuleV2Loader. */
export default defineNuxtPlugin(async () => {
    const html = document.documentElement.innerHTML;
    const vueFacade = (await import(/* @vite-ignore */ HOST_ESM_FACADE_IMPORTS.vue)) as FacadeModule;
    const sdkFacade = (await import(/* @vite-ignore */ HOST_ESM_FACADE_IMPORTS['@or3/plugin-sdk'])) as FacadeModule;
    const hostVue = Vue as unknown as FacadeModule;
    const evidence: HostEsmFacadeEvidence = {
        generatedFacade: true,
        importMap: importMapPrecedesModuleScripts(html),
        vueSingletonIdentity:
            vueFacade.ref === Vue.ref &&
            vueFacade.h === Vue.h &&
            vueCompilerHelpersMatch(hostVue, vueFacade),
        sdkSingletonIdentity: sdkFacade.defineOr3Plugin === Sdk.defineOr3Plugin,
        vueReactivity: (() => {
            const count = (vueFacade.ref as typeof Vue.ref)(1);
            count.value = 2;
            return Vue.isRef(count) && count.value === 2;
        })(),
        vueComponentRendering: await compiledRenderMatchesHost(),
        cspCompatible: true,
    };
    publishTrustedHostUiEvidence(evidence);
});

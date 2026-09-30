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

const COMPILED_RENDER = `
import { toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue";
const _hoisted_1 = { id: "or3-host-abi-proof" };
export function render(_ctx) {
  return (_openBlock(), _createElementBlock("p", _hoisted_1, _toDisplayString(_ctx.label), 1));
}
`;

async function compiledRenderMatchesHost(): Promise<boolean> {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const blob = new Blob([COMPILED_RENDER], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
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
    } finally {
        URL.revokeObjectURL(url);
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

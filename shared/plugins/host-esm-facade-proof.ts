import { createApp, type App, type VNode } from 'vue';
import { renderToString } from '@vue/server-renderer';
import type { HostEsmFacadeBehaviorProof } from './host-esm-facade';
import { vueCompilerHelpersMatch } from './host-esm-facade-runtime';

interface FacadeBindings {
    readonly ref: typeof import('vue').ref;
    readonly h: typeof import('vue').h;
    readonly isRef: typeof import('vue').isRef;
    readonly defineOr3Plugin?: unknown;
}

function sameBinding(host: unknown, facade: unknown): boolean {
    return typeof host === 'function' && host === facade;
}

/** Measure singleton, reactivity, and render proofs against one host Vue/SDK. */
export async function proveHostEsmFacadeBehavior(input: {
    readonly hostVue: FacadeBindings & { readonly isRef: typeof import('vue').isRef };
    readonly hostSdk: { readonly defineOr3Plugin: unknown };
    readonly vueFacade: FacadeBindings;
    readonly sdkFacade: { readonly defineOr3Plugin: unknown };
}): Promise<HostEsmFacadeBehaviorProof> {
    const vueSingletonIdentity =
        sameBinding(input.hostVue.ref, input.vueFacade.ref) &&
        sameBinding(input.hostVue.h, input.vueFacade.h) &&
        vueCompilerHelpersMatch(
            input.hostVue as unknown as Record<string, unknown>,
            input.vueFacade as unknown as Record<string, unknown>
        );
    const sdkSingletonIdentity =
        input.hostSdk.defineOr3Plugin === input.sdkFacade.defineOr3Plugin &&
        typeof input.hostSdk.defineOr3Plugin === 'function';

    let vueReactivity = false;
    if (vueSingletonIdentity) {
        const count = input.vueFacade.ref(1);
        count.value = 2;
        vueReactivity = input.hostVue.isRef(count) && count.value === 2;
    }

    let vueComponentRendering = false;
    if (vueSingletonIdentity) {
        const app: App = createApp({
            render(): VNode {
                return input.vueFacade.h(
                    'p',
                    { id: 'or3-host-abi-proof' },
                    'host-vue-proof'
                );
            },
        });
        const html = await renderToString(app);
        vueComponentRendering =
            html.includes('id="or3-host-abi-proof"') && html.includes('host-vue-proof');
    }

    return Object.freeze({
        vueSingletonIdentity,
        sdkSingletonIdentity,
        vueReactivity,
        vueComponentRendering,
    });
}

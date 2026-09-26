import {
    decideTrustedHostUi,
    type HostEsmFacadeEvidence,
    type TrustedHostUiDecision,
} from './host-esm-facade';
import { ModuleV2Loader, type ModuleV2LoaderOptions } from './module-v2-loader';

const unproven: HostEsmFacadeEvidence = Object.freeze({
    generatedFacade: false,
    importMap: false,
    vueSingletonIdentity: false,
    sdkSingletonIdentity: false,
    vueReactivity: false,
    vueComponentRendering: false,
    cspCompatible: false,
});

let decision: TrustedHostUiDecision = decideTrustedHostUi(unproven);

export function getTrustedHostUiDecision(): TrustedHostUiDecision {
    return decision;
}

export function publishTrustedHostUiEvidence(
    evidence: HostEsmFacadeEvidence
): TrustedHostUiDecision {
    decision = decideTrustedHostUi(evidence);
    return decision;
}

export const VUE_COMPILER_HELPERS = [
    'openBlock',
    'createElementBlock',
    'createVNode',
    'toDisplayString',
    'Fragment',
    'withCtx',
    'renderList',
    'resolveComponent',
    'withDirectives',
] as const;

export function vueCompilerHelpersMatch(
    hostVue: Record<string, unknown>,
    vueFacade: Record<string, unknown>
): boolean {
    return VUE_COMPILER_HELPERS.every(
        (name) => typeof hostVue[name] === 'function' || typeof hostVue[name] === 'symbol'
            ? hostVue[name] === vueFacade[name]
            : false
    );
}

/** Loader used after the client proof plugin publishes evidence. */
export function createProductionModuleV2Loader(
    options: Omit<ModuleV2LoaderOptions, 'trustedHostUi' | 'trustedHostUiEvidence'>
): ModuleV2Loader {
    return new ModuleV2Loader({
        ...options,
        trustedHostUi: getTrustedHostUiDecision(),
    });
}

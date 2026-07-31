export type HostEsmFacadeBlockCode =
    | 'host-facade-missing'
    | 'import-map-missing'
    | 'vue-singleton-unproven'
    | 'sdk-singleton-unproven'
    | 'vue-reactivity-unproven'
    | 'vue-component-rendering-unproven'
    | 'csp-compatibility-unproven';

export interface HostEsmFacadeEvidence {
    readonly generatedFacade: boolean;
    readonly importMap: boolean;
    readonly vueSingletonIdentity: boolean;
    readonly sdkSingletonIdentity: boolean;
    readonly vueReactivity: boolean;
    readonly vueComponentRendering: boolean;
    readonly cspCompatible: boolean;
}

export type TrustedHostUiDecision =
    | {
          readonly status: 'supported';
          readonly loader: 'module-v2';
          readonly blockCodes: readonly [];
          readonly postBuildAlternative: null;
      }
    | {
          readonly status: 'rebuild-required';
          readonly loader: null;
          readonly blockCodes: readonly HostEsmFacadeBlockCode[];
          readonly postBuildAlternative: 'isolated-client-or-declarative-ui';
      };

const EVIDENCE_CODES: ReadonlyArray<
    readonly [keyof HostEsmFacadeEvidence, HostEsmFacadeBlockCode]
> = [
    ['generatedFacade', 'host-facade-missing'],
    ['importMap', 'import-map-missing'],
    ['vueSingletonIdentity', 'vue-singleton-unproven'],
    ['sdkSingletonIdentity', 'sdk-singleton-unproven'],
    ['vueReactivity', 'vue-reactivity-unproven'],
    ['vueComponentRendering', 'vue-component-rendering-unproven'],
    ['cspCompatible', 'csp-compatibility-unproven'],
];

/**
 * Kill gate for post-build trusted-host UI. Every production ABI proof is
 * required; there is deliberately no fallback that bundles another Vue copy.
 */
export function decideTrustedHostUi(
    evidence: HostEsmFacadeEvidence
): TrustedHostUiDecision {
    const blockCodes = EVIDENCE_CODES.filter(([key]) => !evidence[key]).map(
        ([, code]) => code
    );
    if (blockCodes.length === 0) {
        return Object.freeze({
            status: 'supported',
            loader: 'module-v2',
            blockCodes: Object.freeze([] as const),
            postBuildAlternative: null,
        });
    }
    return Object.freeze({
        status: 'rebuild-required',
        loader: null,
        blockCodes: Object.freeze(blockCodes),
        postBuildAlternative: 'isolated-client-or-declarative-ui',
    });
}

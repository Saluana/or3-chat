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

/** Browser import-map targets. Nuxt copies `public/_plugins` into the production output. */
export const HOST_ESM_FACADE_IMPORTS = Object.freeze({
    vue: '/_plugins/host-vue.mjs',
    '@or3/plugin-sdk': '/_plugins/host-sdk.mjs',
});

export function hostEsmFacadeImportMapScript(): {
    readonly type: 'importmap';
    readonly innerHTML: string;
    readonly tagPriority: 'critical';
    readonly key: 'or3-host-esm-import-map';
} {
    return Object.freeze({
        type: 'importmap',
        innerHTML: JSON.stringify({ imports: HOST_ESM_FACADE_IMPORTS }),
        tagPriority: 'critical',
        key: 'or3-host-esm-import-map',
    });
}

/** True when the document has one import map and it appears before any module script. */
export function importMapPrecedesModuleScripts(html: string): boolean {
    const maps = html.match(/<script\b[^>]*\btype=["']importmap["'][^>]*>/gi) ?? [];
    if (maps.length !== 1) return false;
    const importMapAt = html.search(/<script\b[^>]*\btype=["']importmap["'][^>]*>/i);
    const moduleAt = html.search(/<script\b[^>]*\btype=["']module["'][^>]*>/i);
    if (moduleAt < 0) return importMapAt >= 0;
    return importMapAt >= 0 && importMapAt < moduleAt;
}

/**
 * Behavior proofs are measured by executing the facade. File markers never
 * count. A failed or missing proof leaves the corresponding flag false.
 */
export interface HostEsmFacadeBehaviorProof {
    readonly vueSingletonIdentity: boolean;
    readonly sdkSingletonIdentity: boolean;
    readonly vueReactivity: boolean;
    readonly vueComponentRendering: boolean;
}

export function applyHostEsmFacadeBehaviorProof(
    evidence: HostEsmFacadeEvidence,
    proof: HostEsmFacadeBehaviorProof | null
): HostEsmFacadeEvidence {
    if (
        !proof ||
        !evidence.generatedFacade ||
        !evidence.importMap ||
        !evidence.cspCompatible
    ) {
        return evidence;
    }
    return Object.freeze({
        ...evidence,
        vueSingletonIdentity: proof.vueSingletonIdentity,
        sdkSingletonIdentity: proof.sdkSingletonIdentity,
        vueReactivity: proof.vueReactivity,
        vueComponentRendering: proof.vueComponentRendering,
    });
}

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

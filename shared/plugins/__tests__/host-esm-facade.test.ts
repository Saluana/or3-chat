import { describe, expect, it } from 'vitest';
import {
    decideTrustedHostUi,
    type HostEsmFacadeEvidence,
} from '../host-esm-facade';

const proven: HostEsmFacadeEvidence = {
    generatedFacade: true,
    importMap: true,
    vueSingletonIdentity: true,
    sdkSingletonIdentity: true,
    vueReactivity: true,
    vueComponentRendering: true,
    cspCompatible: true,
};

describe('trusted-host UI production ABI kill gate', () => {
    it('permits ModuleV2Loader UI only after every singleton and CSP proof passes', () => {
        expect(decideTrustedHostUi(proven)).toEqual({
            status: 'supported',
            loader: 'module-v2',
            blockCodes: [],
            postBuildAlternative: null,
        });
    });

    it.each(Object.keys(proven) as Array<keyof HostEsmFacadeEvidence>)(
        'keeps trusted-host UI rebuild-required when %s is unproven',
        (missingProof) => {
            const decision = decideTrustedHostUi({ ...proven, [missingProof]: false });
            expect(decision.status).toBe('rebuild-required');
            expect(decision.loader).toBeNull();
            expect(decision.blockCodes).toHaveLength(1);
            expect(decision.postBuildAlternative).toBe(
                'isolated-client-or-declarative-ui'
            );
        }
    );

    it('formally blocks the current production build without implying isolation exists', () => {
        const decision = decideTrustedHostUi({
            generatedFacade: false,
            importMap: false,
            vueSingletonIdentity: false,
            sdkSingletonIdentity: false,
            vueReactivity: false,
            vueComponentRendering: false,
            cspCompatible: true,
        });
        expect(decision).toMatchObject({
            status: 'rebuild-required',
            loader: null,
            postBuildAlternative: 'isolated-client-or-declarative-ui',
            blockCodes: expect.arrayContaining([
                'host-facade-missing',
                'import-map-missing',
                'vue-singleton-unproven',
                'sdk-singleton-unproven',
            ]),
        });
    });
});

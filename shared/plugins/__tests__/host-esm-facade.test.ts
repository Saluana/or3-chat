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

});

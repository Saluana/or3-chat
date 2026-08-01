import { describe, expect, it } from 'vitest';
import { createModuleV2RuntimePolicy } from '../module-v2-runtime-policy';

describe('ModuleV2 runtime startup policy', () => {
    it('keeps the package canary independent from the bundled V1 manager policy', () => {
        const configured = ['package-workspace'];
        const policy = createModuleV2RuntimePolicy({
            enabled: true,
            ssrHost: true,
            workspaceIds: configured,
        });
        configured[0] = 'mutated-after-startup';

        expect(policy('package-workspace')).toEqual({ allowed: true });
        expect(policy('v1-manager-workspace')).toEqual({
            allowed: false,
            code: 'module-loader-outside-canary',
        });
    });

    it.each([
        [
            { enabled: false, ssrHost: true, workspaceIds: [] },
            'workspace-a',
            'module-loader-disabled',
        ],
        [
            { enabled: true, ssrHost: false, workspaceIds: [] },
            'workspace-a',
            'module-loader-static-host',
        ],
        [
            { enabled: true, ssrHost: true, workspaceIds: ['workspace-a'] },
            'workspace-b',
            'module-loader-outside-canary',
        ],
    ] as const)('blocks %o', (input, workspaceId, code) => {
        expect(createModuleV2RuntimePolicy(input)(workspaceId)).toEqual({
            allowed: false,
            code,
        });
    });
});

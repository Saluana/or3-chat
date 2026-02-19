import { describe, expect, it } from 'vitest';
import {
    createDefaultAccessEditor,
    deserializeAccessEditor,
    withSerializedAccessPolicy,
} from '../plugin-access-policy';

describe('plugin access policy editor helpers', () => {
    it('deserializes effective policy into editor state', () => {
        expect(
            deserializeAccessEditor({
                authRequired: true,
                requiredEntitlements: ['paid'],
                requiredWorkspaceRoles: ['owner'],
            })
        ).toEqual({
            authRequired: true,
            tier: 'paid',
            role: 'owner',
        });
    });

    it('serializes editor state back into plugin settings', () => {
        const settings = withSerializedAccessPolicy(
            { custom: true },
            {
                authRequired: true,
                tier: 'enterprise',
                role: 'editor',
            }
        );

        expect(settings).toEqual({
            custom: true,
            access: {
                authRequired: true,
                requiredEntitlements: ['enterprise'],
                requiredWorkspaceRoles: ['editor'],
                mode: 'all',
            },
        });
    });

    it('creates empty defaults', () => {
        expect(createDefaultAccessEditor()).toEqual({
            authRequired: false,
            tier: '',
            role: '',
        });
    });
});

import { describe, expect, it } from 'vitest';
import { createDefaultAnswers } from '../catalog';
import { deriveEnvFromAnswers, deriveLocalDevConvexEnvLocalUpdates } from '../derive';
import {
    hasSelfHostedConvexInputs,
    normalizeSelfHostedConvexInputs,
} from '../convex-self-hosted';

function answers() {
    return {
        ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
        deploymentTarget: 'local-dev' as const,
        syncEnabled: true,
        syncProvider: 'convex' as const,
        convexUrl: ' https://convex.example ',
        convexSelfHostedAdminKey: ' admin-key ',
        convexSelfHostedSiteUrl: ' https://site.example ',
    };
}

describe('wizard: self-hosted Convex inputs', () => {
    it('normalizes the shared inputs only when URL and admin key are present', () => {
        const normalized = normalizeSelfHostedConvexInputs(answers());

        expect(normalized).toEqual({
            url: 'https://convex.example',
            adminKey: 'admin-key',
            siteUrl: 'https://site.example',
        });
        expect(hasSelfHostedConvexInputs(normalized)).toBe(true);
        expect(
            hasSelfHostedConvexInputs(
                normalizeSelfHostedConvexInputs({
                    ...answers(),
                    convexSelfHostedAdminKey: ' ',
                })
            )
        ).toBe(false);
    });

    it('derives normalized app and local Convex CLI values from the same inputs', () => {
        const configured = answers();
        const { env } = deriveEnvFromAnswers(configured);

        expect(env.CONVEX_SELF_HOSTED_URL).toBe('https://convex.example');
        expect(env.CONVEX_SELF_HOSTED_ADMIN_KEY).toBe('admin-key');
        expect(env.VITE_CONVEX_SITE_URL).toBe('https://site.example');
        expect(deriveLocalDevConvexEnvLocalUpdates(configured)).toMatchObject({
            CONVEX_SELF_HOSTED_URL: 'https://convex.example',
            CONVEX_SELF_HOSTED_ADMIN_KEY: 'admin-key',
            VITE_CONVEX_URL: 'https://convex.example',
            VITE_CONVEX_SITE_URL: 'https://site.example',
            CONVEX_DEPLOYMENT: null,
        });
    });
});

import { describe, expect, it } from 'vitest';
import { defineOr3CloudConfig } from '../utils/or3-cloud-config';
import type { Or3CloudConfig } from '../types/or3-cloud-config';

const baseConfig: Or3CloudConfig = {
    auth: {
        enabled: false,
        provider: 'clerk',
        clerk: {},
    },
    sync: {
        enabled: false,
        provider: 'convex',
        convex: {},
    },
    storage: {
        enabled: false,
        provider: 'convex',
    },
    services: {
        llm: {
            openRouter: {},
        },
    },
    limits: {},
    branding: {},
    legal: {},
    security: {},
    extensions: {},
};

describe('defineOr3CloudConfig', () => {
    it('applies defaults for optional sections', () => {
        const config = defineOr3CloudConfig(baseConfig, { strict: false });
        expect(config.branding?.appName).toBe('OR3');
        expect(config.limits?.requestsPerMinute).toBe(20);
        expect(config.services.llm?.openRouter?.allowUserOverride).toBe(true);
    });

    it('throws in strict mode when instance key is required', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    services: {
                        llm: {
                            openRouter: {
                                allowUserOverride: false,
                            },
                        },
                    },
                },
                { strict: true }
            )
        ).toThrow(/instanceApiKey is required/i);
    });

    it('throws in strict mode when clerk keys are missing', () => {
        expect(() =>
            defineOr3CloudConfig(
                {
                    ...baseConfig,
                    auth: {
                        enabled: true,
                        provider: 'clerk',
                        clerk: {},
                    },
                },
                { strict: true }
            )
        ).toThrow(/clerk\.publishableKey/i);
    });
});

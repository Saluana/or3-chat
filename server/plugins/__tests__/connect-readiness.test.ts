/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import {
    CLOUDFLARE_ATTESTATION_MAX_AGE_MS,
    issueCloudflareValidationAttestation,
} from '../../../shared/cloud/wizard/cloudflare-attestation';

vi.mock('#imports', () => ({
    useRuntimeConfig: vi.fn(),
}));
vi.mock('nitropack/runtime', () => ({
    defineNitroPlugin: (handler: unknown) => handler,
}));

import { applyConnectStartupReadiness } from '../05.connect-readiness';

const now = Date.UTC(2026, 6, 29);
const cloudflare = {
    accountId: 'account-a',
    zoneId: 'zone-a',
    apiToken: 'cloudflare-secret-token',
    hostnameSuffix: 'connect.example.com',
};

function runtime(attestation?: string) {
    const connect = Object.freeze({
        enabled: true,
        requestedEnabled: true,
        relayProvider: 'cloudflare',
        readinessStatus: 'ready' as const,
        readinessMessage: '',
        cloudflareValidationAttestation: attestation,
        cloudflare: Object.freeze({
            ...cloudflare,
        }),
    });
    const publicConnect = Object.freeze({
        enabled: true,
        status: 'ready' as const,
        statusMessage: '',
    });
    return Object.freeze({
        connect,
        public: Object.freeze({ connect: publicConnect }),
    });
}

describe('Connect startup readiness', () => {
    it('keeps Connect enabled with a matching fresh wizard attestation', () => {
        const config = runtime(
            issueCloudflareValidationAttestation(cloudflare, now)
        );

        expect(
            applyConnectStartupReadiness(config, {
                strict: true,
                now,
                env: {},
            })
        ).toMatchObject({ enabled: true, status: 'ready' });
        expect(config.connect.enabled).toBe(true);
        expect(config.public.connect.enabled).toBe(true);
    });

    it('reports degraded readiness without mutating frozen runtime config', () => {
        const config = runtime();

        expect(
            applyConnectStartupReadiness(config, {
                strict: true,
                now,
                env: {},
            })
        ).toMatchObject({ enabled: false, status: 'degraded' });
        expect(config.connect.enabled).toBe(true);
        expect(config.public.connect.enabled).toBe(true);
    });

    it('keeps an authentic stale attestation available with a warning and no network canary', () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const config = runtime(
            issueCloudflareValidationAttestation(
                cloudflare,
                now - CLOUDFLARE_ATTESTATION_MAX_AGE_MS - 1
            )
        );

        expect(
            applyConnectStartupReadiness(config, {
                strict: true,
                now,
                env: {},
            })
        ).toMatchObject({ enabled: true, status: 'unverified' });
        expect(config.connect.enabled).toBe(true);
        expect(config.public.connect.enabled).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});

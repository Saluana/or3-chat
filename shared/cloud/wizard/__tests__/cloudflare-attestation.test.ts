import { describe, expect, it, vi } from 'vitest';
import {
    CLOUDFLARE_ATTESTATION_MAX_AGE_MS,
    issueCloudflareValidationAttestation,
    resolveConnectCloudflareReadiness,
    validateCloudflareValidationAttestation,
} from '../cloudflare-attestation';

const now = Date.UTC(2026, 6, 29);
const config = {
    accountId: 'account-a',
    zoneId: 'zone-a',
    apiToken: 'cloudflare-secret-token',
    hostnameSuffix: 'connect.example.com',
};

describe('Cloudflare Connect validation attestation', () => {
    it('accepts a fresh attestation only for its exact normalized configuration', () => {
        const attestation = issueCloudflareValidationAttestation(config, now);

        expect(
            validateCloudflareValidationAttestation({
                attestation,
                config,
                now,
            })
        ).toMatchObject({ valid: true, validatedAt: now });
        expect(
            validateCloudflareValidationAttestation({
                attestation,
                config: { ...config, zoneId: 'zone-b' },
                now,
            })
        ).toEqual({ valid: false, reason: 'mismatched' });
        expect(
            validateCloudflareValidationAttestation({
                attestation,
                config: { ...config, apiToken: 'rotated-token' },
                now,
            })
        ).toEqual({ valid: false, reason: 'mismatched' });
    });

    it('marks missing and malformed attestations as Connect-only degraded in strict mode', () => {
        const stale = issueCloudflareValidationAttestation(
            config,
            now - CLOUDFLARE_ATTESTATION_MAX_AGE_MS - 1
        );

        for (const attestation of [undefined, 'not-an-attestation']) {
            expect(
                resolveConnectCloudflareReadiness({
                    requestedEnabled: true,
                    strict: true,
                    relayProvider: 'cloudflare',
                    attestation,
                    config,
                    now,
                })
            ).toMatchObject({
                enabled: false,
                status: 'degraded',
            });
        }
        expect(
            resolveConnectCloudflareReadiness({
                requestedEnabled: true,
                strict: true,
                relayProvider: 'cloudflare',
                attestation: stale,
                config,
                now,
            })
        ).toMatchObject({
            enabled: true,
            status: 'unverified',
        });
    });

    it('does not disable chat-era Connect development or call Cloudflare at startup', () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        expect(
            resolveConnectCloudflareReadiness({
                requestedEnabled: true,
                strict: false,
                relayProvider: 'cloudflare',
                config,
                now,
            })
        ).toMatchObject({
            enabled: true,
            status: 'unverified',
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('does not require a Cloudflare attestation for disabled or alternate relays', () => {
        expect(
            resolveConnectCloudflareReadiness({
                requestedEnabled: false,
                strict: true,
                relayProvider: 'cloudflare',
                config,
            })
        ).toEqual({ enabled: false, status: 'disabled' });
        expect(
            resolveConnectCloudflareReadiness({
                requestedEnabled: true,
                strict: true,
                relayProvider: 'other-relay',
                config,
            })
        ).toEqual({ enabled: true, status: 'ready' });
    });
});

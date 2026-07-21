import { describe, expect, it } from 'vitest';
import {
    describeGrantBoundary,
    evaluateTrustImport,
    isIsolatedTrust,
    labelForTrust,
} from '../trust-policy';

describe('trust-policy (8.16)', () => {
    it('allows trusted-host whether isolation is on or off', () => {
        expect(
            evaluateTrustImport({
                pluginIsolationEnabled: false,
                trust: 'trusted-host',
            })
        ).toEqual({
            allowed: true,
            trust: 'trusted-host',
            label: 'trusted-in-process',
        });
        expect(
            evaluateTrustImport({
                pluginIsolationEnabled: true,
                trust: 'trusted-host',
            }).allowed
        ).toBe(true);
    });

    it('blocks isolated descriptors before import when isolation is disabled', () => {
        for (const trust of ['isolated-client', 'isolated-server'] as const) {
            expect(
                evaluateTrustImport({
                    pluginIsolationEnabled: false,
                    trust,
                })
            ).toMatchObject({
                allowed: false,
                code: 'isolation-disabled',
                trust,
            });
        }
    });

    it('prohibits silent fallback from isolated to trusted-host', () => {
        expect(
            evaluateTrustImport({
                pluginIsolationEnabled: true,
                trust: 'isolated-client',
                proposedFallbackTrust: 'trusted-host',
            })
        ).toMatchObject({
            allowed: false,
            code: 'silent-fallback-prohibited',
        });
    });

    it('allows isolated trusts only when isolation is enabled', () => {
        expect(
            evaluateTrustImport({
                pluginIsolationEnabled: true,
                trust: 'isolated-client',
            })
        ).toEqual({
            allowed: true,
            trust: 'isolated-client',
            label: 'isolated-client-sandbox',
        });
        expect(
            evaluateTrustImport({
                pluginIsolationEnabled: true,
                trust: 'isolated-server',
            })
        ).toEqual({
            allowed: true,
            trust: 'isolated-server',
            label: 'isolated-server-boundary',
        });
    });

    it('never labels trusted grants as a sandbox', () => {
        expect(labelForTrust('trusted-host')).toBe('trusted-in-process');
        expect(describeGrantBoundary('trusted-host')).toContain('not a sandbox');
        expect(describeGrantBoundary('trusted-host').toLowerCase()).not.toMatch(
            /^sandbox/
        );
        expect(isIsolatedTrust('trusted-host')).toBe(false);
        expect(isIsolatedTrust('isolated-client')).toBe(true);
    });
});

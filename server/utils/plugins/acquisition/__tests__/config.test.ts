import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MAX_ARTIFACT_BYTES,
    DEFAULT_RESERVE_BYTES,
    parseReleaseKeys,
    resolveAcquisitionConfig,
    resolveInstanceId,
} from '../config';

const VALID_KEY = {
    keyId: 'or3-release',
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) },
};

describe('acquisition configuration', () => {
    it('accepts only an HTTPS origin and refuses to install by default', () => {
        const secure = resolveAcquisitionConfig({
            OR3_MARKETPLACE_REGISTRY_ORIGIN: 'https://market.example/',
            OR3_MARKETPLACE_INSTALL_ENABLED: 'true',
        });
        expect(secure.registryOrigin).toBe('https://market.example');
        expect(secure.installEnabled).toBe(true);

        expect(resolveAcquisitionConfig({}).installEnabled).toBe(false);
        expect(
            resolveAcquisitionConfig({ OR3_MARKETPLACE_INSTALL_ENABLED: '1' }).installEnabled
        ).toBe(false);
        expect(
            resolveAcquisitionConfig({ OR3_MARKETPLACE_REGISTRY_ORIGIN: 'http://market.example' })
                .registryOrigin
        ).toBe('');
        expect(
            resolveAcquisitionConfig({ OR3_MARKETPLACE_REGISTRY_ORIGIN: 'https://market.example/v1' })
                .registryOrigin
        ).toBe('');
    });

    it('keeps only well-formed Ed25519 keys and drops anything else', () => {
        expect(parseReleaseKeys(undefined)).toEqual([]);
        expect(parseReleaseKeys('not json')).toEqual([]);
        expect(parseReleaseKeys(JSON.stringify({ keyId: 'x' }))).toEqual([]);
        expect(parseReleaseKeys(JSON.stringify([{ keyId: 'a' }]))).toEqual([]);
        expect(parseReleaseKeys(JSON.stringify([{ keyId: 'a', x: 'too-short' }]))).toEqual([]);
        expect(parseReleaseKeys(JSON.stringify([{ ...VALID_KEY, keyId: '' }]))).toEqual([]);

        const keys = parseReleaseKeys(
            JSON.stringify([VALID_KEY, VALID_KEY, { keyId: 'rsa', publicJwk: { kty: 'RSA' } }])
        );
        expect(keys).toEqual([
            { keyId: 'or3-release', publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) } },
        ]);
    });

    it('falls back to bounded byte defaults instead of trusting a bad override', () => {
        const defaults = resolveAcquisitionConfig({});
        expect(defaults.maxArtifactBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
        expect(defaults.reserveBytes).toBe(DEFAULT_RESERVE_BYTES);

        const overridden = resolveAcquisitionConfig({
            OR3_MARKETPLACE_MAX_ARTIFACT_BYTES: '1024',
        });
        expect(overridden.maxArtifactBytes).toBe(1024);

        for (const value of ['0', '-1', 'NaN', '1.5', '']) {
            expect(
                resolveAcquisitionConfig({ OR3_MARKETPLACE_MAX_ARTIFACT_BYTES: value })
                    .maxArtifactBytes
            ).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
        }
    });

    it('derives a stable instance identity and honours an explicit one', () => {
        expect(resolveInstanceId({ OR3_INSTANCE_ID: 'host-42' })).toBe('host-42');
        const derived = resolveInstanceId({});
        expect(derived).toMatch(/^ext-[a-f0-9]{24}$/);
        expect(resolveInstanceId({})).toBe(derived);
    });
});

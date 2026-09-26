import { describe, expect, it } from 'vitest';
import { deriveCandidateAuthoritySha256 } from '../authority';

/**
 * Cross-repo authority test vector (findings follow-up).
 *
 * The same descriptor bytes must produce the same authority digest in the
 * SDK, the host (`computeAuthorityHash(toEffectiveAuthority(...))`) and the
 * marketplace (`computeAuthorityHash(deriveEffectiveAuthority(...))`). The
 * expected digest below was generated from the host implementation and is
 * hardcoded in all three repositories: any derivation or serialization drift
 * fails loudly instead of shipping receipts the registry rejects.
 *
 * The vector deliberately exercises normalization: unsorted grants, mixed-case
 * method order, reversed hosts and scopes, a test hook that sorts after the
 * first action, and dependencies in non-sorted manifest order with features.
 */
const MANIFEST = {
    trust: 'isolated-client',
    requestedGrants: ['storage.read', 'network.http'],
    features: { required: ['or3-portable-client-v1'] },
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    dependencies: {
        required: [
            { id: 'b-lib', range: '^1.0.0', features: ['zeta', 'alpha'] },
            { id: 'a-lib', range: '^2.0.0' },
        ],
        optional: [{ id: 'c-lib', range: '^1.2.0' }],
    },
};

const POLICY = {
    policyVersion: 1 as const,
    profile: 'or3-portable-client-v1' as const,
    destinations: [
        {
            id: 'api',
            methods: ['POST', 'GET'] as ('POST' | 'GET')[],
            hosts: ['b.example.com', 'a.example.com'],
            scopes: ['/v2', '/v1'],
        },
    ],
    connections: [
        {
            id: 'repo',
            label: 'Repo',
            provider: 'example',
            required: true,
            mechanism: 'browser' as const,
            scopes: ['write', 'read'],
            operations: ['sync'],
        },
    ],
    dataScopes: ['documents.read'],
    writes: ['tasks.append'],
    requiredFeatures: ['or3-portable-client-v1'],
};

const SETUP = {
    setupVersion: 1 as const,
    settingsSchemaPath: 'settings.schema.json',
    fields: [],
    connections: [],
    testAction: { operationId: 'z-test', deadlineMs: 1000 },
    firstAction: { operationId: 'a-first', label: 'A first action', usesSampleContext: false },
};

export const AUTHORITY_VECTOR_DIGEST =
    'sha256-399295ea37a06a01d4b1a49fbeae04f069fa7b16478d5536da0628408e54302c';

describe('candidate authority vector', () => {
    it('matches the host and marketplace digest for the same descriptors', () => {
        expect(deriveCandidateAuthoritySha256({ manifest: MANIFEST, policy: POLICY, setup: SETUP })).toBe(
            AUTHORITY_VECTOR_DIGEST
        );
    });
});

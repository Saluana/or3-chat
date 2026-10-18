import { describe, expect, it } from 'vitest';
import {
    compareAuthority,
    computeAuthorityHash,
    SelectionHandleAuthority,
    type EffectiveAuthority,
} from '../effective-authority';

function authority(
    overrides: Partial<EffectiveAuthority> = {}
): EffectiveAuthority {
    return {
        trust: 'isolated-client',
        grants: ['storage.read', 'storage.write'],
        features: ['or3-portable-client-v1'],
        engines: ['or3>=1.0.0'],
        destinations: [
            {
                host: 'api.example.com',
                methods: ['GET'],
                pathPrefixes: ['/v1/'],
                connection: 'example',
            },
        ],
        connectionScopes: ['read:notes'],
        dataScopes: ['documents.read'],
        writes: [],
        setupHooks: ['test-connection', 'summarize'],
        dependencies: [],
        ...overrides,
    };
}

describe('effective authority (4.6)', () => {
    it('changes the hash when only a destination method changes', async () => {
        const readOnly = await computeAuthorityHash(authority());
        const writable = await computeAuthorityHash(
            authority({
                destinations: [
                    {
                        host: 'api.example.com',
                        methods: ['GET', 'POST'],
                        pathPrefixes: ['/v1/'],
                        connection: 'example',
                    },
                ],
            })
        );
        expect(readOnly).not.toBe(writable);
    });

    it('requires fresh consent when authority expands without a new grant string (IN12)', () => {
        const comparison = compareAuthority(
            authority(),
            authority({
                destinations: [
                    {
                        host: 'api.example.com',
                        methods: ['GET', 'POST'],
                        pathPrefixes: ['/v1/', '/v2/'],
                        connection: 'example',
                    },
                    { host: 'files.example.com', methods: ['GET'], pathPrefixes: ['/'] },
                ],
                dataScopes: ['documents.read', 'documents.write'],
            })
        );

        expect(comparison.expanded).toBe(true);
        expect(comparison.requiresFreshConsent).toBe(true);
        expect(comparison.expansions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'method-added', detail: 'api.example.com POST' }),
                expect.objectContaining({ kind: 'path-added', detail: 'api.example.com /v2/' }),
                expect.objectContaining({ kind: 'host-added', detail: 'files.example.com' }),
                expect.objectContaining({
                    kind: 'data-scope-added',
                    detail: 'documents.write',
                }),
            ])
        );
    });

    it('requires fresh consent when a write appears without a new grant string', () => {
        const comparison = compareAuthority(authority(), authority({ writes: ['notes.append'] }));

        expect(comparison.expanded).toBe(true);
        expect(comparison.requiresFreshConsent).toBe(true);
        expect(comparison.expansions).toEqual([
            expect.objectContaining({ kind: 'write-added', detail: 'notes.append' }),
        ]);
    });

    it('treats narrowing as technical review without redundant broad consent', () => {
        const comparison = compareAuthority(
            authority({
                destinations: [
                    {
                        host: 'api.example.com',
                        methods: ['GET', 'POST'],
                        pathPrefixes: ['/v1/'],
                        connection: 'example',
                    },
                ],
                dataScopes: ['documents.read', 'documents.write'],
            }),
            authority()
        );

        expect(comparison.narrowed).toBe(true);
        expect(comparison.expanded).toBe(false);
        expect(comparison.requiresFreshConsent).toBe(false);
        expect(comparison.requiresTechnicalReview).toBe(true);
    });

    it('treats a changed connection identity as an expansion, not identity (IN12)', () => {
        const comparison = compareAuthority(
            authority(),
            authority({
                destinations: [
                    {
                        host: 'api.example.com',
                        methods: ['GET'],
                        pathPrefixes: ['/v1/'],
                        connection: 'other-account',
                    },
                ],
            })
        );

        expect(comparison.identical).toBe(false);
        expect(comparison.expanded).toBe(true);
        expect(comparison.requiresFreshConsent).toBe(true);
        expect(comparison.expansions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'connection-changed' }),
            ])
        );
    });

    it('keeps several destinations for one host instead of collapsing them', () => {
        const twoAccountsForOneHost: EffectiveAuthority = authority({
            destinations: [
                {
                    host: 'api.example.com',
                    methods: ['GET'],
                    pathPrefixes: ['/v1/'],
                    connection: 'account-a',
                },
                {
                    host: 'api.example.com',
                    methods: ['GET'],
                    pathPrefixes: ['/v1/'],
                    connection: 'account-b',
                },
            ],
        });

        expect(compareAuthority(twoAccountsForOneHost, twoAccountsForOneHost)).toMatchObject({
            identical: true, expanded: false, narrowed: false,
        });

        const widenedSecondEntry = compareAuthority(twoAccountsForOneHost, {
            ...twoAccountsForOneHost,
            destinations: [
                twoAccountsForOneHost.destinations[0]!,
                {
                    host: 'api.example.com',
                    methods: ['GET', 'POST'],
                    pathPrefixes: ['/v1/'],
                    connection: 'account-b',
                },
            ],
        });
        expect(widenedSecondEntry.expanded).toBe(true);
        expect(widenedSecondEntry.expansions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'method-added', detail: 'api.example.com POST' }),
            ])
        );
    });

    it('hashes same-host destinations independently of connection declaration order', async () => {
        const first = authority({
            destinations: [
                {
                    host: 'api.example.com',
                    methods: ['POST'],
                    pathPrefixes: ['/write'],
                    connection: 'account-b',
                },
                {
                    host: 'api.example.com',
                    methods: ['GET'],
                    pathPrefixes: ['/read'],
                    connection: 'account-a',
                },
            ],
        });
        const second = {
            ...first,
            destinations: [...first.destinations].reverse(),
        };
        await expect(computeAuthorityHash(first)).resolves.toBe(
            await computeAuthorityHash(second)
        );
    });

    it('treats every list-like authority field as a deduplicated set', async () => {
        const first = authority({
            grants: ['storage.read', 'storage.read', 'storage.write'],
            features: ['feature-b', 'feature-a', 'feature-b'],
            engines: ['or3>=1.0.0', 'or3>=1.0.0'],
            destinations: [
                {
                    host: 'api.example.com',
                    methods: ['GET', 'GET'],
                    pathPrefixes: ['/v1/', '/v1/'],
                    connection: 'example',
                },
            ],
            connectionScopes: ['read:notes', 'read:notes'],
            dataScopes: ['documents.read', 'documents.read'],
            writes: ['notes.append', 'notes.append'],
            setupHooks: ['summarize', 'summarize'],
            dependencies: ['dep-a', 'dep-a'],
        });
        const second = authority({
            grants: ['storage.write', 'storage.read'],
            features: ['feature-a', 'feature-b'],
            engines: ['or3>=1.0.0'],
            destinations: [
                {
                    host: 'api.example.com',
                    methods: ['GET'],
                    pathPrefixes: ['/v1/'],
                    connection: 'example',
                },
            ],
            connectionScopes: ['read:notes'],
            dataScopes: ['documents.read'],
            writes: ['notes.append'],
            setupHooks: ['summarize'],
            dependencies: ['dep-a'],
        });

        await expect(computeAuthorityHash(first)).resolves.toBe(
            await computeAuthorityHash(second)
        );
    });

    it('signs engine changes without requiring fresh access consent', async () => {
        const next = authority({ engines: ['or3>=2.0.0'] });
        expect(await computeAuthorityHash(authority())).not.toBe(
            await computeAuthorityHash(next)
        );
        expect(compareAuthority(authority(), next)).toMatchObject({
            identical: true,
            expanded: false,
            requiresFreshConsent: false,
        });
    });

});

describe('selection handles (4.6)', () => {
    it('mints host-created handles and resolves only for the owner', () => {
        const handles = new SelectionHandleAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 3,
        });
        const handle = handles.mint({ kind: 'document', contextId: 'doc_1' });
        expect(handle.handleId).toMatch(/^sel_/);

        expect(
            handles.resolve(handle.handleId, {
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
            })
        ).toMatchObject({ status: 'resolved' });

        expect(
            handles.resolve(handle.handleId, {
                pluginId: 'other.plugin',
                workspaceId: 'ws_1',
            })
        ).toMatchObject({ status: 'denied', code: 'handle-foreign' });

        expect(
            handles.resolve(handle.handleId, {
                pluginId: 'example.plugin',
                workspaceId: 'ws_2',
            })
        ).toMatchObject({ status: 'denied', code: 'handle-foreign' });
    });

    it('invalidates handles on generation rotation', () => {
        const handles = new SelectionHandleAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
        });
        const handle = handles.mint({ kind: 'message', contextId: 'msg_1' });
        handles.rotateGeneration(2);
        expect(
            handles.resolve(handle.handleId, {
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
            })
        ).toMatchObject({ status: 'denied', code: 'handle-stale' });
    });

    it('denies handles the host never minted', () => {
        const handles = new SelectionHandleAuthority({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
        });
        expect(
            handles.resolve('sel_forged', {
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
            })
        ).toMatchObject({ status: 'denied', code: 'handle-stale' });
    });
});

describe('cross-repo authority vector', () => {
    it('derives the pinned digest from descriptor bytes', async () => {
        const { toEffectiveAuthority } = await import(
            '~~/server/utils/plugins/setup/load-descriptors'
        );
        const authority = toEffectiveAuthority({
            manifest: {
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
            } as never,
            policy: {
                policyVersion: 1,
                profile: 'or3-portable-client-v1',
                destinations: [
                    {
                        id: 'api',
                        methods: ['POST', 'GET'],
                        hosts: ['b.example.com', 'a.example.com'],
                        scopes: ['/v2', '/v1'],
                    },
                ],
                connections: [{ id: 'repo', scopes: ['write', 'read'], operations: ['sync'] }],
                dataScopes: ['documents.read'],
                writes: ['tasks.append'],
                requiredFeatures: ['or3-portable-client-v1'],
            } as never,
            setup: {
                testAction: { operationId: 'z-test' },
                firstAction: { operationId: 'a-first' },
            } as never,
        });
        // Pinned across SDK, host and marketplace: any derivation or
        // serialization drift fails here instead of shipping unbindable receipts.
        await expect(computeAuthorityHash(authority)).resolves.toBe(
            'sha256-399295ea37a06a01d4b1a49fbeae04f069fa7b16478d5536da0628408e54302c'
        );
    });
});

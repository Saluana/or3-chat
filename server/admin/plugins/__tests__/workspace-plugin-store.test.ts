import { describe, expect, it, vi } from 'vitest';
import type { EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import type { WorkspaceSettingsStore } from '../../stores/types';
import {
    bootstrapDefaultEnabledPlugins,
    getEnabledPlugins,
    getPluginAccessPolicy,
    getPluginAccessPolicySnapshot,
    getPluginGrantReview,
    getPluginSettings,
    replacePluginSettings,
    setPluginAccessPolicy,
    setPluginEnabled,
    setPluginGrantReview,
    setPluginSettings,
    type PluginGrantCandidate,
} from '../workspace-plugin-store';

const DIGEST_A = `sha256-${'1'.repeat(64)}` as const;
const DIGEST_B = `sha256-${'2'.repeat(64)}` as const;
const DIGEST_C = `sha256-${'3'.repeat(64)}` as const;

function authorityDescriptor(
    overrides: Partial<EffectiveAuthority> = {}
): EffectiveAuthority {
    return {
        trust: 'isolated-client',
        grants: ['documents.read', 'tools.register.client'],
        features: [],
        engines: ['or3:>=1.0.0'],
        destinations: [
            {
                host: 'api.example.com',
                methods: ['GET'],
                pathPrefixes: ['/v1/'],
                connection: 'example',
            },
        ],
        connectionScopes: [],
        dataScopes: ['documents.read'],
        writes: [],
        setupHooks: [],
        dependencies: [],
        ...overrides,
    };
}

function candidate(
    overrides: Partial<PluginGrantCandidate> = {}
): PluginGrantCandidate {
    return {
        requestedGrants: ['documents.read', 'tools.register.client'],
        releaseId: 'rel_1',
        packageDigest: DIGEST_A,
        authoritySha256: DIGEST_A,
        authority: authorityDescriptor(),
        ...overrides,
    };
}

function createStore() {
    const map = new Map<string, string>();
    const store: WorkspaceSettingsStore = {
        get: vi.fn(async (workspaceId, key) => {
            return map.get(`${workspaceId}:${key}`) ?? null;
        }),
        set: vi.fn(async (workspaceId, key, value) => {
            map.set(`${workspaceId}:${key}`, value);
        }),
    };
    return { map, store };
}

describe('workspace plugin store', () => {
    it('returns empty enabled list when unset', async () => {
        const { store } = createStore();
        const enabled = await getEnabledPlugins(store, 'ws-1');
        expect(enabled).toEqual([]);
    });

    it('adds and removes enabled plugins', async () => {
        const { store } = createStore();
        const added = await setPluginEnabled(store, 'ws-1', 'plugin.a', true);
        expect(added).toEqual(['plugin.a']);
        expect(store.set).toHaveBeenCalledWith(
            'ws-1',
            'plugins.enabled',
            JSON.stringify(['plugin.a'])
        );

        const removed = await setPluginEnabled(store, 'ws-1', 'plugin.a', false);
        expect(removed).toEqual([]);
    });

    it('stores and loads plugin settings', async () => {
        const { store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', { enabled: true, count: 2 });

        const settings = await getPluginSettings(store, 'ws-1', 'plugin.a');
        expect(settings).toEqual({ enabled: true, count: 2 });
    });

    it('merges settings updates without dropping unknown keys', async () => {
        const { store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', {
            enabled: true,
            nested: { keep: 1 },
        });
        await setPluginSettings(store, 'ws-1', 'plugin.a', {
            access: { authRequired: true },
        });

        const settings = await getPluginSettings(store, 'ws-1', 'plugin.a');
        expect(settings).toEqual({
            enabled: true,
            nested: { keep: 1 },
            access: { authRequired: true },
        });
    });

    it('replaces settings exactly for lifecycle rollback', async () => {
        const { store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', {
            preserved: true,
            removedDuringMigration: 'old',
        });
        await replacePluginSettings(store, 'ws-1', 'plugin.a', {
            restored: true,
        });

        expect(await getPluginSettings(store, 'ws-1', 'plugin.a')).toEqual({
            restored: true,
        });
    });

    it('stores and resolves access policy', async () => {
        const { store } = createStore();
        await setPluginAccessPolicy(store, 'ws-1', 'plugin.a', {
            authRequired: true,
            requiredEntitlements: ['paid'],
        });

        await expect(getPluginAccessPolicy(store, 'ws-1', 'plugin.a')).resolves.toEqual({
            authRequired: true,
            requiredEntitlements: ['paid'],
            requiredWorkspaceRoles: [],
            mode: 'all',
        });
    });

    it('rejects invalid access policy payloads', async () => {
        const { store } = createStore();
        await expect(
            setPluginAccessPolicy(store, 'ws-1', 'plugin.a', {
                authRequired: true,
                requiredWorkspaceRoles: ['owner', 'invalid'] as unknown as Array<
                    'owner' | 'editor' | 'viewer'
                >,
            })
        ).rejects.toThrow('Invalid access policy');
    });

    it('persists authority-bound consent under a separate key with a content revision', async () => {
        const { map, store } = createStore();
        await setPluginSettings(store, 'ws-1', 'plugin.a', { theme: 'dark' });

        const review = await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate(),
            approvedGrants: ['documents.read'],
            reviewedAt: 123,
            reviewedBy: 'user-1',
        });

        expect(review).toMatchObject({
            status: 'current',
            requestedGrants: ['documents.read', 'tools.register.client'],
            approvedGrants: ['documents.read'],
            packageDigest: DIGEST_A,
            authoritySha256: DIGEST_A,
        });
        expect(review.revision).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(map.get('ws-1:plugins.settings.plugin.a')).toBe(
            JSON.stringify({ theme: 'dark' })
        );
        expect(JSON.parse(map.get('ws-1:plugins.grants.plugin.a')!)).toMatchObject({
            schemaVersion: 2,
            releaseId: 'rel_1',
            packageDigest: DIGEST_A,
            authoritySha256: DIGEST_A,
            revision: review.revision,
            reviewedAt: 123,
            reviewedBy: 'user-1',
        });

        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', candidate())
        ).resolves.toEqual(review);
    });

    it('revisions access policy and reviewed authority independently', async () => {
        const { store } = createStore();
        const initialPolicy = await getPluginAccessPolicySnapshot(
            store,
            'ws-1',
            'plugin.a'
        );
        const initialGrants = await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate({ requestedGrants: ['documents.read'] }),
            approvedGrants: [],
            reviewedAt: 1,
        });

        await setPluginAccessPolicy(store, 'ws-1', 'plugin.a', {
            authRequired: true,
        });
        const changedPolicy = await getPluginAccessPolicySnapshot(
            store,
            'ws-1',
            'plugin.a'
        );
        const unchangedGrants = await getPluginGrantReview(
            store,
            'ws-1',
            'plugin.a',
            candidate({ requestedGrants: ['documents.read'] })
        );
        expect(changedPolicy.revision).not.toBe(initialPolicy.revision);
        expect(unchangedGrants.revision).toBe(initialGrants.revision);

        const changedGrants = await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate({ requestedGrants: ['documents.read'] }),
            approvedGrants: ['documents.read'],
            reviewedAt: 2,
        });
        const stillSamePolicy = await getPluginAccessPolicySnapshot(
            store,
            'ws-1',
            'plugin.a'
        );
        expect(changedGrants.revision).not.toBe(initialGrants.revision);
        expect(stillSamePolicy.revision).toBe(changedPolicy.revision);
    });

    it('fails closed when authority expands even though the grant strings are unchanged', async () => {
        const { store } = createStore();
        await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate(),
            approvedGrants: ['documents.read', 'tools.register.client'],
            reviewedAt: 1,
        });

        const expanded = candidate({
            packageDigest: DIGEST_B,
            authoritySha256: DIGEST_B,
            authority: authorityDescriptor({
                destinations: [
                    {
                        host: 'api.example.com',
                        methods: ['GET', 'POST'],
                        pathPrefixes: ['/v1/', '/v2/'],
                        connection: 'example',
                    },
                    { host: 'files.example.com', methods: ['GET'], pathPrefixes: ['/'] },
                ],
                writes: ['notes.append'],
            }),
        });
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', expanded)
        ).resolves.toMatchObject({
            status: 'stale',
            approvedGrants: [],
        });
    });

    it('carries consent across a narrowing update without fresh approval', async () => {
        const { store } = createStore();
        await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate(),
            approvedGrants: ['documents.read', 'tools.register.client'],
            reviewedAt: 1,
        });

        const narrowed = candidate({
            requestedGrants: ['documents.read'],
            packageDigest: DIGEST_B,
            authoritySha256: DIGEST_B,
            authority: authorityDescriptor({ grants: ['documents.read'] }),
        });
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', narrowed)
        ).resolves.toMatchObject({
            status: 'current',
            requestedGrants: ['documents.read'],
            approvedGrants: ['documents.read'],
        });
    });

    it('requires review for zero-grant authority and catches a destination expansion', async () => {
        const { store } = createStore();
        const initial = candidate({
            requestedGrants: [],
            authoritySha256: DIGEST_A,
            authority: authorityDescriptor({ grants: [] }),
        });
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', initial)
        ).resolves.toMatchObject({ status: 'unreviewed', approvedGrants: [] });
        await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: initial,
            approvedGrants: [],
            reviewedAt: 1,
        });
        const expanded = {
            ...initial,
            packageDigest: DIGEST_B,
            authoritySha256: DIGEST_B,
            authority: authorityDescriptor({
                grants: [],
                destinations: [
                    ...authorityDescriptor().destinations,
                    { host: 'files.example.com', methods: ['GET'], pathPrefixes: ['/'] },
                ],
            }),
        };
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', expanded)
        ).resolves.toMatchObject({ status: 'stale', approvedGrants: [] });
    });

    it('carries registry-only consent only to the exact signed authority and bytes', async () => {
        const { store } = createStore();
        const registryOnly = candidate({
            packageDigest: DIGEST_A,
            authoritySha256: DIGEST_A,
            authority: null,
        });
        await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: registryOnly,
            approvedGrants: ['documents.read'],
            reviewedAt: 1,
        });

        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', registryOnly)
        ).resolves.toMatchObject({ status: 'current' });
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', {
                ...registryOnly,
                packageDigest: DIGEST_B,
            })
        ).resolves.toMatchObject({ status: 'stale' });
        await expect(
            getPluginGrantReview(store, 'ws-1', 'plugin.a', {
                ...registryOnly,
                authoritySha256: DIGEST_B,
            })
        ).resolves.toMatchObject({ status: 'stale' });
    });

    it('treats a schema-1 grant-only review as stale', async () => {
        const { map, store } = createStore();
        map.set(
            'ws-1:plugins.grants.plugin.a',
            JSON.stringify({
                schemaVersion: 1,
                requestedGrants: ['documents.read'],
                approvedGrants: ['documents.read'],
                revision: DIGEST_C,
                reviewedAt: 1,
            })
        );
        await expect(
            getPluginGrantReview(
                store,
                'ws-1',
                'plugin.a',
                candidate({ requestedGrants: ['documents.read'] })
            )
        ).resolves.toMatchObject({ status: 'stale', approvedGrants: [] });
    });

    it('fails closed when requested grants change or persisted review data is invalid', async () => {
        const { map, store } = createStore();
        await setPluginGrantReview(store, 'ws-1', 'plugin.a', {
            candidate: candidate({ requestedGrants: ['documents.read'] }),
            approvedGrants: ['documents.read'],
            reviewedAt: 1,
        });

        await expect(
            getPluginGrantReview(
                store,
                'ws-1',
                'plugin.a',
                candidate({
                    requestedGrants: ['documents.read', 'documents.write'],
                    authority: authorityDescriptor({
                        grants: ['documents.read', 'documents.write'],
                    }),
                })
            )
        ).resolves.toMatchObject({
            status: 'stale',
            approvedGrants: [],
        });

        const persisted = JSON.parse(map.get('ws-1:plugins.grants.plugin.a')!);
        persisted.approvedGrants = ['documents.write'];
        map.set('ws-1:plugins.grants.plugin.a', JSON.stringify(persisted));
        await expect(
            getPluginGrantReview(
                store,
                'ws-1',
                'plugin.a',
                candidate({ requestedGrants: ['documents.read'] })
            )
        ).resolves.toMatchObject({
            status: 'unreviewed',
            approvedGrants: [],
        });
    });

    it('rejects approval for grants the plugin did not request', async () => {
        const { store } = createStore();
        await expect(
            setPluginGrantReview(store, 'ws-1', 'plugin.a', {
                candidate: candidate({ requestedGrants: ['documents.read'] }),
                approvedGrants: ['documents.write'],
            })
        ).rejects.toThrow('Invalid reviewed grants');
    });

    it('rejects approval without a verifiable authority hash', async () => {
        const { store } = createStore();
        await expect(
            setPluginGrantReview(store, 'ws-1', 'plugin.a', {
                candidate: candidate({ authoritySha256: null, authority: null }),
                approvedGrants: ['documents.read'],
            })
        ).rejects.toThrow('Reviewed authority must be verifiable');
    });

    it('rejects invalid plugin settings payloads', async () => {
        const { store } = createStore();
        await expect(
            setPluginSettings(store, 'ws-1', 'plugin.a', null as unknown as Record<string, unknown>)
        ).rejects.toThrow('Invalid settings');
    });

    it('returns defaults when stored JSON is invalid', async () => {
        const { store, map } = createStore();
        map.set('ws-1:plugins.enabled', '{bad');
        map.set('ws-1:plugins.settings.plugin.a', '{bad');

        await expect(getEnabledPlugins(store, 'ws-1')).resolves.toEqual([]);
        await expect(getPluginSettings(store, 'ws-1', 'plugin.a')).resolves.toEqual({});
    });

    it('bootstraps default enabled plugins only when key is unset', async () => {
        const { store } = createStore();
        const seeded = await bootstrapDefaultEnabledPlugins(store, 'ws-1', [
            'plugin.a',
            'plugin.a',
            '',
            'plugin.b',
        ]);
        expect(seeded).toEqual(['plugin.a', 'plugin.b']);

        const unchanged = await bootstrapDefaultEnabledPlugins(store, 'ws-1', ['plugin.c']);
        expect(unchanged).toEqual(['plugin.a', 'plugin.b']);
    });
});

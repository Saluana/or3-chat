import { describe, expect, it, vi } from 'vitest';
import type { Or3PackagePolicyV1, Or3SetupDescriptorV1 } from '@or3/plugin-sdk/profile';
import { FAKE_CONNECTION_PROVIDER } from '~~/shared/plugins/connections/fake-provider';
import { PluginConnectionService } from '../../connections/service';
import { createMemoryPluginConnectionStore } from '../../connections/store/memory';
import { loadSetupState } from '../state';

const setup: Or3SetupDescriptorV1 = {
    setupVersion: 1,
    settingsSchemaPath: 'settings.schema.json',
    fields: [],
    connections: ['docs'],
    testAction: { operationId: 'items.list', deadlineMs: 5000 },
    firstAction: { operationId: 'summarize', label: 'Summarize', usesSampleContext: true },
};
const policy: Or3PackagePolicyV1 = {
    policyVersion: 1,
    profile: 'or3-portable-client-v1',
    destinations: [], dataScopes: [], writes: [], requiredFeatures: [],
    connections: [{
        id: 'docs', label: 'Docs', provider: 'fake', required: true,
        mechanism: 'server', scopes: ['read:items'], operations: ['items.list'],
    }],
};

vi.mock('../discovery', () => ({
    resolvePluginPackage: async () => ({
        status: 'ready', selectedSlot: 'current', pointerRevision: 1, issues: [],
        path: '/fixture/package', digest: `sha256-${'a'.repeat(64)}`,
    }),
}));
vi.mock('../load-descriptors', () => ({
    loadPackageDescriptors: async () => ({ setup, policy, problems: [] }),
}));
vi.mock('../settings-store', () => ({
    readSetupValuesSnapshot: async () => ({ values: {}, revision: 0 }),
}));
vi.mock('../../connections/providers/registry', () => ({
    listConnectionProviders: () => [FAKE_CONNECTION_PROVIDER],
}));

describe('stored connections in the host setup plan', () => {
    // A duplicate untested credential must not hide the owner's tested one,
    // whatever the store order; another owner's credential cannot satisfy setup.
    it.each([0, 1])('uses the tested connection at list position %i', async (testedIndex) => {
        let nextId = 0;
        const service = new PluginConnectionService({
            store: createMemoryPluginConnectionStore(),
            secret: 'setup-regression-test-secret',
            generateId: () => `conn${++nextId}`,
        });
        const scope = { ownerUserId: 'user-1', workspaceId: 'ws-1', pluginId: 'sample.plugin' };
        for (let index = 0; index < 2; index++) {
            const created = await service.create({
                ...scope, providerId: 'fake', slotId: 'docs', label: 'Docs',
                scopes: ['read:items'], credential: `test-key-${index}`,
            });
            expect(created.status).toBe('created');
        }
        const connections = await service.list(scope);
        const tested = connections[testedIndex]!;
        await service.recordTest({
            connectionId: tested.id, revision: tested.revision,
            operationId: 'items.list', ok: true, checkedAt: Date.now(),
        });
        const input = { ...scope, event: {} as never, service,
            durableConnections: true, hasSelectedContext: false };
        const state = await loadSetupState(input);
        expect(state.plan?.status).toBe('ready');
        const otherOwner = await loadSetupState({ ...input, ownerUserId: 'user-2' });
        expect(otherOwner.plan?.status).not.toBe('ready');
    });
});

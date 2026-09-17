import { describe, expect, it, vi, beforeEach } from 'vitest';

const listMock = vi.fn();
const extensionsMock = vi.fn();
const requireAdminMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    setResponseHeader: vi.fn(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        public: {
            appVersion: '0.1.70',
            ssrAuthEnabled: true,
            admin: { pluginRuntimeLoaderEnabled: true },
        },
    }),
}));

vi.mock('../../../admin/api', () => ({
    requireAdminApiContext: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock('../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: (...args: unknown[]) => extensionsMock(...args),
}));

vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: async () => ['or3.sample-utility'],
}));

vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}),
}));

vi.mock('../../../admin/plugins/package-route-catalog', () => ({
    PluginPackageRouteCatalog: class {
        async listSelected() {
            return [
                {
                    status: 'ready',
                    pluginId: 'or3.sample-utility',
                    packageDigest: `sha256-${'a'.repeat(64)}`,
                    manifest: {
                        trust: 'isolated-client',
                        runtime: { client: { entry: 'client.mjs' } },
                    },
                    routes: [],
                },
            ];
        }
    },
}));

vi.mock('../../../utils/plugins/acquisition/operation-store', () => ({
    PluginAcquisitionOperationStore: class {
        list(...args: unknown[]) {
            return listMock(...args);
        }
    },
}));

vi.mock('../../../utils/plugins/acquisition/config', () => ({
    acquisitionConfig: () => ({
        registryOrigin: 'https://registry.example',
        installEnabled: true,
        releaseKeys: [{ keyId: 'k', publicJwk: {} }],
        supportedProfiles: ['or3-portable-client-v1'],
    }),
}));

vi.mock('../../../utils/plugins/acquisition/registry-state', () => ({
    RegistryStateStore: class {
        async read() {
            return { schemaVersion: 1, acceptedAdvisorySequence: 4, updatedAt: 0 };
        }
    },
}));

describe('GET /api/plugins/diagnostics', () => {
    beforeEach(() => {
        requireAdminMock.mockReset().mockResolvedValue({
            session: { workspace: { id: 'ws-1' }, role: 'owner' },
        });
        extensionsMock.mockReset().mockResolvedValue([{ kind: 'plugin', id: 'legacy', version: '1.0.0' }]);
        listMock.mockReset().mockResolvedValue([
            {
                operationId: 'acq_1',
                pluginId: 'or3.sample-utility',
                version: '1.0.0',
                stage: 'health-checked',
                status: 'failed',
                attempts: 2,
                failure: { code: 'client-canary-pending', retryable: true },
            },
        ]);
    });

    it('reports state and operation ids while omitting secrets and content', async () => {
        const handler = (await import('../diagnostics.get')).default;
        const report = (await handler({} as never)) as Record<string, never>;

        expect(report.host.appVersion).toBe('0.1.70');
        expect(report.marketplace.acceptedAdvisorySequence).toBe(4);
        expect(report.operations[0]).toMatchObject({
            operationId: 'acq_1',
            failureCode: 'client-canary-pending',
        });
        expect(report.workspace.installedPackages[0]).toMatchObject({
            pluginId: 'or3.sample-utility',
            trust: 'isolated-client',
        });

        // No string in the report may look like a credential or a signed URL.
        const strings: string[] = [];
        const walk = (value: unknown): void => {
            if (typeof value === 'string') {
                strings.push(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const entry of value) walk(entry);
                return;
            }
            if (value && typeof value === 'object') {
                for (const entry of Object.values(value)) walk(entry);
            }
        };
        walk(report);
        for (const value of strings) {
            expect(value).not.toMatch(/(?:sk-|Bearer\s|eyJ[A-Za-z0-9_-]{10,}|BEGIN [A-Z ]*PRIVATE KEY)/);
        }
        // The report itself states what was left out.
        expect(report.redaction.omitted).toContain('connection names and secrets');
    });
});

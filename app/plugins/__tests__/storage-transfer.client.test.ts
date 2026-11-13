import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { testRuntimeConfig } from '../../../tests/setup';

const session = ref<{ session?: { authenticated: boolean; workspace?: { id: string }; user?: { id: string } } }>({});
const access = ref(false);
const queue = {
    workspaceId: null as string | null,
    accountId: null as string | null,
    // Each upload toggle records the workspace bound at that moment.
    uploadToggles: [] as Array<{ enabled: boolean; workspaceId: string | null }>,
    setWorkspaceId(id: string | null, account: string | null) { this.workspaceId = id; this.accountId = account; },
    setUploadsEnabled(enabled: boolean) { this.uploadToggles.push({ enabled, workspaceId: this.workspaceId }); },
    getWorkspaceId() { return this.workspaceId; },
    dispose: vi.fn(),
};

vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: session }) }));
vi.mock('~/core/cloud/access', () => ({ useCloudAccess: () => computed(() => access.value) }));
vi.mock('~/core/storage/transfer-queue', () => ({ getStorageTransferQueue: () => queue }));
vi.mock('~/core/storage/file-policy', async (importOriginal) => ({
    ...await importOriginal<typeof import('~/core/storage/file-policy')>(),
    loadFilePolicy: vi.fn(async () => { throw new Error('offline'); }),
}));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('storage transfer plugin', () => {
    it('binds the session workspace before resuming uploads, so deferred admissions requeue there', async () => {
        // Nuxt auto-imports used by the plugin module.
        vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
        vi.stubGlobal('useRuntimeConfig', () => ({
            ...testRuntimeConfig.value,
            public: { ...testRuntimeConfig.value.public, ssrAuthEnabled: true, storage: { enabled: true, provider: 'gateway' } },
        }));
        const plugin = (await import('../storage-transfer.client')).default as unknown as
            (app: { vueApp: { onUnmount(fn: () => void): void } }) => Promise<void>;
        let dispose: (() => void) | undefined;
        await plugin({ vueApp: { onUnmount: fn => { dispose = fn; } } });
        try {
            // Billing deployments learn the workspace and Cloud access together.
            session.value = { session: { authenticated: true, user: { id: 'account-a' }, workspace: { id: 'ws-1' } } };
            access.value = true;
            await nextTick();
            expect(queue.uploadToggles.at(-1)).toEqual({ enabled: true, workspaceId: 'ws-1' });
            expect(queue.accountId).toBe('account-a');
            session.value = { session: { authenticated: true, user: { id: 'account-b' }, workspace: { id: 'ws-1' } } };
            await nextTick();
            expect(queue.accountId).toBe('account-b');
        } finally {
            dispose?.();
        }
    });
});

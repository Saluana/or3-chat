import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MarketplaceInstalled from '../MarketplaceInstalled.vue';
import type { Ref } from 'vue';

vi.mock('~/composables/auth/useSessionContext', async () => {
    const { ref } = await import('vue');
    const workspace = ref<string | null>(null);
    const deploymentAdmin = ref(true);
    return {
        getCachedSessionContext: () => workspace.value ? { workspace: { id: workspace.value }, role: 'owner', deploymentAdmin: deploymentAdmin.value } : null,
        testWorkspace: workspace,
        testDeploymentAdmin: deploymentAdmin,
    };
});

/**
 * Pointer slots hold digests, never versions. The UI renders the server's
 * display DTO (version read from the stored manifest of the selected slot), so a
 * promoted package shows its version and gets an Open action instead of the
 * "no version selected" a guessed `pointer.selected.version` produced.
 */
const fetchMock = vi.fn();
const openPageMock = vi.fn(async () => true);
const reconcileMock = vi.fn();
vi.mock('~/composables/plugins/bundled-v1-manager-runtime', () => ({ requestWorkspacePluginReconcile: (...args: unknown[]) => reconcileMock(...args) }));
const sourceMock = vi.fn(() => ({}));
vi.mock('~/composables/plugins/portable-pane', () => ({openInstalledPluginPane: (...args: unknown[]) => openPageMock(...args)}));
const { activationsState, trustedActivationsState } = vi.hoisted(() => ({
    activationsState: { current: new Map() as Map<string, unknown> },
    trustedActivationsState: { current: new Map() as Map<string, unknown> },
}));
vi.mock('~/composables/plugins/trusted-v2-manager', () => ({
    useTrustedV2Activations: () => trustedActivationsState.current,
}));
vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    getPortableClientSource: () => sourceMock(),
    usePortableActivations: () => activationsState.current,
    isPortableActivationReady: (activation: { status?: string }) => activation.status === 'active',
}));
vi.stubGlobal('$fetch', fetchMock);

const stubs = {
    UModal: { props: ['open', 'title', 'description'], emits: ['update:open'], template: '<section v-if="open" role="dialog" @keydown.esc="$emit(\'update:open\', false)"><h2>{{ title }}</h2><slot name="body" /><slot name="footer" /></section>' },
    UButton: {
        props: ['disabled', 'loading', 'to'],
        emits: ['click'],
        template:
            '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
    UBadge: { template: '<span><slot /></span>' },
};

function pageResponse(
    display: Record<string, unknown>,
    pointer: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        plugins: [],
        role: 'owner',
        canManageSitePlugins: true,
        workspaceId: 'ws-1',
        enabledPlugins: ['sample.plugin'],
        packagePlugins: [
            {
                pluginId: 'sample.plugin',
                workspaceEnabled: true,
                siteApproval: 'approved',
                grantReview: 'current',
                setup: 'ready',
                pointer: {
                    current: { packageDigest: `sha256-${'a'.repeat(64)}` },
                    candidate: null,
                    previous: null,
                    ...pointer,
                },
                startup: {
                    status: 'ready',
                    selectedSlot: 'current',
                    selectedDigest: display.selectedDigest ?? null,
                    issueCodes: [],
                },
                display,
            },
        ],
    };
}

beforeEach(async () => {
    fetchMock.mockReset();
    activationsState.current = new Map();
    trustedActivationsState.current = new Map();
    reconcileMock.mockReset();
    const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null>; testDeploymentAdmin: Ref<boolean> };
    auth.testWorkspace.value = null;
    auth.testDeploymentAdmin.value = true;
});

describe('MarketplaceInstalled', () => {
    it('shows installed packages without management controls to a signed-in member', async () => {
        const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null>; testDeploymentAdmin: Ref<boolean> };
        auth.testWorkspace.value = 'ws-1';
        auth.testDeploymentAdmin.value = false;
        fetchMock.mockRejectedValueOnce({ statusCode: 403 }).mockResolvedValue({
            workspaceId: 'ws-1',
            enabledPluginIds: ['sample.plugin'],
            installedPluginIds: ['sample.plugin'],
            runtime: {
                'sample.plugin': {
                    lifecycleCoverage: 'managed-v2', descriptorStatus: 'blocked',
                    blockCode: 'module-loader-disabled', loadAllowed: false,
                },
            },
        });
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/runtime-manifest');
        expect(wrapper.text()).toContain('sample.plugin');
        expect(wrapper.text()).not.toContain('Uninstall');
        expect(wrapper.text()).not.toContain('Disable');
        wrapper.unmount();
    });

    it('shows an actionable, padded message when the session has expired', async () => {
        fetchMock.mockRejectedValue({ statusCode: 401, message: '[GET] /api/admin/plugins-page: 401 Unauthorized' });
        const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null> };
        auth.testWorkspace.value = 'ws-1';
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const error = wrapper.get('[data-testid="marketplace-installed-error"]');
        expect(error.attributes('role')).toBe('alert');
        expect(error.classes()).toContain('p-4');
        expect(error.text()).toContain('Sign in again');
        expect(error.text()).not.toContain('/api/admin/plugins-page');
        expect(error.text()).toContain('Try again');
        wrapper.unmount();
    });

    it('clears the old workspace list and uninstall confirmation on session switch', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const display = { version: '2.1.0', selectedDigest: digest, canOpen: true };
        let resolveSecond: (value: unknown) => void = () => undefined;
        fetchMock.mockResolvedValueOnce(pageResponse(display));
        fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null> };
        auth.testWorkspace.value = 'ws-1';
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.findAll('button').find((button) => button.text() === 'Uninstall')!.trigger('click');
        expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
        auth.testWorkspace.value = 'ws-2';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('2.1.0');
        resolveSecond({ ...pageResponse({ version: '3.0.0', selectedDigest: digest, canOpen: true }), workspaceId: 'ws-2' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('3.0.0');
    });
    it('shows the selected version and an Open action from the display DTO', async () => {
        fetchMock.mockResolvedValue(
            pageResponse({
                version: '2.1.0',
                selectedDigest: `sha256-${'a'.repeat(64)}`,
                candidateVersion: null,
                candidateDigest: null,
                canOpen: true,
            })
        );
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('2.1.0');
        expect(wrapper.text()).not.toContain('no version selected');
        expect(wrapper.text()).toContain('Open');
        const open = wrapper.findAll('button').find((button) => button.text() === 'Open')!;
        await open.trigger('click');
        expect(openPageMock).toHaveBeenCalledWith('sample.plugin');
    });

    it('hides Open and the version when no slot has a readable selection', async () => {
        fetchMock.mockResolvedValue(
            pageResponse({
                version: null,
                selectedDigest: null,
                candidateVersion: '3.0.0',
                candidateDigest: `sha256-${'b'.repeat(64)}`,
                canOpen: false,
            })
        );
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('no version selected');
        // No readable selection means nothing to open, even with a candidate waiting.
        expect(wrapper.text()).not.toContain('Open');
    });

    it('shows Running only for the exact selected digest in this workspace', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValue(
            pageResponse({
                version: '2.1.0',
                selectedDigest: digest,
                candidateVersion: null,
                candidateDigest: null,
                canOpen: true,
            })
        );
        activationsState.current = new Map([
            [
                'sample.plugin',
                {
                    pluginId: 'sample.plugin',
                    version: '2.1.0',
                    packageDigest: digest,
                    workspaceId: 'ws-1',
                    generation: 1,
                    status: 'active',
                    blockCode: null,
                    degradedContributions: [],
                },
            ],
        ]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('installed 2.1.0');
        expect(wrapper.text()).toContain('Running');
    });

    it('shows a trusted-host package as Running when this browser activated the selected digest', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValue(pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true }));
        trustedActivationsState.current = new Map([['sample.plugin', {
            pluginId: 'sample.plugin', version: '2.1.0', packageDigest: digest,
            workspaceId: 'ws-1', observedAt: new Date(0).toISOString(),
        }]]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('Running');
        expect(wrapper.text()).not.toContain('Not observed');
        expect(wrapper.text()).toContain(digest);
    });

    it('keeps a matching version with another digest unconfirmed', async () => {
        fetchMock.mockResolvedValue(
            pageResponse({
                version: '2.1.0',
                selectedDigest: `sha256-${'a'.repeat(64)}`,
                candidateVersion: null,
                candidateDigest: null,
                canOpen: true,
            })
        );
        activationsState.current = new Map([
            [
                'sample.plugin',
                {
                    pluginId: 'sample.plugin',
                    version: '2.1.0',
                    packageDigest: `sha256-${'f'.repeat(64)}`,
                    workspaceId: 'ws-1',
                    generation: 1,
                    status: 'active',
                    blockCode: null,
                    degradedContributions: [],
                },
            ],
        ]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('Enabled; browser check pending');
        const badges = wrapper.findAll('span').map((span) => span.text());
        expect(badges).not.toContain('Running');
    });

    it('does not report a stale package failure as the selected package failing', async () => {
        const selectedDigest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValue(pageResponse({ version: '2.1.0', selectedDigest, canOpen: true }));
        activationsState.current = new Map([['sample.plugin', {
            pluginId: 'sample.plugin', version: '2.0.0', packageDigest: `sha256-${'f'.repeat(64)}`,
            workspaceId: 'ws-1', generation: 1, status: 'blocked', blockCode: 'old-runtime-failure', degradedContributions: [],
        }]]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Enabled; browser check pending');
        expect(wrapper.text()).not.toContain('Plugin startup failed in this browser');
        expect(wrapper.text()).not.toContain('old-runtime-failure');
        wrapper.unmount();
    });

    it('checks the exact selected package in the current browser without reinstalling it', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValue(pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true }));
        trustedActivationsState.current = new Map([['sample.plugin', {
            pluginId: 'sample.plugin', version: '2.1.0', packageDigest: digest,
            workspaceId: 'ws-1', observedAt: '2026-09-27T00:00:00.000Z',
        }]]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.findAll('button').find((button) => button.text() === 'Run check')!.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Selected package: ready');
        expect(wrapper.text()).toContain('Workspace: enabled');
        expect(wrapper.text()).toContain('Browser activation: confirmed');
        expect(wrapper.text()).toContain('2026-09-27T00:00:00.000Z');
        expect(reconcileMock).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/acquisitions'), expect.anything());
        wrapper.unmount();
    });

    it('refreshes server readiness before trusting a matching browser activation', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const ready = pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true });
        const blocked = pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true });
        (blocked.packagePlugins as Array<{ startup: { status: string } }>)[0]!.startup.status = 'blocked';
        fetchMock.mockResolvedValueOnce(ready).mockResolvedValueOnce(blocked);
        trustedActivationsState.current = new Map([['sample.plugin', {
            pluginId: 'sample.plugin', version: '2.1.0', packageDigest: digest,
            workspaceId: 'ws-1', observedAt: '2026-09-27T00:00:00.000Z',
        }]]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.findAll('button').find((button) => button.text() === 'Run check')!.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Selected package: blocked');
        expect(wrapper.text()).toContain('Browser activation: not-applicable');
        expect(reconcileMock).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('reports a failed server refresh as unavailable instead of an activation timeout', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValueOnce(pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true }))
            .mockRejectedValueOnce(new Error('server offline'));
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.findAll('button').find((button) => button.text() === 'Run check')!.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Browser activation: Check unavailable');
        wrapper.unmount();
    });

    it('reports a failed required contribution as a failure without waiting for timeout', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockResolvedValue(pageResponse({ version: '2.1.0', selectedDigest: digest, canOpen: true }));
        activationsState.current = new Map([['sample.plugin', {
            pluginId: 'sample.plugin', version: '2.1.0', packageDigest: digest,
            workspaceId: 'ws-1', status: 'active', blockCode: null, startedAt: Date.now(),
            contributionReadiness: { pane: 'failed', sidebar: 'ready', tools: 'not-required' },
            degradedContributions: [],
        }]]);
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.findAll('button').find((button) => button.text() === 'Run check')!.trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Browser activation: failed');
        expect(wrapper.text()).toContain('pane contribution failed');
        wrapper.unmount();
    });

    it('allows a new browser check after switching workspaces during a pending check', async () => {
        const digest = `sha256-${'a'.repeat(64)}`;
        const display = { version: '2.1.0', selectedDigest: digest, canOpen: true };
        const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null> };
        auth.testWorkspace.value = 'ws-1';
        fetchMock.mockResolvedValueOnce(pageResponse(display)).mockResolvedValue({ ...pageResponse(display), workspaceId: 'ws-2' });
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const check = () => wrapper.findAll('button').find((button) => button.text() === 'Run check')!;
        await check().trigger('click');
        expect(check().attributes('disabled')).toBeDefined();
        auth.testWorkspace.value = 'ws-2';
        await vi.waitFor(() => {
            expect(check()).toBeDefined();
            expect(check()?.attributes('disabled')).toBeUndefined();
        });
        wrapper.unmount();
    });

});

it('requires versioned instance-wide confirmation and cancellation sends no mutation', async () => {
    fetchMock.mockResolvedValue(pageResponse({version: '2.1.0', selectedDigest: 'sha256-' + 'a'.repeat(64)}));
    const wrapper = mount(MarketplaceInstalled, {global: {stubs}});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = (label: string) => wrapper.findAll('button').find((entry) => entry.text() === label)!;
    const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    await button('Uninstall').trigger('click');
    expect(mutations()).toHaveLength(0);
    expect(wrapper.get('[role="dialog"]').text()).toContain('sample.plugin 2.1.0');
    expect(wrapper.get('[role="dialog"]').text()).toContain('every workspace');
    await button('Cancel').trigger('click');
    expect(mutations()).toHaveLength(0);
    await button('Uninstall').trigger('click');
    await wrapper.get('[role="dialog"]').trigger('keydown', {key: 'Escape'});
    expect(mutations()).toHaveLength(0);
    await button('Uninstall').trigger('click');
    await button('Remove from every workspace').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]![1].body.expectedPackageDigest).toBe('sha256-' + 'a'.repeat(64));
});

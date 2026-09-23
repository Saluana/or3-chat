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
const openPageMock = vi.fn();
const sourceMock = vi.fn(() => ({}));
vi.mock('~/composables/plugins/portable-pane', () => ({openPortablePane: (...args: unknown[]) => openPageMock(...args)}));
const { activationsState } = vi.hoisted(() => ({
    activationsState: { current: new Map() as Map<string, unknown> },
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
    const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null>; testDeploymentAdmin: Ref<boolean> };
    auth.testWorkspace.value = null;
    auth.testDeploymentAdmin.value = true;
});

describe('MarketplaceInstalled', () => {
    it('shows installed packages without management controls to a signed-in member', async () => {
        const auth = await import('~/composables/auth/useSessionContext') as unknown as { testWorkspace: Ref<string | null>; testDeploymentAdmin: Ref<boolean> };
        auth.testWorkspace.value = 'ws-1';
        auth.testDeploymentAdmin.value = false;
        fetchMock.mockResolvedValue({
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
        expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/plugins-page');
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

    it('shows Not observed when another digest runs under a matching version', async () => {
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

        expect(wrapper.text()).toContain('Not observed');
        const badges = wrapper.findAll('span').map((span) => span.text());
        expect(badges).not.toContain('Running');
    });

    it('offers roll back only when a previous selection exists', async () => {
        fetchMock.mockResolvedValue(
            pageResponse(
                {
                    version: '2.1.0',
                    selectedDigest: `sha256-${'a'.repeat(64)}`,
                    candidateVersion: null,
                    candidateDigest: null,
                    canOpen: true,
                },
                { previous: { packageDigest: `sha256-${'9'.repeat(64)}` } }
            )
        );
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Roll back');
    });

    it('hides roll back when no previous selection exists', async () => {
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
        expect(wrapper.text()).not.toContain('Roll back');
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

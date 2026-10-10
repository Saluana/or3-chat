import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    source: {} as unknown,
    navigation: { openResource: vi.fn(), canOpenInNewTab: () => true },
    split: vi.fn(),
    paneApps: [{ id: 'or3-workflows', pluginId: 'or3-workflows' }],
}));
vi.mock('../portable-client-runtime', () => ({ getPortableClientSource: () => mocks.source }));
vi.mock('~/utils/workspaceResourceNavigation', () => ({ getWorkspaceResourceNavigationApi: () => mocks.navigation }));
vi.mock('~/utils/multiPaneApi', () => ({ getGlobalMultiPaneApi: mocks.split }));
vi.mock('~/composables/core/usePaneApps', () => ({ usePaneApps: () => ({ listPaneApps: { value: mocks.paneApps } }) }));
import { openInstalledPluginPane, openPortablePane, portablePaneId } from '../portable-pane';
beforeEach(() => { vi.clearAllMocks(); mocks.source = {}; mocks.navigation.openResource.mockResolvedValue({ status: 'activated' }); });
it('opens a real workspace tab through the resource registry without creating a split', async () => {
    await openPortablePane('or3sal.tasks');
    expect(mocks.navigation.openResource).toHaveBeenCalledWith({ kind: 'app', appId: portablePaneId('or3sal.tasks'), instanceKey: 'or3sal.tasks' }, 'new-tab', { reuseExisting: true });
    expect(mocks.split).not.toHaveBeenCalled();
});
it('refuses stale workspace sources and reports failed tab opening', async () => {
    mocks.source = null;
    await expect(openPortablePane('or3sal.tasks')).rejects.toThrow('not available');
    expect(mocks.navigation.openResource).not.toHaveBeenCalled();
    mocks.source = {};
    mocks.navigation.openResource.mockResolvedValue({ status: 'failed' });
    await expect(openPortablePane('or3sal.tasks')).rejects.toThrow('could not be opened');
});
it('finishes quietly without reporting an opened pane when navigation is superseded', async () => {
    mocks.navigation.openResource.mockResolvedValue({ status: 'superseded' });
    await expect(openPortablePane('or3sal.tasks')).resolves.toBe(false);
    mocks.source = null;
    await expect(openInstalledPluginPane('or3-workflows')).resolves.toBe(false);
    expect(mocks.split).not.toHaveBeenCalled();
});
it('opens the registered trusted-host pane for its installed plugin', async () => {
    mocks.source = null;
    await openInstalledPluginPane('or3-workflows');
    expect(mocks.navigation.openResource).toHaveBeenCalledWith(
        { kind: 'app', appId: 'or3-workflows', instanceKey: 'or3-workflows' },
        'new-tab',
        { reuseExisting: true },
    );
});

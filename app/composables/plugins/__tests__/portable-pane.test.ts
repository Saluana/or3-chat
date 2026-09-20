import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ source: {} as unknown, navigation: { openResource: vi.fn(), canOpenInNewTab: () => true }, split: vi.fn() }));
vi.mock('../portable-client-runtime', () => ({ getPortableClientSource: () => mocks.source }));
vi.mock('~/utils/workspaceResourceNavigation', () => ({ getWorkspaceResourceNavigationApi: () => mocks.navigation }));
vi.mock('~/utils/multiPaneApi', () => ({ getGlobalMultiPaneApi: mocks.split }));
import { openPortablePane, portablePaneId } from '../portable-pane';
beforeEach(() => { vi.clearAllMocks(); mocks.source = {}; mocks.navigation.openResource.mockResolvedValue(true); });
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
    mocks.navigation.openResource.mockResolvedValue(false);
    await expect(openPortablePane('or3sal.tasks')).rejects.toThrow('could not be opened');
});

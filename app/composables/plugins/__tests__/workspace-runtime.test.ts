import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
  registerDashboardPlugin: vi.fn(),
  unregisterDashboardPlugin: vi.fn(),
}));
vi.mock('~/composables/sidebar/registerSidebarPage', () => ({
  registerSidebarPage: vi.fn(() => () => {}),
}));
vi.mock('~/composables/core/usePaneApps', () => ({
  usePaneApps: vi.fn(() => ({
    registerPaneApp: vi.fn(),
    unregisterPaneApp: vi.fn(),
  })),
}));
vi.mock('~/composables/chat/useMessageActions', () => ({
  registerMessageAction: vi.fn(),
  unregisterMessageAction: vi.fn(),
}));
vi.mock('~/utils/chat/tools-public', () => ({
  useToolRegistry: vi.fn(() => ({
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
  })),
}));

describe('workspace plugin runtime registry', () => {
  beforeEach(async () => {
    const mod = await import('../workspace-runtime');
    for (const entry of mod.listWorkspacePluginInstances()) {
      mod.unregisterWorkspacePluginInstance(entry.id);
    }
  });

  it('prefers extension over builtin for same plugin id', async () => {
    const mod = await import('../workspace-runtime');
    const cleanupCalls: string[] = [];

    const builtin = mod.registerWorkspacePluginInstance('or3-tasks', 'builtin', () => {
      cleanupCalls.push('builtin');
    });
    expect(builtin.accepted).toBe(true);

    const extension = mod.registerWorkspacePluginInstance('or3-tasks', 'extension', () => {
      cleanupCalls.push('extension');
    });
    expect(extension.accepted).toBe(true);

    expect(cleanupCalls).toEqual(['builtin']);
    expect(mod.listWorkspacePluginInstances()).toEqual([
      { id: 'or3-tasks', source: 'extension' },
    ]);
  });

  it('rejects lower-priority builtin when extension already registered', async () => {
    const mod = await import('../workspace-runtime');

    mod.registerWorkspacePluginInstance('or3-tasks', 'extension', () => {});
    const result = mod.registerWorkspacePluginInstance('or3-tasks', 'builtin', () => {});

    expect(result.accepted).toBe(false);
    expect(mod.listWorkspacePluginInstances()).toEqual([
      { id: 'or3-tasks', source: 'extension' },
    ]);
  });
});

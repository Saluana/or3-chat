import { defineComponent } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePaneApps } from '~/composables/core/usePaneApps';
import {
    registerDashboardPlugin,
    type DashboardPlugin,
} from '~/composables/dashboard/useDashboardPlugins';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import { useWorkspaceProfiles } from '~/composables/workspace-profiles/useWorkspaceProfiles';
import {
    resolveWorkspaceProfile,
    STANDARD_OR3_PROFILE,
} from '~/core/workspace-profiles';
import { registerPaletteCommand } from '~/core/search/command-palette/registry';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';

const TestSurface = defineComponent({
    name: 'WorkspaceProfileLiveInventoryTestSurface',
    template: '<div />',
});

describe('Standard OR3 live registry parity', () => {
    let cleanup: Array<() => void> = [];
    let originalProcessClient: boolean | undefined;

    beforeEach(() => {
        originalProcessClient = (
            process as typeof process & {
                client?: boolean;
            }
        ).client;
        (
            process as typeof process & {
                client?: boolean;
            }
        ).client = true;
        (
            globalThis as typeof globalThis & {
                __or3SidebarPagesRegistry?: Map<string, unknown>;
            }
        ).__or3SidebarPagesRegistry = new Map();
        cleanup = [];
    });

    afterEach(() => {
        for (const dispose of cleanup.reverse()) dispose();
        (
            process as typeof process & {
                client?: boolean;
            }
        ).client = originalProcessClient;
    });

    it('preserves the exact inventory exposed by the live registries', () => {
        const { registerSidebarPage } = useSidebarPages();
        cleanup.push(
            registerSidebarPage({
                id: 'live-profile-page',
                label: 'Live profile page',
                icon: 'pixelarticons:layout',
                component: TestSurface,
            })
        );

        const dashboard: DashboardPlugin = {
            id: 'live-profile-dashboard',
            label: 'Live profile dashboard',
            icon: 'pixelarticons:dashboard',
        };
        const dashboardHandle = registerDashboardPlugin(dashboard);
        cleanup.push(() => {
            dashboardHandle.dispose();
        });

        const paneHandle = usePaneApps().registerPaneApp({
            id: 'live-profile-pane',
            label: 'Live profile pane',
            component: TestSurface,
        });
        cleanup.push(() => {
            paneHandle.dispose();
        });

        const commandHandle: RegistrationHandle = registerPaletteCommand(
            {
                id: 'live-profile-command',
                label: 'Live profile command',
            },
            () => ({ ok: true })
        );
        cleanup.push(() => {
            commandHandle.dispose();
        });

        const liveInventory = useWorkspaceProfiles().inventory.value;
        const resolved = resolveWorkspaceProfile(
            STANDARD_OR3_PROFILE,
            liveInventory,
            {
                maxDesktopPanes: 4,
                mobilePolicy: 'single-pane',
            }
        );

        expect(liveInventory.navigation.map(({ id }) => id)).toContain(
            'live-profile-page'
        );
        expect(liveInventory.dashboard.map(({ id }) => id)).toContain(
            'live-profile-dashboard'
        );
        expect(liveInventory.panes.map(({ id }) => id)).toContain(
            'live-profile-pane'
        );
        expect(liveInventory.commands.map(({ id }) => id)).toContain(
            'live-profile-command'
        );
        expect(resolved.navigation.items).toEqual(
            liveInventory.navigation.map(({ id }) => id)
        );
        expect(resolved.dashboard.items).toEqual(
            liveInventory.dashboard.map(({ id }) => id)
        );
        expect(resolved.commands.items).toEqual(
            liveInventory.commands.map(({ id }) => id)
        );
        expect(resolved.usedFallback).toBe(false);
    });
});

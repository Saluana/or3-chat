import { ref } from 'vue';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    __getRequestResolvedWorkspaceProfileRefForTests,
    hydrateWorkspaceProfilePayload,
    serializeWorkspaceProfileSelectionCookie,
    type WorkspaceProfileHydrationPayload,
} from '~/core/workspace-profiles';
import { shouldPreserveHydratedWorkspaceProfile } from '~/composables/workspace-profiles/useWorkspaceProfiles';

vi.mock('~/composables/useOr3Config', () => ({
    useOr3Config: () => ({
        ui: { maxPanes: 3 },
    }),
}));

vi.mock('~~/server/auth/session', () => ({
    resolveSessionContext: vi.fn(),
}));

type RequestApp = {
    payload: {
        data: {
            __or3WorkspaceProfile?: WorkspaceProfileHydrationPayload;
        };
    };
    ssrContext: {
        event: {
            node: {
                req: {
                    headers: {
                        cookie: string;
                    };
                };
            };
        };
    };
    $theme: {
        activeTheme: ReturnType<typeof ref<string>>;
        availableThemes: Array<{ name: string }>;
        getTheme(name: string): unknown;
        loadTheme(name: string): Promise<unknown>;
    };
};

type WorkspaceProfileServerPlugin = (app: RequestApp) => Promise<void>;

const installedThemeProfile = {
    schemaVersion: 1 as const,
    id: 'installed-theme-focus',
    label: 'Installed theme focus',
    navigation: {
        defaultPageId: 'sidebar-chats',
        order: ['sidebar-chats', 'sidebar-home'],
    },
    mobile: {
        bottomNavigation: ['sidebar-chats', 'sidebar-home'],
        defaultPageId: 'sidebar-chats',
    },
};

function selectionCookie(profileId: string): string {
    const value = encodeURIComponent(
        serializeWorkspaceProfileSelectionCookie(null, profileId)
    );
    return `or3_workspace_profile_v1=${value}`;
}

function createRequestApp(profileId: string): RequestApp {
    const themeDefinition = {
        workspaceProfiles: [installedThemeProfile],
        recommendedWorkspaceProfileId: installedThemeProfile.id,
    };
    return {
        payload: { data: {} },
        ssrContext: {
            event: {
                node: {
                    req: {
                        headers: {
                            cookie: selectionCookie(profileId),
                        },
                    },
                },
            },
        },
        $theme: {
            activeTheme: ref('installed-theme'),
            availableThemes: [{ name: 'installed-theme' }],
            getTheme: () => themeDefinition,
            loadTheme: async () => themeDefinition,
        },
    };
}

describe('workspace profile server plugin request bootstrap', () => {
    let serverPlugin: WorkspaceProfileServerPlugin;

    beforeAll(async () => {
        vi.stubGlobal(
            'defineNuxtPlugin',
            (plugin: WorkspaceProfileServerPlugin) => plugin
        );
        vi.stubGlobal('useRuntimeConfig', () => ({
            public: { ssrAuthEnabled: false },
        }));
        serverPlugin = (
            await import('~/plugins/93.workspace-profiles.server')
        ).default as unknown as WorkspaceProfileServerPlugin;
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('isolates built-in and installed-theme payloads through initial client resolution', async () => {
        const builtInRequest = createRequestApp('document-workspace');
        const installedThemeRequest = createRequestApp(
            installedThemeProfile.id
        );

        await Promise.all([
            serverPlugin(builtInRequest),
            serverPlugin(installedThemeRequest),
        ]);

        const builtInPayload =
            builtInRequest.payload.data.__or3WorkspaceProfile;
        const installedThemePayload =
            installedThemeRequest.payload.data.__or3WorkspaceProfile;
        expect(builtInPayload?.profile.id).toBe('document-workspace');
        expect(installedThemePayload?.profile.id).toBe(
            installedThemeProfile.id
        );

        const builtInServerProjection =
            __getRequestResolvedWorkspaceProfileRefForTests(
                builtInRequest
            ).value;
        const installedThemeServerProjection =
            __getRequestResolvedWorkspaceProfileRefForTests(
                installedThemeRequest
            ).value;
        expect(builtInServerProjection.id).toBe('document-workspace');
        expect(installedThemeServerProjection.id).toBe(
            installedThemeProfile.id
        );
        expect(builtInServerProjection).not.toBe(
            installedThemeServerProjection
        );

        const builtInInitialClientProjection =
            hydrateWorkspaceProfilePayload(
                JSON.parse(JSON.stringify(builtInPayload))
            );
        const installedThemeInitialClientProjection =
            hydrateWorkspaceProfilePayload(
                JSON.parse(JSON.stringify(installedThemePayload))
            );
        expect(builtInInitialClientProjection).toEqual(
            builtInServerProjection
        );
        expect(installedThemeInitialClientProjection).toEqual(
            installedThemeServerProjection
        );
        expect(installedThemeInitialClientProjection.usedFallback).toBe(false);
        expect(
            shouldPreserveHydratedWorkspaceProfile(
                installedThemeProfile.id,
                undefined,
                installedThemeInitialClientProjection
            )
        ).toBe(true);
    });
});

// app/plugins/snake-game.client.ts
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { usePaneApps } from '~/composables/core/usePaneApps';
import SnakeGamePane from './examples/snake/SnakeGamePane.vue';
import SnakeGameSidebar from './examples/snake/SnakeGameSidebar.vue';
import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

export default defineNuxtPlugin(() => {
    // Register Snake Game mini app

    // Register the pane app with post type for score tracking
    const { registerPaneApp } = usePaneApps();

    try {
        registerPaneApp({
            id: 'snake-game',
            label: 'Snake Game',
            component: SnakeGamePane,
            icon: 'pixelarticons:gamepad',
            postType: 'snake-game-score',
            createInitialRecord: async () => {
                // Create a new game session record
                const api = (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi;
                if (!api?.posts) {
                    return null;
                }

                const result = await api.posts.create({
                    postType: 'snake-game-score',
                    title: 'New Game',
                    content: '',
                    meta: {
                        score: 0,
                        startedAt: Date.now(),
                        status: 'in-progress',
                    },
                    source: 'snake-game-plugin',
                });

                if (!result.ok) {
                    return null;
                }

                return { id: result.id };
            },
        });
    } catch (e) {
        console.error('[snake-game] Failed to register pane app:', e);
    }

    // Register the sidebar page
    let cleanup: (() => void) | undefined;
    try {
        cleanup = registerSidebarPage({
            id: 'snake-game-page',
            label: 'Snake Game',
            component: SnakeGameSidebar,
            icon: 'pixelarticons:gamepad',
            order: 300,
            usesDefaultHeader: false,
        });
    } catch (e) {
        console.error('[snake-game] Failed to register sidebar page:', e);
    }

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            cleanup?.();
        });
    }

    // Snake Game mini app registered
});

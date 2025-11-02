// app/plugins/snake-game.client.ts
import { registerSidebarPage } from '~/composables/sidebar';
import { usePaneApps } from '~/composables/core/usePaneApps';
import SnakeGamePane from './snake/SnakeGamePane.vue';
import SnakeGameSidebar from './snake/SnakeGameSidebar.vue';

export default defineNuxtPlugin(() => {
    console.log('Registering Snake Game mini app...');

    // Register the pane app with post type for score tracking
    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: 'snake-game',
        label: 'Snake Game',
        component: SnakeGamePane,
        icon: 'pixelarticons:gamepad',
        postType: 'snake-game-score',
        createInitialRecord: async (ctx: { app: any }) => {
            // Create a new game session record
            const api = (globalThis as any).__or3PanePluginApi;
            if (!api?.posts) {
                console.warn('[snake-game] Posts API not available');
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
                console.error(
                    '[snake-game] Failed to create game record:',
                    result.message
                );
                return null;
            }

            return { id: result.id };
        },
    });

    // Register the sidebar page
    const cleanup = registerSidebarPage({
        id: 'snake-game-page',
        label: 'Snake Game',
        component: SnakeGameSidebar,
        icon: 'pixelarticons:gamepad',
        order: 300,
        usesDefaultHeader: false,
    });

    // HMR cleanup
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            console.log('Cleaning up Snake Game plugin...');
            cleanup();
        });
    }

    console.log('Snake Game mini app registered successfully!');
});

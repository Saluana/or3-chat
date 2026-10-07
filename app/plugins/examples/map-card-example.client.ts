import { defineNuxtPlugin } from '#app';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import { geocode } from './weather-card/forecast';
import MapCard from './map-card/MapCard.vue';
export const mapCard = vueCard(MapCard);
export function registerMapExample() {
    return registerCardTool<{ query: string }>({
        name: 'map_show',
        description: 'Show an interactive map of a place.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query']
        },
        handler: ({ query }, context) => geocode(query, context.abortSignal),
        card: mapCard,
        label: 'Map',
        chrome: 'none',
        minHeight: 320
    });
}
export default defineNuxtPlugin(() => {
    const handle = registerMapExample();
    const settings = registerDashboardPlugin({
        id: 'example:map-settings',
        icon: 'tabler:map',
        label: 'Map example',
        description: 'Optional Google Maps Embed key',
        pages: [
            {
                id: 'settings',
                title: 'Map settings',
                component: () => import('./map-card/MapSettings.vue')
            }
        ]
    });
    if (import.meta.hot)
        import.meta.hot.dispose(() => {
            handle.dispose();
            settings.dispose();
        });
});

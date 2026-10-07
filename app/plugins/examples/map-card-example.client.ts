import { defineNuxtPlugin } from '#app';
import { defineToolCard } from '@or3/plugin-sdk/cards';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import { getKvByName } from '~/db/kv';
import { geocode } from './weather-card/forecast';
export const mapCard = defineToolCard<
    { query: string },
    { latitude: number; longitude: number; place: string }
>({
    mount(el, card) {
        const point = card.result;
        if (!point) {
            el.textContent = 'Map unavailable';
            return;
        }
        const name = document.createElement('p');
        name.textContent = point.place;
        const frame = document.createElement('iframe');
        frame.title = 'Map of ' + point.place;
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        frame.style.cssText = 'width:100%;height:280px;border:0';
        const bbox = [
            point.longitude - 0.02,
            point.latitude - 0.02,
            point.longitude + 0.02,
            point.latitude + 0.02
        ].join(',');
        frame.src =
            'https://www.openstreetmap.org/export/embed.html?' +
            new URLSearchParams({
                bbox,
                layer: 'mapnik',
                marker: point.latitude + ',' + point.longitude
            });
        void getKvByName('example:map:google-embed-key')
            .then((setting) => {
                if (!setting?.value || card.signal.aborted) return;
                frame.referrerPolicy = 'strict-origin-when-cross-origin';
                frame.src =
                    'https://www.google.com/maps/embed/v1/place?' +
                    new URLSearchParams({
                        key: setting.value,
                        q: card.args?.query ?? point.place
                    });
            })
            .catch(() => {});
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'retro-btn px-3 py-2';
        button.textContent = 'Open in Maps';
        button.onclick = () => {
            void card.openLink(
                'https://www.openstreetmap.org/?mlat=' +
                    point.latitude +
                    '&mlon=' +
                    point.longitude +
                    '#map=14/' +
                    point.latitude +
                    '/' +
                    point.longitude
            );
        };
        el.replaceChildren(name, frame, button);
        return () => {
            frame.src = 'about:blank';
        };
    }
});
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

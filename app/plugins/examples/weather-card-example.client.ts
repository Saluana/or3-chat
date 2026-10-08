import { defineNuxtPlugin } from '#app';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import { registerCardTool } from '~/utils/chat/tool-cards-public';
import WeatherCard from './weather-card/WeatherCard.vue';
import { getForecast } from './weather-card/forecast';
export function registerWeatherExample() {
    return registerCardTool<{ location?: string }>({
        name: 'weather_show',
        description:
            'Show current weather and a seven day forecast. Omit location to ask for device location.',
        parameters: {
            type: 'object',
            properties: { location: { type: 'string' } }
        },
        handler: ({ location }, context) => getForecast(location, context.abortSignal),
        card: vueCard(WeatherCard),
        label: 'Weather',
        chrome: 'none',
        minHeight: 220
    });
}
export default defineNuxtPlugin(() => {
    const handle = registerWeatherExample();
    if (import.meta.hot) import.meta.hot.dispose(() => handle.dispose());
});

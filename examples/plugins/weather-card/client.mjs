import { createPortablePlugin, defineOr3Plugin } from '@or3/plugin-sdk';
import manifest from './or3.manifest.json';
const summary = (code) =>
    code === 0
        ? 'Clear sky'
        : code <= 3
          ? 'Partly cloudy'
          : code <= 48
            ? 'Fog'
            : code <= 67
              ? 'Rain'
              : code <= 86
                ? 'Snow or showers'
                : 'Thunderstorms';
export default createPortablePlugin(
    defineOr3Plugin({
        manifest,
        setup(context) {
            context.onRequest('runtime.tools', () => [
                {
                    type: 'function',
                    function: {
                        name: 'or3_weather_card_show',
                        description:
                            'Show weather for a city. Ask for the city before calling.',
                        parameters: {
                            type: 'object',
                            properties: { location: { type: 'string' } },
                            required: ['location']
                        }
                    }
                }
            ]);
            context.onRequest('runtime.tool', async ({ args }) => {
                const read = async (url) => {
                    const response = await context.http.request({
                        url,
                        method: 'GET'
                    });
                    if (!response.ok) throw new Error(response.error.message);
                    return JSON.parse(
                        typeof response.value.body === 'string'
                            ? response.value.body
                            : new TextDecoder().decode(response.value.body)
                    );
                };
                const places = await read(
                    'https://geocoding-api.open-meteo.com/v1/search?' +
                        new URLSearchParams({
                            name: args.location,
                            count: '1',
                            format: 'json'
                        })
                );
                const place = places.results?.[0];
                if (!place) return { note: 'Ask for a more specific city.' };
                const data = await read(
                    'https://api.open-meteo.com/v1/forecast?' +
                        new URLSearchParams({
                            latitude: String(place.latitude),
                            longitude: String(place.longitude),
                            current: 'temperature_2m,weather_code,is_day',
                            hourly: 'temperature_2m',
                            daily: 'weather_code,temperature_2m_max,temperature_2m_min',
                            timezone: 'auto',
                            forecast_days: '7'
                        })
                );
                const start = Math.max(
                    0,
                    data.hourly.time.findIndex((time) => time >= data.current.time)
                );
                return {
                    place: place.name,
                    isDay: data.current.is_day === 1,
                    current: {
                        temperature: data.current.temperature_2m,
                        summary: summary(data.current.weather_code)
                    },
                    hourly: data.hourly.time
                        .slice(start, start + 12)
                        .map((time, i) => ({
                            time,
                            temperature: data.hourly.temperature_2m[start + i]
                        })),
                    daily: data.daily.time.slice(0, 7).map((date, i) => ({
                        date,
                        low: data.daily.temperature_2m_min[i],
                        high: data.daily.temperature_2m_max[i],
                        summary: summary(data.daily.weather_code[i])
                    }))
                };
            });
        }
    })
);

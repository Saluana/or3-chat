export interface Forecast {
    place: string;
    isDay: boolean;
    current: { temperature: number; summary: string };
    hourly: { time: string; temperature: number }[];
    daily: { date: string; low: number; high: number; summary: string }[];
    note?: string;
}
export function weatherSummary(code: number) {
    return code === 0
        ? 'Clear sky'
        : code <= 3
          ? 'Partly cloudy'
          : code <= 48
            ? 'Fog'
            : code <= 67
              ? 'Rain'
              : code <= 77
                ? 'Snow'
                : code <= 82
                  ? 'Rain showers'
                  : code <= 86
                    ? 'Snow showers'
                    : 'Thunderstorms';
}
export async function geocode(location: string, signal?: AbortSignal) {
    const response = await fetch(
        'https://geocoding-api.open-meteo.com/v1/search?' +
            new URLSearchParams({
                name: location,
                count: '1',
                language: 'en',
                format: 'json'
            }),
        { signal }
    );
    if (!response.ok) throw new Error('Location search is unavailable');
    const body = await response.json();
    const place = body.results?.[0];
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude))
        throw new Error('Ask for a more specific city');
    return {
        latitude: place.latitude as number,
        longitude: place.longitude as number,
        place: [place.name, place.country].filter(Boolean).join(', ')
    };
}
export async function getForecast(
    location?: string,
    signal?: AbortSignal
): Promise<Forecast | { note: string }> {
    let point: { latitude: number; longitude: number; place: string };
    if (location?.trim()) point = await geocode(location, signal);
    else {
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 6000,
                    maximumAge: 300000
                })
            );
            point = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                place: 'Your location'
            };
        } catch {
            return {
                note: 'Location access was unavailable. Ask the user for a city.'
            };
        }
    }
    const query = new URLSearchParams({
        latitude: String(point.latitude),
        longitude: String(point.longitude),
        current: 'temperature_2m,weather_code,is_day',
        hourly: 'temperature_2m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min',
        timezone: 'auto',
        forecast_days: '7'
    });
    const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, {
        signal
    });
    if (!response.ok) throw new Error('Forecast is unavailable');
    const body = await response.json();
    const start = Math.max(
        0,
        (body.hourly?.time ?? []).findIndex((time: string) => time >= body.current.time)
    );
    return {
        place: point.place,
        isDay: body.current.is_day === 1,
        current: {
            temperature: body.current.temperature_2m,
            summary: weatherSummary(body.current.weather_code)
        },
        hourly: (body.hourly.time as string[])
            .slice(start, start + 12)
            .map((time, index) => ({
                time,
                temperature: body.hourly.temperature_2m[start + index]
            })),
        daily: (body.daily.time as string[]).slice(0, 7).map((date, index) => ({
            date,
            low: body.daily.temperature_2m_min[index],
            high: body.daily.temperature_2m_max[index],
            summary: weatherSummary(body.daily.weather_code[index])
        }))
    };
}

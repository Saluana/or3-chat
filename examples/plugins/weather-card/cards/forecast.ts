export interface Forecast {
    place: string;
    isDay: boolean;
    current: { temperature: number; summary: string };
    hourly: { time: string; temperature: number }[];
    daily: { date: string; low: number; high: number; summary: string }[];
    note?: string;
}

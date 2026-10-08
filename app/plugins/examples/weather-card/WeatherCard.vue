<script setup lang="ts">
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import type { Forecast } from './forecast';
defineProps<{ card: ToolCardContext<{ location?: string }, Forecast> }>();
</script>
<template>
    <section
        class="weather-card"
        :data-daytime="card.result?.isDay !== false"
        :data-mode="card.theme.mode"
    >
        <template v-if="card.result?.current">
            <p class="weather-place">{{ card.result.place }}</p>
            <p class="weather-temp">
                {{ Math.round(card.result.current.temperature) }}°
            </p>
            <p>{{ card.result.current.summary }}</p>
            <div class="weather-hours" aria-label="Hourly forecast">
                <div v-for="hour in card.result.hourly" :key="hour.time">
                    <span>{{ hour.time.slice(11, 16) }}</span
                    ><strong>{{ Math.round(hour.temperature) }}°</strong>
                </div>
            </div>
            <ol class="weather-days" aria-label="Seven day forecast">
                <li v-for="day in card.result.daily" :key="day.date">
                    <time>{{ day.date }}</time
                    ><span>{{ day.summary }}</span
                    ><strong
                        >{{ Math.round(day.low) }}° /
                        {{ Math.round(day.high) }}°</strong
                    >
                </li>
            </ol>
            <small>Weather data by Open-Meteo</small>
        </template>
        <p v-else>{{ card.result?.note || 'Preparing forecast…' }}</p>
    </section>
</template>
<style scoped>
.weather-card {
    padding: 20px;
    border-radius: var(--md-border-radius, 16px);
    background: linear-gradient(135deg, #234c76, #517898);
    color: #fff;
    font-family: var(--font-sans, sans-serif);
}
.weather-card[data-daytime='false'] {
    background: linear-gradient(135deg, #111c3a, #344163);
}
.weather-card p {
    margin: 8px 0;
}
.weather-card strong {
    color: inherit;
}
.weather-place {
    font-size: 1.15rem;
    font-weight: 600;
}
.weather-temp {
    font-size: 3.5rem;
    line-height: 1.2;
}
.weather-hours {
    display: flex;
    overflow-x: auto;
    gap: 16px;
    font-size: 0.875rem;
    padding: 16px 0;
}
.weather-hours div {
    flex: 0 0 auto;
    min-width: 44px;
    white-space: nowrap;
    display: grid;
    gap: 8px;
}
.weather-days {
    list-style: none;
    padding: 0;
}
.weather-days li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
    border-top: 1px solid #ffffff30;
    padding: 8px 0;
    font-size: 0.8rem;
}
small {
    opacity: 0.85;
}
</style>

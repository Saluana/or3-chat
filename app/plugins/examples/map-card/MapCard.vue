<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import { getKvByName } from '~/db/kv';

const props = defineProps<{
    card: ToolCardContext<
        { query: string },
        { latitude: number; longitude: number; place: string }
    >;
}>();
const googleKey = ref('');
const feedback = ref('');
const opening = ref(false);
onMounted(async () => {
    try {
        const setting = await getKvByName('example:map:google-embed-key');
        if (!props.card.signal.aborted && typeof setting?.value === 'string')
            googleKey.value = setting.value;
    } catch {
        // The default map remains available without an optional Google key.
    }
});
const embedUrl = computed(() => {
    const point = props.card.result;
    if (!point) return undefined;
    if (googleKey.value)
        return 'https://www.google.com/maps/embed/v1/place?' + new URLSearchParams({
            key: googleKey.value,
            q: props.card.args?.query ?? point.place,
        });
    return 'https://www.openstreetmap.org/export/embed.html?' + new URLSearchParams({
        bbox: [point.longitude - 0.02, point.latitude - 0.02,
            point.longitude + 0.02, point.latitude + 0.02].join(','),
        layer: 'mapnik',
        marker: point.latitude + ',' + point.longitude,
    });
});
async function openMap() {
    const point = props.card.result;
    if (!point || opening.value) return;
    opening.value = true;
    feedback.value = '';
    try {
        const result = await props.card.openLink(
            'https://www.openstreetmap.org/?' + new URLSearchParams({
                mlat: String(point.latitude),
                mlon: String(point.longitude),
            }) + '#map=14/' + point.latitude + '/' + point.longitude
        );
        if (!props.card.signal.aborted && !result.ok)
            feedback.value = result.error.message;
    } finally {
        opening.value = false;
    }
}
</script>

<template>
    <UCard
        class="overflow-hidden border border-[color:var(--md-border-color)] bg-[var(--md-surface)] text-[var(--md-on-surface)] theme-shadow"
        :ui="{ header: 'px-5 py-4', body: 'p-0! sm:p-0!', footer: 'px-5 py-4' }"
    >
        <template #header>
            <div class="flex items-center gap-3">
                <UIcon name="i-tabler-map-pin" aria-hidden="true" class="size-6 shrink-0 text-[var(--md-primary)]" />
                <div class="min-w-0">
                    <p class="m-0! text-xs font-semibold uppercase tracking-widest opacity-60">Map</p>
                    <p class="m-0! mt-1! break-words text-base font-semibold">{{ card.result?.place ?? 'Map unavailable' }}</p>
                </div>
            </div>
        </template>
        <iframe
            v-if="embedUrl"
            :src="embedUrl"
            :title="'Map of ' + card.result?.place"
            :referrerpolicy="googleKey ? 'strict-origin-when-cross-origin' : 'no-referrer'"
            loading="lazy"
            class="block h-[300px] w-full border-0"
        />
        <p v-else class="m-0! p-5">Map unavailable.</p>
        <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="text-sm opacity-65">Explore the area</span>
                <UButton
                    variant="solid"
                    color="primary"
                    size="touch"
                    class="gap-2!"
                    trailing-icon="i-tabler-external-link"
                    :disabled="!card.result || opening"
                    aria-label="Open in Maps"
                    @click="openMap"
                >Open in Maps</UButton>
            </div>
            <p v-if="feedback" role="alert" class="m-0! mt-3! text-sm text-[var(--md-error)]">{{ feedback }}</p>
        </template>
    </UCard>
</template>

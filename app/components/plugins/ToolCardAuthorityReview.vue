<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ dependencies?: readonly string[] }>();
const cards = computed(() =>
    (props.dependencies ?? []).flatMap((entry) => {
        if (!entry.startsWith('tool-card:')) return [];
        try {
            const card: unknown = JSON.parse(entry.slice(10));
            if (!card || typeof card !== 'object') return [];
            const value = card as Record<string, unknown>;
            return typeof value.id === 'string' &&
                typeof value.tool === 'string' &&
                typeof value.label === 'string'
                ? [{ id: value.id, tool: value.tool, label: value.label }]
                : [];
        } catch {
            return [];
        }
    })
);
const embeds = computed(() =>
    (props.dependencies ?? [])
        .filter(
            (entry) =>
                entry.startsWith('tool-card-frame:') ||
                entry.startsWith('tool-card-image:')
        )
        .map((entry) => ({
            kind: entry.startsWith('tool-card-frame:') ? 'Frame' : 'Image',
            origin: entry.slice(entry.indexOf(':', entry.indexOf(':') + 1) + 1)
        }))
);
</script>
<template>
    <div v-if="cards.length" class="space-y-2 text-sm">
        <p class="font-medium">Interactive tool cards</p>
        <ul class="list-disc ml-4">
            <li v-for="card in cards" :key="card.id">
                {{ card.label }} · <code>{{ card.tool }}</code>
            </li>
            <li v-for="embed in embeds" :key="embed.kind + embed.origin">
                {{ embed.kind }} content from {{ embed.origin }}
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getProviderInfo } from '~/utils/modelCatalog';

/**
 * Renders a provider brand logo (simple-icons glyph) or, when no brand glyph
 * exists, a monogram tile with the provider's brand color.
 *
 * Monochrome brands (color === null) follow theme text color so dark logos
 * stay visible in dark mode.
 */
const props = withDefaults(
    defineProps<{
        /** OpenRouter provider slug, e.g. "anthropic". */
        slug: string;
        /** Box size in px. */
        size?: number;
        /** Force a rounded tile background (used in the detail header). */
        tile?: boolean;
    }>(),
    { size: 20, tile: false }
);

const info = computed(() => getProviderInfo(props.slug));

const iconName = computed(() =>
    info.value.icon ? `simple-icons:${info.value.icon}` : undefined
);

const showTile = computed(() => props.tile || !iconName.value);

const tileStyle = computed(() => {
    const style: Record<string, string> = {
        width: `${props.size}px`,
        height: `${props.size}px`,
        borderRadius: `${Math.max(3, Math.round(props.size * 0.22))}px`,
    };
    if (showTile.value) {
        const c = info.value.color;
        if (c) {
            style.backgroundColor = `${c}1a`; // brand color at ~10% alpha
            style.color = c;
        } else {
            style.backgroundColor = 'var(--md-surface-container-high)';
            style.color = 'var(--md-on-surface)';
        }
    } else if (info.value.color) {
        style.color = info.value.color;
    }
    return style;
});

const glyphSize = computed(() =>
    showTile.value ? Math.round(props.size * 0.58) : props.size
);

const monogram = computed(
    () => info.value.monogram ?? info.value.name.charAt(0).toUpperCase()
);

const monogramFont = computed(() =>
    Math.max(
        7,
        Math.round(props.size * (monogram.value.length > 1 ? 0.28 : 0.4))
    )
);
</script>

<template>
    <span
        class="inline-flex items-center justify-center shrink-0 select-none"
        :style="tileStyle"
        role="img"
        :aria-label="info.name"
        :title="info.name"
    >
        <UIcon
            v-if="iconName"
            :name="iconName"
            :style="{ width: `${glyphSize}px`, height: `${glyphSize}px` }"
        />
        <span
            v-else
            class="font-semibold leading-none tracking-tight"
            :style="{ fontSize: `${monogramFont}px` }"
            >{{ monogram }}</span
        >
    </span>
</template>

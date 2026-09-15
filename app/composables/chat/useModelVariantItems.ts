import { computed, type ComputedRef } from 'vue';
import { useIcon } from '~/composables/useIcon';
import {
    MODEL_VARIANT_OPTIONS,
    type OpenRouterModelVariant,
} from '~~/shared/openrouter/model-variants';

export interface ModelVariantItem {
    value: OpenRouterModelVariant;
    label: string;
    description: string;
    /** Theme-resolved icon name for the leading slot / menu item. */
    icon: string;
}

/**
 * Variant picker items with theme-aware icons.
 *
 * Icon refs are dereferenced inside the computed so a theme switch while
 * mounted updates the icons, and both variant pickers share one mapping.
 */
export function useModelVariantItems(): ComputedRef<ModelVariantItem[]> {
    const icons: Record<OpenRouterModelVariant, ReturnType<typeof useIcon>> = {
        off: useIcon('chat.variant.off'),
        online: useIcon('chat.variant.online'),
        nitro: useIcon('chat.variant.nitro'),
        floor: useIcon('chat.variant.floor'),
    };
    return computed(() =>
        MODEL_VARIANT_OPTIONS.map((option) => ({
            ...option,
            icon: icons[option.value].value,
        }))
    );
}

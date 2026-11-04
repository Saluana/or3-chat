import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { useIcon } from '~/composables/useIcon';
import { OPENROUTER_OPTION_DESCRIPTORS } from '~~/shared/openrouter/model-variants';
import type { ModelOptionDescriptor } from '~~/shared/ai/types';

export interface ModelVariantItem {
    value: string;
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
export function useModelVariantItems(options: MaybeRefOrGetter<readonly ModelOptionDescriptor[]> = OPENROUTER_OPTION_DESCRIPTORS): ComputedRef<ModelVariantItem[]> {
    const icons = {
        off: useIcon('chat.variant.off'),
        online: useIcon('chat.variant.online'),
        nitro: useIcon('chat.variant.nitro'),
        floor: useIcon('chat.variant.floor'),
    };
    const namedIcons: Partial<Record<string, ReturnType<typeof useIcon>>> = icons;
    return computed(() => toValue(options).map(({ value, label, description, kind }) => {
        const fallback = kind === 'search' ? icons.online : kind === 'routing' ? icons.nitro : icons.off;
        const namedIcon = Object.hasOwn(namedIcons, value) ? namedIcons[value] : undefined;
        return { value, label, description, icon: (namedIcon ?? fallback).value };
    }));
}

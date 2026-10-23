import { describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { useResolvedName } from '@nuxt/icon/runtime/components/shared.js';

const icon = reactive({
    cssSelectorPrefix: 'i-',
    collections: ['lucide', 'custom', 'custom-long'],
    aliases: { folder: 'custom-long-folder' } as Record<string, string>,
});
vi.mock('#imports', () => ({ useAppConfig: () => ({ icon }) }));

describe('installed Nuxt icon resolution', () => {
    it('resolves the longest collection prefix without mutating shared application config', () => {
        const originalOrder = [...icon.collections];
        const name = ref('i-folder');
        const resolved = useResolvedName(() => name.value);
        expect(resolved.value).toBe('custom-long:folder');
        // Every virtual-row mount resolves icons. That must be a read operation,
        // even when collection order is not already sorted by name length.
        expect(icon.collections).toEqual(originalOrder);

        name.value = 'i-lucide-pin';
        expect(resolved.value).toBe('lucide:pin');
        name.value = 'custom:explicit-name';
        expect(resolved.value).toBe('custom:explicit-name');
        name.value = 'unregistered-name';
        expect(resolved.value).toBe('unregistered-name');

        name.value = 'folder';
        icon.aliases.folder = 'lucide:folder-open';
        expect(resolved.value).toBe('lucide:folder-open');
        name.value = 'i-custom-long-more-star';
        icon.collections.push('custom-long-more');
        expect(resolved.value).toBe('custom-long-more:star');
        expect(icon.collections).toEqual([...originalOrder, 'custom-long-more']);
    });
});

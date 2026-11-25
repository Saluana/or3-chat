import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeImagePicker from '../ThemeImagePicker.vue';

const mocks = vi.hoisted(() => ({ listBackgroundImages: vi.fn() }));

vi.mock('~/core/theme/background-image-library', () => ({
    listBackgroundImages: mocks.listBackgroundImages,
}));

const image = (hash: string, name: string) => ({ hash, name, size_bytes: 2 * 1024 * 1024 });

function mountPicker(props: Partial<{ open: boolean; currentHash: string | null }> = {}) {
    return mount(ThemeImagePicker, {
        props: { open: true, areaLabel: 'Sidebar Background', currentHash: null, ...props },
        global: {
            stubs: {
                AppModal: {
                    props: ['open', 'title'],
                    template: '<div v-if="open" role="dialog" :aria-label="title"><slot /><footer><slot name="footer" /></footer></div>',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                UButton: {
                    props: ['label', 'disabled'],
                    template: '<button type="button" :disabled="disabled">{{ label }}</button>',
                },
                UIcon: true,
                PaletteImageThumb: true,
            },
        },
    });
}

beforeEach(() => {
    mocks.listBackgroundImages.mockReset();
    mocks.listBackgroundImages.mockResolvedValue({
        items: [image('sha256:a', 'sunset.png'), image('sha256:b', 'mountains.png')],
        hasMore: false,
    });
});

describe('ThemeImagePicker', () => {
    it('names the area, lists workspace images, and preselects the one in use', async () => {
        const wrapper = mountPicker({ currentHash: 'sha256:b' });
        await flushPromises();
        expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Choose image for Sidebar Background');
        expect(mocks.listBackgroundImages).toHaveBeenCalledWith({ limit: 24, query: '' });
        const tiles = wrapper.findAll('[aria-pressed]');
        expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual(['sunset.png', 'mountains.png']);
        expect(tiles[1]!.attributes('aria-pressed')).toBe('true');
        expect(tiles[1]!.text()).toContain('In use');
        expect(wrapper.text()).toContain('mountains.png · 2.0 MB');
    });

    it('applies the selected image and closes', async () => {
        const wrapper = mountPicker();
        await flushPromises();
        const use = wrapper.findAll('button').find((button) => button.text() === 'Use image')!;
        expect(use.attributes('disabled')).toBeDefined();
        await wrapper.get('[aria-label="sunset.png"]').trigger('click');
        expect(use.attributes('disabled')).toBeUndefined();
        await use.trigger('click');
        expect(wrapper.emitted('select')).toEqual([['sha256:a']]);
        expect(wrapper.emitted('update:open')).toEqual([[false]]);
    });

    it('searches by name after typing stops and shows an empty state', async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mountPicker();
            await flushPromises();
            mocks.listBackgroundImages.mockResolvedValue({ items: [], hasMore: false });
            await wrapper.get('input:not([type="file"])').setValue('beach');
            expect(mocks.listBackgroundImages).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(200);
            await flushPromises();
            expect(mocks.listBackgroundImages).toHaveBeenLastCalledWith({ limit: 24, query: 'beach' });
            expect(wrapper.text()).toContain('No images match “beach”.');
        } finally {
            vi.useRealTimers();
        }
    });

    it('hands a new upload to the editor and closes', async () => {
        const wrapper = mountPicker();
        await flushPromises();
        const input = wrapper.get('input[type="file"]');
        const file = new File(['x'], 'new.png', { type: 'image/png' });
        Object.defineProperty(input.element, 'files', { value: [file] });
        await input.trigger('change');
        expect(wrapper.emitted('upload')).toEqual([[file]]);
        expect(wrapper.emitted('update:open')).toEqual([[false]]);
    });
});

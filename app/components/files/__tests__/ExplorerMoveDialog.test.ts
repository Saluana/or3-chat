import { afterEach, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ExplorerMoveDialog from '../ExplorerMoveDialog.vue';

const Button = defineComponent({
    props: ['label'],
    template: '<button><slot />{{ label }}</button>',
});
const Input = defineComponent({
    props: ['modelValue', 'size'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());

// Creating a folder survives closing the dialog; its completion belongs to that
// opening, never a subsequent selection or a new in-progress create operation.
it.each(['success', 'failure'] as const)('ignores a previous opening\'s folder %s', async result => {
    let resolve!: (id: string) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
    wrapper = mount(ExplorerMoveDialog, {
        props: { modelValue: true, label: 'Files', folders: [], busy: false, createFolder: () => pending },
        global: { stubs: {
            AppModal: { template: '<div><slot /><slot name="footer" /></div>' },
            UButton: Button, UInput: Input, UAlert: { props: ['description'], template: '<p role="alert">{{ description }}</p>' },
        } },
    });
    await wrapper.get('button').trigger('click');
    await wrapper.get('input[aria-label="Folder name"]').setValue('Old folder');
    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    if (result === 'success') resolve('old-folder');
    else reject(new Error('Old create failed'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    const buttons = wrapper.findAll('button');
    await buttons[buttons.length - 1]!.trigger('click');
    expect(wrapper.emitted('move')).toEqual([[null]]);
});

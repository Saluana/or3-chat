import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PortableUiTree from '../PortableUiTree.vue';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';

const stubs = {
    UInput: {
        props: ['modelValue', 'id', 'placeholder', 'required'],
        emits: ['update:modelValue'],
        template:
            '<input :id="id" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UTextarea: {
        props: ['modelValue', 'id', 'rows', 'required'],
        emits: ['update:modelValue'],
        template: '<textarea :id="id" :value="modelValue" />',
    },
    USelectMenu: {
        props: ['modelValue', 'id', 'items', 'ariaLabel'],
        emits: ['update:modelValue'],
        template: '<select :id="id" :aria-label="ariaLabel" />',
    },
    UCheckbox: {
        props: ['modelValue', 'id', 'label'],
        emits: ['update:modelValue'],
        template: '<label><input type="checkbox" :id="id" :aria-label="label" /></label>',
    },
    UProgress: {
        props: ['modelValue', 'max'],
        template: '<div role="progressbar" :aria-valuenow="modelValue" :aria-valuemax="max" />',
    },
    UButton: {
        props: ['color', 'variant', 'size', 'disabled'],
        emits: ['click'],
        template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
};

function mountTree(nodes: readonly PortableUiNode[]) {
    return mount(PortableUiTree, { props: { nodes }, global: { stubs } });
}

describe('PortableUiTree host renderer (4.5)', () => {
    it('renders text, markdown, tables, lists and progress with host components', () => {
        const wrapper = mountTree([
            { type: 'text', text: 'plain text' },
            { type: 'markdown', markdown: '**bold** <script>alert(1)</script>' },
            {
                type: 'table',
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: 'cell' }],
                caption: 'caption',
            },
            { type: 'list', items: [{ label: 'one' }], ordered: true },
            { type: 'progress', value: 5, max: 10, label: 'Working' },
        ]);

        expect(wrapper.text()).toContain('plain text');
        expect(wrapper.find('.or3-plugin-markdown').html()).toContain('<strong>bold</strong>');
        expect(wrapper.find('.or3-plugin-markdown').html()).not.toContain('<script');
        expect(wrapper.find('table').text()).toContain('cell');
        expect(wrapper.find('ol').text()).toContain('one');
        expect(wrapper.find('[role="progressbar"]').attributes('aria-valuemax')).toBe('10');
    });

    it('labels every field for keyboard and screen-reader use', () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [
                    { type: 'field.text', id: 'name', label: 'Name' },
                    { type: 'field.toggle', id: 'enabled', label: 'Enabled' },
                    { type: 'button', id: 'save', label: 'Save', action: 'save' },
                ],
            },
        ]);

        const label = wrapper.find('label[for="portable-name"]');
        expect(label.text()).toBe('Name');
        expect(wrapper.find('input#portable-name').exists()).toBe(true);
        expect(
            wrapper.find('input#portable-enabled').attributes('aria-label')
        ).toBe('Enabled');
        expect(wrapper.find('form').attributes('aria-label')).toBe('settings');
    });

    it('submits form values as a host-mediated event with no plugin closure', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [
                    { type: 'field.text', id: 'name', label: 'Name', value: 'start' },
                    { type: 'button', id: 'save', label: 'Save', action: 'save' },
                ],
            },
        ]);

        await wrapper.find('input#portable-name').setValue('changed');
        await wrapper.find('button').trigger('click');

        const events = wrapper.emitted('ui-event');
        expect(events).toBeTruthy();
        expect(events?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'submit',
            formId: 'settings',
            values: { name: 'changed' },
        });
    });

    it('raises open-document and open-pane as host events', async () => {
        const wrapper = mountTree([
            { type: 'open-document', label: 'Open document', documentId: 'doc_9' },
            { type: 'open-pane', label: 'Open pane', paneId: 'pane_9' },
        ]);

        const buttons = wrapper.findAll('button');
        await buttons[0]!.trigger('click');
        await buttons[1]!.trigger('click');

        const events = wrapper.emitted('ui-event');
        expect(events?.[0]?.[0]).toEqual({ kind: 'open-document', documentId: 'doc_9' });
        expect(events?.[1]?.[0]).toEqual({ kind: 'open-pane', paneId: 'pane_9' });
    });

    it('marks a destructive action and honours a disabled button', () => {
        const wrapper = mountTree([
            { type: 'button', id: 'delete', label: 'Delete', action: 'delete', variant: 'danger' },
            { type: 'button', id: 'busy', label: 'Busy', action: 'busy', disabled: true },
        ]);
        const buttons = wrapper.findAll('button');
        expect(buttons[0]!.attributes('disabled')).toBeUndefined();
        expect(buttons[1]!.attributes('disabled')).toBeDefined();
    });
});

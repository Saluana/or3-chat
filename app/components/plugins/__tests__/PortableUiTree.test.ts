import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import PortableUiTree from '../PortableUiTree.vue';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';

const resize = vi.hoisted(() => ({ callback: undefined as undefined | ((entries: { contentRect: { width: number } }[]) => void) }));
vi.mock('@vueuse/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@vueuse/core')>(),
    useResizeObserver: (_target: unknown, callback: typeof resize.callback) => { resize.callback = callback; },
}));

const stubs = {
    USlideover: {
        props: ['open'],
        emits: ['update:open'],
        template: '<div v-if="open" role="dialog"><slot name="content" /><button aria-label="Dismiss drawer" @click="$emit(\'update:open\', false)" /></div>',
    },
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
        template:
            '<select :id="id" :aria-label="ariaLabel" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
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
        template:
            '<button :type="$attrs.type ?? \'button\'" :data-action="$attrs[\'data-action\']" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
};

function mountTree(nodes: readonly PortableUiNode[]) {
    return mount(PortableUiTree, { props: { nodes }, global: { stubs } });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('PortableUiTree host renderer (4.5)', () => {
    it('moves the inspector into a dismissible drawer without losing edits on resize', async () => {
        const wrapper = mountTree([{ type: 'columns', layout: 'workspace', children: [
            { type: 'column', children: [{ type: 'text', text: 'Task list' }] },
            { type: 'column', children: [{ type: 'field.text', id: 'title', label: 'Title', value: 'Saved title' }] },
        ] }]);
        await wrapper.get('#portable-title').setValue('Unsaved edit');
        resize.callback?.([{ contentRect: { width: 390 } }]);
        await nextTick();
        expect(wrapper.find('aside').exists()).toBe(false);
        expect(wrapper.get('[role="dialog"] input').element).toHaveProperty('value', 'Unsaved edit');
        await wrapper.setProps({ nodes: [{ type: 'text', text: 'Confirm deletion' }, ...wrapper.props('nodes')] });
        expect(wrapper.get('[role="dialog"]').text()).toContain('Confirm deletion');
        await wrapper.get('[aria-label="Dismiss drawer"]').trigger('click');
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Open details');
        await wrapper.setProps({ nodes: [{ type: 'text', text: 'Saved' }, ...wrapper.props('nodes')] });
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
        resize.callback?.([{ contentRect: { width: 1000 } }]);
        await nextTick();
        expect(wrapper.get('aside input').element).toHaveProperty('value', 'Unsaved edit');
        wrapper.unmount();
    });
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
                    { type: 'button', id: 'save', label: 'Save', action: 'submit' },
                ],
            },
        ]);

        await wrapper.find('input#portable-name').setValue('changed');
        await wrapper.find('form').trigger('submit');

        const events = wrapper.emitted('ui-event');
        expect(events).toBeTruthy();
        expect(events?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'submit',
            formId: 'settings',
            values: { name: 'changed' },
        });
    });

    it('keeps the declared action of a form button instead of rewriting it to submit', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [
                    { type: 'field.text', id: 'name', label: 'Name', value: 'start' },
                    { type: 'button', id: 'save', label: 'Save', action: 'save' },
                    { type: 'button', id: 'cancel', label: 'Cancel', action: 'cancel' },
                    { type: 'button', id: 'delete', label: 'Delete', action: 'delete' },
                ],
            },
        ]);

        await wrapper.find('input#portable-name').setValue('changed');
        const buttons = wrapper.findAll('button');
        // Only the declaring `submit` button is a submitter; nothing here submits.
        expect(buttons[0]!.attributes('type')).toBe('button');
        await buttons[1]!.trigger('click');
        await buttons[2]!.trigger('click');

        const events = wrapper.emitted('ui-event');
        expect(events?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'cancel',
            values: { name: 'changed' },
        });
        expect(events?.[1]?.[0]).toMatchObject({
            kind: 'action',
            action: 'delete',
            values: { name: 'changed' },
        });
    });

    it('submits through the form, carrying the declaring submit action and values', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [
                    { type: 'field.text', id: 'name', label: 'Name', value: 'start' },
                    { type: 'button', id: 'save', label: 'Save', action: 'submit' },
                ],
            },
        ]);

        await wrapper.find('input#portable-name').setValue('changed');
        await wrapper.find('form').trigger('submit');

        expect(wrapper.emitted('ui-event')?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'submit',
            formId: 'settings',
            values: { name: 'changed' },
        });
    });

    it('keeps a named form action when the button opts into native submit', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'quick-add',
                children: [
                    { type: 'field.text', id: 'title', label: 'Title', value: '' },
                    {
                        type: 'button',
                        id: 'add',
                        label: 'Add task',
                        action: 'tasks.quick-add',
                        submit: true,
                    },
                ],
            },
        ]);

        await wrapper.find('input#portable-title').setValue('Keyboard task');
        await wrapper.find('form').trigger('submit', {
            submitter: wrapper.find('button').element,
        });
        expect(wrapper.emitted('ui-event')?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'tasks.quick-add',
            formId: 'quick-add',
            values: { title: 'Keyboard task' },
        });
    });

    it('debounces a declared text-field action with the current form values', async () => {
        vi.useFakeTimers();
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'search',
                layout: 'inline',
                children: [
                    {
                        type: 'field.text',
                        id: 'query',
                        label: '',
                        value: '',
                        search: true,
                        onChange: 'tasks.search',
                    },
                ],
            },
        ]);

        await wrapper.find('input#portable-query').setValue('design');
        await vi.advanceTimersByTimeAsync(199);
        expect(wrapper.emitted('ui-event')).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1);
        expect(wrapper.emitted('ui-event')?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'tasks.search',
            values: { query: 'design' },
        });
    });

    it('raises a declared select action immediately with the current values', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'toolbar',
                children: [
                    {
                        type: 'field.select',
                        id: 'filter',
                        label: 'Filter',
                        value: 'all',
                        options: [
                            { value: 'all', label: 'All tasks' },
                            { value: 'open', label: 'Open tasks' },
                        ],
                        onChange: 'tasks.toolbar',
                    },
                ],
            },
        ]);

        await wrapper.find('select#portable-filter').setValue('open');
        expect(wrapper.emitted('ui-event')?.[0]?.[0]).toMatchObject({
            kind: 'action',
            action: 'tasks.toolbar',
            values: { filter: 'open' },
        });
    });

    it('preserves typed values across declarative node updates (review 12)', async () => {
        const base = {
            type: 'form' as const,
            id: 'settings',
            children: [
                { type: 'field.text' as const, id: 'name', label: 'Name', value: 'start' },
                { type: 'progress' as const, value: 1, max: 10 },
            ],
        };
        const wrapper = mountTree([base]);
        await wrapper.find('input#portable-name').setValue('typed');

        // A progress update replaces the nodes array with an unrelated change.
        await wrapper.setProps({
            nodes: [
                {
                    ...base,
                    children: [
                        base.children[0]!,
                        { type: 'progress' as const, value: 7, max: 10 },
                    ],
                },
            ],
        });
        expect((wrapper.find('input#portable-name').element as HTMLInputElement).value).toBe(
            'typed'
        );

        // An untouched field still follows the plugin's declarative value.
        await wrapper.setProps({
            nodes: [
                {
                    ...base,
                    children: [
                        { type: 'field.text' as const, id: 'name', label: 'Name', value: 'from-plugin' },
                        { type: 'progress' as const, value: 8, max: 10 },
                    ],
                },
            ],
        });
        expect((wrapper.find('input#portable-name').element as HTMLInputElement).value).toBe(
            'typed'
        );

        // Explicit replacement is a host decision and wins.
        (wrapper.vm as unknown as { replaceValues: (next: Record<string, string>) => void })
            .replaceValues({ name: 'replaced' });
        await wrapper.vm.$nextTick();
        expect((wrapper.find('input#portable-name').element as HTMLInputElement).value).toBe(
            'replaced'
        );
    });

    it('replaces only the named fields, ignores unknown ids and preserves other edits', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [
                    { type: 'field.text', id: 'a', label: 'A', value: 'a0' },
                    { type: 'field.text', id: 'b', label: 'B', value: 'b0' },
                ],
            },
        ]);
        await wrapper.find('input#portable-a').setValue('typed-a');
        await wrapper.find('input#portable-b').setValue('typed-b');

        (wrapper.vm as unknown as { replaceValues: (next: Record<string, string>) => void })
            .replaceValues({ a: 'loaded-a', ghost: 'ignored' });
        await wrapper.vm.$nextTick();
        expect((wrapper.find('input#portable-a').element as HTMLInputElement).value).toBe('loaded-a');
        // Only the replaced field loses its dirty mark; the other edit survives.
        expect((wrapper.find('input#portable-b').element as HTMLInputElement).value).toBe('typed-b');
        // An unknown id is refused rather than seeding an invisible field.
        expect(wrapper.find('input#portable-ghost').exists()).toBe(false);

        // A replacement hands the field back to the plugin's declarative value;
        // the untouched dirty field still keeps what the user typed.
        await wrapper.setProps({
            nodes: [
                {
                    type: 'form',
                    id: 'settings',
                    children: [
                        { type: 'field.text', id: 'a', label: 'A', value: 'declared-a' },
                        { type: 'field.text', id: 'b', label: 'B', value: 'declared-b' },
                    ],
                },
            ],
        });
        expect((wrapper.find('input#portable-a').element as HTMLInputElement).value).toBe('declared-a');
        expect((wrapper.find('input#portable-b').element as HTMLInputElement).value).toBe('typed-b');
    });

    it('drops field state when the field is removed from the tree', async () => {
        const wrapper = mountTree([
            {
                type: 'form',
                id: 'settings',
                children: [{ type: 'field.text', id: 'gone', label: 'Gone', value: 'x' }],
            },
        ]);
        await wrapper.setProps({ nodes: [{ type: 'text', text: 'no fields' }] });
        // Re-introducing the field starts from its declared value again.
        await wrapper.setProps({
            nodes: [
                {
                    type: 'form',
                    id: 'settings',
                    children: [{ type: 'field.text', id: 'gone', label: 'Gone', value: 'fresh' }],
                },
            ],
        });
        expect((wrapper.find('input#portable-gone').element as HTMLInputElement).value).toBe(
            'fresh'
        );
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

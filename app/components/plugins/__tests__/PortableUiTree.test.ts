import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
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
        inheritAttrs: false,
        props: ['modelValue', 'id', 'label'],
        emits: ['update:modelValue'],
        template:
            '<label><input type="checkbox" v-bind="$attrs" :id="id" :aria-label="label" /></label>',
    },
    UProgress: {
        props: ['modelValue', 'max', 'getValueLabel'],
        template:
            '<div role="progressbar" :aria-valuenow="modelValue" :aria-valuemax="max" :aria-label="typeof getValueLabel === \'function\' ? getValueLabel(modelValue, max) : undefined" />',
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
        await wrapper.get('[data-portable-field="title"]').setValue('Unsaved edit');
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

    it('reopens the narrow inspector only when the selection changes', async () => {
        const workspace = (selected: string) => [
            {
                type: 'columns' as const,
                layout: 'workspace' as const,
                children: [
                    {
                        type: 'column' as const,
                        children: [
                            {
                                type: 'item' as const,
                                id: 'task-1',
                                label: 'Task one',
                                action: 'tasks.select',
                                selected: selected === 'task-1',
                            },
                            {
                                type: 'item' as const,
                                id: 'task-2',
                                label: 'Task two',
                                action: 'tasks.select',
                                selected: selected === 'task-2',
                            },
                        ],
                    },
                    {
                        type: 'column' as const,
                        children: [
                            { type: 'field.text' as const, id: 'title', label: 'Title', value: selected },
                        ],
                    },
                ],
            },
        ];
        const wrapper = mountTree(workspace('task-1'));
        resize.callback?.([{ contentRect: { width: 390 } }]);
        await nextTick();
        await wrapper.get('[aria-label="Dismiss drawer"]').trigger('click');
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

        // An ordinary redraw of the same selection keeps the closed drawer.
        await wrapper.setProps({ nodes: workspace('task-1') });
        await nextTick();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

        // Selecting another row is an intentional navigation action.
        await wrapper.setProps({ nodes: workspace('task-2') });
        await nextTick();
        expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
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

        const nameInput = wrapper.get('input[data-portable-field="name"]');
        const label = wrapper.get(`label[for="${nameInput.attributes('id')}"]`);
        expect(label.text()).toBe('Name');
        expect(
            wrapper.get('input[data-portable-field="enabled"]').attributes('aria-label')
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

        await wrapper.find('input[data-portable-field="name"]').setValue('changed');
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

        await wrapper.find('input[data-portable-field="name"]').setValue('changed');
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

        await wrapper.find('input[data-portable-field="name"]').setValue('changed');
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

        await wrapper.find('input[data-portable-field="title"]').setValue('Keyboard task');
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

        await wrapper.find('input[data-portable-field="query"]').setValue('design');
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

        await wrapper.find('select[data-portable-field="filter"]').setValue('open');
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
        await wrapper.find('input[data-portable-field="name"]').setValue('typed');

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
        expect((wrapper.find('input[data-portable-field="name"]').element as HTMLInputElement).value).toBe(
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
        expect((wrapper.find('input[data-portable-field="name"]').element as HTMLInputElement).value).toBe(
            'typed'
        );

        // Explicit replacement is a host decision and wins.
        (wrapper.vm as unknown as { replaceValues: (next: Record<string, string>) => void })
            .replaceValues({ name: 'replaced' });
        await wrapper.vm.$nextTick();
        expect((wrapper.find('input[data-portable-field="name"]').element as HTMLInputElement).value).toBe(
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
        await wrapper.find('input[data-portable-field="a"]').setValue('typed-a');
        await wrapper.find('input[data-portable-field="b"]').setValue('typed-b');

        (wrapper.vm as unknown as { replaceValues: (next: Record<string, string>) => void })
            .replaceValues({ a: 'loaded-a', ghost: 'ignored' });
        await wrapper.vm.$nextTick();
        expect((wrapper.find('input[data-portable-field="a"]').element as HTMLInputElement).value).toBe('loaded-a');
        // Only the replaced field loses its dirty mark; the other edit survives.
        expect((wrapper.find('input[data-portable-field="b"]').element as HTMLInputElement).value).toBe('typed-b');
        // An unknown id is refused rather than seeding an invisible field.
        expect(wrapper.find('input[data-portable-field="ghost"]').exists()).toBe(false);

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
        expect((wrapper.find('input[data-portable-field="a"]').element as HTMLInputElement).value).toBe('declared-a');
        expect((wrapper.find('input[data-portable-field="b"]').element as HTMLInputElement).value).toBe('typed-b');
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
        expect((wrapper.find('input[data-portable-field="gone"]').element as HTMLInputElement).value).toBe(
            'fresh'
        );
    });

    it('raises open-document as a host event and refuses open-pane', async () => {
        const wrapper = mountTree([
            { type: 'open-document', label: 'Open document', documentId: 'doc_9' },
            { type: 'open-pane', label: 'Open pane', paneId: 'pane_9' },
        ]);

        const buttons = wrapper.findAll('button');
        await buttons[0]!.trigger('click');
        await buttons[1]!.trigger('click');

        const events = wrapper.emitted('ui-event');
        expect(events?.[0]?.[0]).toEqual({ kind: 'open-document', documentId: 'doc_9' });
        // No host registry maps a portable pane id, so the control is refused
        // rather than left enabled as a no-op.
        expect(events).toHaveLength(1);
        expect(buttons[1]!.attributes('disabled')).toBeDefined();
    });

    it('scopes field ids to the render instance so two surfaces cannot collide', () => {
        const nodes: readonly PortableUiNode[] = [
            { type: 'field.text', id: 'search', label: 'Search', description: 'Filters the list' },
        ];
        const Host = defineComponent({
            components: { PortableUiTree },
            setup: () => ({ nodes }),
            template:
                '<div><PortableUiTree :nodes="nodes" /><PortableUiTree :nodes="nodes" /></div>',
        });
        const wrapper = mount(Host, { global: { stubs } });

        const inputs = wrapper.findAll('input[data-portable-field="search"]');
        expect(inputs).toHaveLength(2);
        expect(inputs[0]!.attributes('id')).not.toBe(inputs[1]!.attributes('id'));
        for (const input of inputs) {
            expect(wrapper.find(`label[for="${input.attributes('id')}"]`).exists()).toBe(true);
        }
    });

    it('connects field descriptions to their control', () => {
        const wrapper = mountTree([
            {
                type: 'field.text',
                id: 'name',
                label: 'Name',
                description: 'Shown to other members',
            },
        ]);
        const input = wrapper.get('input[data-portable-field="name"]');
        const describedBy = input.attributes('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(wrapper.get(`#${describedBy}`).text()).toBe('Shown to other members');
    });

    it('names the progress control from its visible label', () => {
        const wrapper = mountTree([
            { type: 'progress', value: 5, max: 10, label: 'Working' },
        ]);
        expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Working');
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

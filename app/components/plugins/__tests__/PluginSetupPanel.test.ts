import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PluginSetupPanel from '../PluginSetupPanel.vue';

function panel() {
    return mount(PluginSetupPanel, {
        props: {
            pluginId: 'test.plugin',
            plan: {
                status: 'needs-setup', connections: [], blockers: [],
                fields: [
                    { key: 'name', label: 'Name', kind: 'text', order: 1, required: true, secret: false, deferred: false, missing: true },
                    { key: 'token', label: 'Token', kind: 'text', order: 2, required: true, secret: true, deferred: true, missing: true },
                ],
                firstAction: { operationId: 'run', label: 'Run', usesSampleContext: true },
            },
            status: { status: 'needs-setup', label: 'Needs setup' },
            firstAction: { operationId: 'run', label: 'Run', contextKind: 'sample', ready: false },
            durableConnections: true, credentialsAvailable: false, storedConnections: 0,
            settings: { values: { name: 'stored', token: 'secret' }, errors: [] },
            saveState: 'idle',
        },
        global: { stubs: {
            UInput: {
                props: ['modelValue'], emits: ['update:modelValue'],
                template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            },
            UBadge: { template: '<span><slot /></span>' },
        } },
    });
}

describe('setup patch acknowledgements', () => {
    it('keeps edits made during a save and prevents a second submission replacing its acknowledgement', async () => {
        const wrapper = panel();
        expect(wrapper.findAll('input')).toHaveLength(1);
        await wrapper.get('input').setValue('submitted');
        await wrapper.get('form').trigger('submit');
        await wrapper.setProps({ saveState: 'saving' });
        await wrapper.get('input').setValue('new edit');
        await wrapper.get('form').trigger('submit');
        expect(wrapper.emitted('save-settings')).toEqual([[{ name: 'submitted' }]]);
        await wrapper.setProps({ saveState: 'saved', settings: { values: { name: 'submitted' }, errors: [] } });
        expect((wrapper.get('input').element as HTMLInputElement).value).toBe('new edit');
        expect(wrapper.get('[role="status"]').text()).toBe('You have unsaved changes.');
        await wrapper.get('form').trigger('submit');
        expect(wrapper.emitted('save-settings')).toEqual([[{ name: 'submitted' }], [{ name: 'new edit' }]]);
        wrapper.unmount();
    });

    it('does not clear local edits on an unrelated save acknowledgement', async () => {
        const wrapper = panel();
        await wrapper.get('input').setValue('unsaved');
        await wrapper.setProps({ saveState: 'saved' });
        await wrapper.get('form').trigger('submit');
        expect(wrapper.emitted('save-settings')).toEqual([[{ name: 'unsaved' }]]);
        wrapper.unmount();
    });
});

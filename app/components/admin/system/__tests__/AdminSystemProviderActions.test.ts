import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AdminSystemProviderActions from '../AdminSystemProviderActions.vue';

describe('provider maintenance results', () => {
    // Failure modes: disabled GC appears successful, bounds disappear, or output
    // is interpreted as HTML instead of escaped diagnostic text.
    it('keeps disabled status and read-only observation uncertainty visible', async () => {
        const wrapper = mount(AdminSystemProviderActions, {
            props: {
                actions: [{ id: 'storage.usage', label: 'Observe Storage Usage', kind: 'storage', provider: 'fs' }],
                isOwner: true,
                result: { label: 'Check Storage GC Status', value: { status: 'disabled', deleted_count: 0, reason: 'deletion_coordination_required' } },
            },
            global: { stubs: { UButton: { template: '<button><slot /></button>' } } },
        });
        expect(wrapper.get('[role="status"]').text()).toContain('deletion_coordination_required');
        expect(wrapper.get('[role="status"]').text()).toContain('"deleted_count": 0');
        await wrapper.setProps({ result: { label: 'Observe Storage Usage', value: {
            consistency: 'non_atomic_observation', filesystem: { complete: false }, warnings: ['filesystem_entry_limit', '<script>unsafe</script>'],
        } } });
        expect(wrapper.get('[role="status"]').text()).toContain('non_atomic_observation');
        expect(wrapper.get('[role="status"]').text()).toContain('filesystem_entry_limit');
        expect(wrapper.find('script').exists()).toBe(false);
    });
});

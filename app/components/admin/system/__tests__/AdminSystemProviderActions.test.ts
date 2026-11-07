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

// Remote usage has no local disk capacity; partial listings must stay explicit.
it('renders S3 object usage without inventing local disk capacity', () => {
    const wrapper = mount(AdminSystemProviderActions, { props: {
        actions: [{ id: 'storage.usage', label: 'Storage usage', kind: 'storage', provider: 's3' }], isOwner: true,
        result: { label: 'Storage usage', storageUsage: true, value: {
            canonical: { activeMetadataBytes: 1024, retainedDeletedMetadataBytes: 2048,
                complete: { activeMetadata: true, retainedDeletedMetadata: true } },
            objectStore: { objectBytes: 4096, complete: false },
        } },
    }, global: { stubs: { UButton: { template: '<button><slot /></button>' } } } });
    expect(wrapper.text()).toContain('Objects in storage');
    expect(wrapper.text()).toContain('4 KB');
    expect(wrapper.text()).toContain('Partial scan');
    expect(wrapper.text()).not.toContain('Files on disk');
    expect(wrapper.text()).not.toContain('Server space available');
});

// A workspace's apparent bytes cannot stand in for host capacity. Missing or
// impossible capacity observations must stay unknown, never 0% or healthy.
it('compares configured warning thresholds only with measured volume capacity', async () => {
    const wrapper = mount(AdminSystemProviderActions, { props: {
        actions: [{ id: 'storage.usage', label: 'Storage usage', kind: 'storage', provider: 'fs' }], isOwner: true,
        warningPercent: 80, criticalPercent: 90,
        result: { label: 'Storage usage', storageUsage: true, value: { volume: { totalBytes: 1000, availableBytes: 90 } } },
    }, global: { stubs: { UButton: { template: '<button><slot /></button>' } } } });
    expect(wrapper.text()).toContain('Capacity critical');
    expect(wrapper.text()).toContain('91%');
    await wrapper.setProps({ result: { label: 'Storage usage', storageUsage: true, value: { volume: null } } });
    expect(wrapper.text()).toContain('Capacity unknown');
    expect(wrapper.text()).not.toContain('Capacity critical');
});

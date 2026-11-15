import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { Or3DB, databaseRecovery } from '~/db/client';
import ErrorRecovery from '../ErrorRecovery.client.vue';

vi.mock('~/components/chat/OpenRouterKeyModal.vue', () => ({ default: { template: '<div />' } }));
vi.mock('~/components/ui/AppModal.vue', () => ({ default: {
    props: ['open', 'title'],
    template: '<section v-if="open" role="dialog" :aria-label="title"><slot /><slot name="footer" /></section>',
} }));

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); databaseRecovery.value = null; });

it('announces active, blocked and failed storage upgrades without offering destructive recovery', async () => {
    const db = new Or3DB('recovery-ui-unopened');
    wrapper = mount(ErrorRecovery, { global: { stubs: {
        UProgress: { template: '<div role="progressbar" v-bind="$attrs" />' },
        UButton: { template: '<button><slot /></button>' },
    } } });
    // The DB lifecycle publishes this state while the real versionchange runs.
    databaseRecovery.value = { db, phase: 'upgrading' };
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Updating local data');
    expect(wrapper.get('[role="status"]').text()).toContain('Keep this tab open');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Updating local data');
    expect(wrapper.find('button').exists()).toBe(false);
    databaseRecovery.value = { db, phase: 'blocked' };
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Close other OR3 tabs');
    databaseRecovery.value = { db, phase: 'failed' };
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Do not clear this site');
    expect(wrapper.get('button').text()).toBe('Retry upgrade');
    databaseRecovery.value = null;
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
});

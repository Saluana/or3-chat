import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import ChatDiagnosticReport from '../ChatDiagnosticReport.client.vue';

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ public: { errorReportingEnabled: true, ssrAuthEnabled: true, appVersion: '0.1.141' } }),
}));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: { value: {
        session: { authenticated: true, provider: 'basic', user: { id: 'test-actor' } },
    } } }),
}));
afterEach(() => vi.unstubAllGlobals());

it('sends nothing unless the user confirms and sends exactly the shown fields once', async () => {
    const send = vi.fn().mockResolvedValue({ accepted: true });
    vi.stubGlobal('$fetch', send);
    const wrapper = mount(ChatDiagnosticReport, {
        props: { details: {
            code: 'ERR_INTERNAL', source: 'unknown', retryable: false,
            chatStage: 'before_save_confirmation',
            diagnostics: { capturedAt: '2026-11-26T17:00:00.000Z', checkpoint: 'check_model', online: true, localRequestId: '99e00e04-18cf-4492-bb0c-4b8169f2cfd3' },
            providerCode: 'private-code',
        } },
        global: { stubs: { UButton: { template: '<button type="button"><slot /></button>' } } },
    });
    const click = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!.trigger('click');
    await click('Preview report to site admin');
    await click('Close preview');
    expect(send).not.toHaveBeenCalled();
    await click('Preview report to site admin');
    const preview = JSON.parse(wrapper.get('[aria-label="Report preview"]').text());
    expect(preview).toMatchObject({ code: 'ERR_INTERNAL', stage: 'before_save_confirmation', checkpoint: 'check_model', appVersion: '0.1.141', localRequestId: '99e00e04-18cf-4492-bb0c-4b8169f2cfd3' });
    expect(preview).not.toHaveProperty('providerCode');
    expect(preview).not.toHaveProperty('capturedAt');
    await click('Send to site admin');
    await flushPromises();
    expect(JSON.parse(JSON.stringify(send.mock.calls[0]?.[1].body))).toEqual(preview);
    expect(wrapper.text()).toContain('Report sent to the site admin.');
    expect(wrapper.findAll('button').find(button => button.text() === 'Send to site admin')!.attributes('disabled')).toBeDefined();
    expect(send).toHaveBeenCalledOnce();
    wrapper.unmount();
});

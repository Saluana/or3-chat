import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchPreviewMock = vi.fn();
const revokePreviewMock = vi.fn();
const updateMock = vi.fn();

let currentRecord: any = null;

vi.mock('~/composables/or3-net/useOr3NetClient', () => ({
    useOr3NetClient: () => ({
        launchPreview: launchPreviewMock,
        revokePreview: revokePreviewMock,
    }),
}));

vi.mock('~/composables/or3-net/useOr3NetPreviewPaneState', () => ({
    useOr3NetPreviewPaneState: () => ({
        get: () => currentRecord,
        update: updateMock,
        remove: vi.fn(),
    }),
}));

describe('Or3NetPreviewPane', () => {
    beforeEach(() => {
        vi.resetModules();
        launchPreviewMock.mockReset();
        revokePreviewMock.mockReset();
        updateMock.mockReset();
        currentRecord = {
            id: 'pane-prev-1',
            preview_id: 'prev-1',
            workspace_id: 'ws-1',
            title: 'Preview',
            kind: 'static-site',
            source_type: 'files',
            launch_url: 'https://preview.test/prev-1',
            embed_url: null,
            delivery_mode: 'external',
            supports_iframe: false,
            supports_new_tab: true,
            service_status: 'ready',
            expires_at: '2026-04-01T13:00:00.000Z',
        };
    });

    it('shows fallback UI, opens in a new tab, refreshes, and revokes', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        launchPreviewMock.mockResolvedValue({
            preview_id: 'prev-1',
            workspace_id: 'ws-1',
            launch_url: 'https://preview.test/prev-1',
            embed_url: 'https://preview.test/prev-1/embed',
            delivery_mode: 'embedded',
            supports_iframe: true,
            supports_new_tab: true,
            reused_tunnel: false,
            service_status: 'ready',
            expires_at: '2026-04-01T14:00:00.000Z',
        });
        revokePreviewMock.mockResolvedValue({
            preview: {
                preview_id: 'prev-1',
                status: 'revoked',
            },
        });

        const component = await import('../Or3NetPreviewPane.vue');
        const wrapper = mount(component.default, {
            props: {
                paneId: 'pane-1',
                recordId: 'pane-prev-1',
                postType: 'or3-net-preview',
                postApi: null,
            },
            global: {
                stubs: {
                    UButton: {
                        emits: ['click'],
                        template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
                    },
                },
            },
        });

        expect(wrapper.text()).toContain('Embedded preview unavailable');

        await wrapper.findAll('button')[0]?.trigger('click');
        await flushPromises();
        expect(openSpy).toHaveBeenCalledWith(
            'https://preview.test/prev-1',
            '_blank',
            'noopener,noreferrer'
        );

        await wrapper.findAll('button')[1]?.trigger('click');
        await flushPromises();
        expect(launchPreviewMock).toHaveBeenCalledWith('ws-1', 'prev-1', {
            launch_mode_hint: 'pane',
        });
        expect(updateMock).toHaveBeenCalledWith(
            'pane-prev-1',
            expect.objectContaining({
                embed_url: 'https://preview.test/prev-1/embed',
                supports_iframe: true,
            })
        );

        await wrapper.findAll('button')[2]?.trigger('click');
        await flushPromises();
        expect(revokePreviewMock).toHaveBeenCalledWith('ws-1', 'prev-1');
        expect(updateMock).toHaveBeenCalledWith(
            'pane-prev-1',
            expect.objectContaining({
                launch_url: '',
                embed_url: null,
                supports_new_tab: false,
                service_status: 'revoked',
            })
        );
        openSpy.mockRestore();
    });

    it('sandboxes embedded previews', async () => {
        currentRecord = {
            ...currentRecord,
            embed_url: 'https://preview.test/prev-1/embed',
            supports_iframe: true,
            delivery_mode: 'embedded',
        };

        const component = await import('../Or3NetPreviewPane.vue');
        const wrapper = mount(component.default, {
            props: {
                paneId: 'pane-1',
                recordId: 'pane-prev-1',
                postType: 'or3-net-preview',
                postApi: null,
            },
            global: {
                stubs: {
                    UButton: {
                        emits: ['click'],
                        template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
                    },
                },
            },
        });

        expect(wrapper.find('iframe').attributes('sandbox')).toBe(
            'allow-scripts allow-same-origin allow-forms'
        );
    });
});

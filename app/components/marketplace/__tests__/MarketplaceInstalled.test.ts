import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MarketplaceInstalled from '../MarketplaceInstalled.vue';

/**
 * Pointer slots hold digests, never versions. The UI renders the server's
 * display DTO (version read from the stored manifest of the selected slot), so a
 * promoted package shows its version and gets an Open action instead of the
 * "no version selected" a guessed `pointer.selected.version` produced.
 */
const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const stubs = {
    UButton: {
        props: ['disabled', 'loading', 'to'],
        emits: ['click'],
        template:
            '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
    UBadge: { template: '<span><slot /></span>' },
};

function pageResponse(
    display: Record<string, unknown>,
    pointer: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        plugins: [],
        role: 'owner',
        workspaceId: 'ws-1',
        enabledPlugins: ['sample.plugin'],
        packagePlugins: [
            {
                pluginId: 'sample.plugin',
                workspaceEnabled: true,
                pointer: {
                    current: { packageDigest: `sha256-${'a'.repeat(64)}` },
                    candidate: null,
                    previous: null,
                    ...pointer,
                },
                startup: {
                    status: 'ready',
                    selectedSlot: 'current',
                    selectedDigest: display.selectedDigest ?? null,
                    issueCodes: [],
                },
                display,
            },
        ],
    };
}

beforeEach(() => {
    fetchMock.mockReset();
});

describe('MarketplaceInstalled', () => {
    it('shows the selected version and an Open action from the display DTO', async () => {
        fetchMock.mockResolvedValue(
            pageResponse({
                version: '2.1.0',
                selectedDigest: `sha256-${'a'.repeat(64)}`,
                candidateVersion: null,
                candidateDigest: null,
                canOpen: true,
            })
        );
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('2.1.0');
        expect(wrapper.text()).not.toContain('no version selected');
        expect(wrapper.text()).toContain('Open');
    });

    it('hides Open and the version when no slot has a readable selection', async () => {
        fetchMock.mockResolvedValue(
            pageResponse({
                version: null,
                selectedDigest: null,
                candidateVersion: '3.0.0',
                candidateDigest: `sha256-${'b'.repeat(64)}`,
                canOpen: false,
            })
        );
        const wrapper = mount(MarketplaceInstalled, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('no version selected');
        // No readable selection means nothing to open, even with a candidate waiting.
        expect(wrapper.text()).not.toContain('Open');
    });
});

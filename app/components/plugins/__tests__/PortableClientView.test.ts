import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { PortableActivation } from '~/composables/plugins/portable-client-runtime';

/**
 * A plugin's registered dashboard contributions must reach a rendered surface:
 * recording them and rendering nothing made the advertised contribution API
 * produce invisible UI. Withdrawal has to hide them again.
 */
const invokeMock = vi.fn();
const activations = new Map<string, unknown>();

vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    usePortableActivations: () => activations,
    invokePortableUiEvent: (...args: unknown[]) => invokeMock(...args),
}));

import PortableUiTree from '../PortableUiTree.vue';
import PortableClientView from '../PortableClientView.vue';

function activation(overrides: Partial<PortableActivation> = {}): PortableActivation {
    return {
        pluginId: 'sample.plugin',
        version: '1.0.0',
        workspaceId: 'ws-1',
        generation: 1,
        descriptorKey: `sha256-${'a'.repeat(64)}`,
        status: 'active',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        logs: [],
        crashed: false,
        startedAt: 0,
        ...overrides,
    } as PortableActivation;
}

const stubs = {
    UIcon: { template: '<i />' },
    UBadge: { template: '<span><slot /></span>' },
    UAlert: { props: ['title', 'description'], template: '<div role="alert">{{ title }}</div>' },
};

// Nuxt auto-imports the renderer in the app; a unit mount has to register it.
const global = { stubs, components: { PortableUiTree } };

describe('PortableClientView', () => {
    it('renders registered dashboard contributions', () => {
        activations.set(
            'sample.plugin',
            activation({
                contributions: [
                    {
                        id: 'sample.plugin.summary',
                        title: 'Workspace insights',
                        nodes: [{ type: 'text', text: 'Twelve open threads' }],
                    },
                ],
            })
        );

        const wrapper = mount(PortableClientView, {
            props: { pluginId: 'sample.plugin' },
            global,
        });

        const section = wrapper.get('[data-testid="portable-plugin-contributions"]');
        expect(section.text()).toContain('Workspace insights');
        expect(section.text()).toContain('Twelve open threads');
    });

    it('hides a contribution the plugin withdrew', () => {
        activations.set('sample.plugin', activation({ contributions: [] }));

        const wrapper = mount(PortableClientView, {
            props: { pluginId: 'sample.plugin' },
            global,
        });

        expect(wrapper.find('[data-testid="portable-plugin-contributions"]').exists()).toBe(false);
    });
});

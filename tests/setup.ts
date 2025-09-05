// Global test setup: mock heavy virtualization lib to avoid jsdom/Bun hangs.
import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('virtua/vue', () => {
    const Base = defineComponent({
        name: 'MockVirtualListBase',
        props: {
            data: { type: Array, default: () => [] },
            itemSize: { type: [Number, Function], default: 0 },
            itemSizeEstimation: { type: [Number, Function], default: 0 },
            overscan: { type: Number, default: 0 },
        },
        setup(props, { slots }) {
            return () =>
                h(
                    'div',
                    { class: 'mock-virtualizer' },
                    (props.data as any[]).map((item: any, index: number) =>
                        slots.default ? slots.default({ item, index }) : null
                    )
                );
        },
    });
    return {
        VList: Base,
        Virtualizer: Base,
    };
});

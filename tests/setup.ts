// Global test setup: mock heavy virtualization lib to avoid jsdom/Bun hangs.
import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('virtua/vue', () => {
    return {
        VList: defineComponent({
            name: 'MockVList',
            props: {
                data: { type: Array, default: () => [] },
                itemSize: { type: [Number, Function], default: 0 },
                overscan: { type: Number, default: 0 },
            },
            setup(props, { slots }) {
                return () =>
                    h(
                        'div',
                        { class: 'mock-vlist' },
                        props.data.map((item: any, index: number) =>
                            slots.default
                                ? slots.default({ item, index })
                                : null
                        )
                    );
            },
        }),
    };
});

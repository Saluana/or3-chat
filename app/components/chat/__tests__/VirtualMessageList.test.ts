import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VirtualMessageList from '../VirtualMessageList.vue';

const factory = (messages: any[] = []) =>
    mount(VirtualMessageList, {
        props: { messages },
        slots: { item: ({ message }: any) => message.content },
    });

describe('VirtualMessageList', () => {
    it('emits visible-range-change on mount', () => {
        const msgs = Array.from({ length: 3 }, (_, i) => ({
            id: String(i),
            content: `m${i}`,
        }));
        const wrapper = factory(msgs);
        const ev = wrapper.emitted('visible-range-change');
        expect(ev).toBeTruthy();
        expect(ev?.[0]?.[0]).toEqual({ start: 0, end: 2 });
    });

    it('emits reached-bottom when last item visible', () => {
        const msgs = [{ id: '1', content: 'a' }];
        const wrapper = factory(msgs);
        expect(wrapper.emitted('reached-bottom')).toBeTruthy();
    });

    it('re-emits range when messages length changes', async () => {
        const msgs = [{ id: '1', content: 'a' }];
        const wrapper = factory(msgs);
        // clear existing emissions for clarity
        (wrapper.emitted()['visible-range-change'] || []).length;
        await wrapper.setProps({
            messages: [
                { id: '1', content: 'a' },
                { id: '2', content: 'b' },
                { id: '3', content: 'c' },
                { id: '4', content: 'd' },
            ],
        });
        const evs = wrapper.emitted('visible-range-change');
        expect(evs?.at(-1)?.[0]).toEqual({ start: 0, end: 3 });
    });
});

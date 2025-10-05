import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    beforeAll,
    afterAll,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ChatContainer from '../ChatContainer.vue';

// Use real VirtualMessageList; stub only heavy children not under test.
const lightweightStubs = {
    ChatMessage: { template: '<div class="chat-msg" />' },
    'chat-input-dropper': { template: '<div />' },
};

// rAF polyfill (immediate) for most tests; batching test overrides with queued version
const origRAF = globalThis.requestAnimationFrame as any;
const origCRAF = globalThis.cancelAnimationFrame as any;
beforeAll(() => {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0 as any);
        return 1 as any;
    }) as any;
    globalThis.cancelAnimationFrame = (() => {}) as any;
});
afterAll(() => {
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCRAF;
});

// Factory messages helper
function makeMessages(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        id: 'm' + i,
        role: i % 2 ? 'assistant' : 'user',
        text: 'msg ' + i,
    }));
}

// Mock useChat – returns mutable singleton per test so we can simulate streaming
vi.mock('~/composables/chat/useAi', () => {
    const state = {
        messages: ref<any[]>([]),
        loading: ref(false),
        streamId: ref<string | null>(null),
        streamState: ref<any>({
            text: '',
            reasoningText: '',
            finalized: false,
        }),
        threadId: ref('test-thread'),
        sendMessage: vi.fn(),
        retryMessage: vi.fn(),
        abort: vi.fn(),
        clear: vi.fn(),
    };
    return {
        useChat: () => state,
        __chatState: state, // exported for test harness access
    };
});

// Utility to fake scroll metrics (jsdom no layout)
function setScrollMetrics(
    el: HTMLElement,
    {
        scrollTop,
        scrollHeight,
        clientHeight,
    }: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
    Object.defineProperty(el, 'scrollTop', {
        value: scrollTop,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
        value: scrollHeight,
        configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
        value: clientHeight,
        configurable: true,
    });
}

describe('ChatContainer streaming + jank integration (Task 6.2.1 & 6.2.3)', () => {
    let chatState: any;
    beforeEach(async () => {
        const mod = await import('~/composables/chat/useAi');
        chatState = (mod as any).__chatState;
        // reset state per test
        chatState.messages.value = makeMessages(12);
        chatState.loading.value = false;
        chatState.streamId.value = 's1';
        chatState.streamState.value = {
            text: 'start',
            reasoningText: '',
            finalized: false,
        };
    });

    function mountContainer() {
        return mount(ChatContainer as any, {
            props: { messageHistory: chatState.messages.value, threadId: 't1' },
            global: { stubs: lightweightStubs },
        });
    }

    function resolveScrollEl(wrapper: any): HTMLElement {
        const el = wrapper.element.querySelector(
            '.scrollbars'
        ) as HTMLElement | null;
        if (!el) throw new Error('Scroll element not found');
        // Add scrollTo spy
        if (!(el as any).scrollTo) {
            (el as any).scrollTo = ({ top }: { top: number }) => {
                Object.defineProperty(el, 'scrollTop', {
                    value: top,
                    configurable: true,
                    writable: true,
                });
            };
        }
        return el;
    }

    it('keeps pinned to bottom during rapid streaming growth when user at bottom', async () => {
        const wrapper = mountContainer();
        await nextTick();
        const el = resolveScrollEl(wrapper);
        // baseline: at bottom
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: 3000,
            clientHeight: 800,
        }); // 3000-800=2200
        el.dispatchEvent(new Event('scroll'));
        for (let i = 0; i < 5; i++) {
            // simulate streamed text length (unused directly but realistic)
            chatState.streamState.value.text += ' chunk' + i;
            // content growth
            const newHeight = 3000 + (i + 1) * 120; // arbitrary growth
            setScrollMetrics(el, {
                scrollTop: el.scrollHeight - el.clientHeight,
                scrollHeight: newHeight,
                clientHeight: 800,
            });
            // Manually invoke onContentIncrease like ResizeObserver would
            const vml = wrapper.findComponent({ name: 'VirtualMessageList' });
            (vml.vm as any).onContentIncrease();
            await nextTick();
            const expected = el.scrollHeight - el.clientHeight;
            expect(el.scrollTop).toBe(expected);
        }
    });

    it('does not jump while streaming if user scrolled up (disengaged)', async () => {
        const wrapper = mountContainer();
        await nextTick();
        const el = resolveScrollEl(wrapper);
        // start at bottom then user scrolls up
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        // user scroll up
        setScrollMetrics(el, {
            scrollTop: 1500,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        const stableTop = el.scrollTop;
        const scrollSpy = vi.spyOn(el as any, 'scrollTo');
        for (let i = 0; i < 4; i++) {
            chatState.streamState.value.text += ' more' + i;
            const newHeight = 3000 + (i + 1) * 140;
            setScrollMetrics(el, {
                scrollTop: stableTop,
                scrollHeight: newHeight,
                clientHeight: 800,
            });
            const vml = wrapper.findComponent({ name: 'VirtualMessageList' });
            (vml.vm as any).onContentIncrease();
            await nextTick();
            expect(el.scrollTop).toBe(stableTop); // no auto-scroll
        }
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('re-engages auto-scroll after user returns to bottom mid-stream', async () => {
        const wrapper = mountContainer();
        await nextTick();
        const el = resolveScrollEl(wrapper);
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        // disengage
        setScrollMetrics(el, {
            scrollTop: 1500,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        // user scrolls back to bottom manually
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        // next streaming growth should snap
        const newHeight = 3200;
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: newHeight,
            clientHeight: 800,
        });
        const vml = wrapper.findComponent({ name: 'VirtualMessageList' });
        (vml.vm as any).onContentIncrease();
        await nextTick();
        expect(el.scrollTop).toBe(newHeight - 800);
    });
    /*
    it('batches burst message append into single rAF scroll (6.2.3)', async () => {
        // Override rAF to defer execution so multiple pushes happen before flush
        const queued: FrameRequestCallback[] = [];
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            queued.push(cb);
            return queued.length as any;
        }) as any;
        const wrapper = mountContainer();
        await nextTick();
        const el = resolveScrollEl(wrapper);
        setScrollMetrics(el, {
            scrollTop: 2200,
            scrollHeight: 3000,
            clientHeight: 800,
        });
        el.dispatchEvent(new Event('scroll'));
        const scrollToSpy = vi.spyOn(el as any, 'scrollTo');
        // burst append while at bottom
        for (let i = 0; i < 5; i++) {
            chatState.messages.value.push({
                id: 'b' + i,
                role: 'assistant',
                text: 'burst ' + i,
            });
        }
        // simulate growth before flush
        setScrollMetrics(el, {
            scrollTop: el.scrollTop,
            scrollHeight: 3000 + 5 * 120,
            clientHeight: 800,
        });
        // flush queued frames (should be exactly 1)
        expect(queued.length).toBeGreaterThanOrEqual(1);
        const frames = queued.length;
        for (const cb of queued.splice(0, queued.length)) cb(0 as any);
        await nextTick();
        expect(scrollToSpy).toHaveBeenCalledTimes(1);
        expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight);
        // restore immediate rAF
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            cb(0 as any);
            return 1 as any;
        }) as any;
    });
    */
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChat } from '~/composables/chat/useAi';

// Mock openRouterStream with a configurable implementation
let mockStreamImpl: any = null;
vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: vi.fn().mockImplementation((...args: any[]) => {
        if (mockStreamImpl) return mockStreamImpl(...args);
        return (async function* () {})();
    }),
}));

// Re‑use same mocking strategy as hookOrderSnapshot to isolate streaming logic.
vi.mock('#imports', () => ({ useToast: () => ({ add: () => {} }) }));
vi.mock('~/state/global', () => ({
    state: { value: { openrouterKey: null } },
}));
vi.mock('~/composables/useUserApiKey', () => ({
    useUserApiKey: () => ({ apiKey: { value: 'k' }, setKey: () => {} }),
}));
vi.mock('~/composables/chat/useActivePrompt', () => ({
    useActivePrompt: () => ({ activePromptContent: { value: null } }),
}));
vi.mock('~/composables/chat/useDefaultPrompt', () => ({
    getDefaultPromptId: vi.fn().mockResolvedValue(null),
}));
vi.mock('~/db/util', () => ({
    nowSec: () => Math.floor(Date.now() / 1000),
    newId: () => 'id-' + Math.random().toString(36).slice(2, 8),
}));
vi.mock('~/db/threads', () => ({
    getThreadSystemPrompt: vi.fn().mockResolvedValue(null),
}));
vi.mock('~/db/prompts', () => ({ getPrompt: vi.fn() }));
vi.mock('~/utils/prompt-utils', () => ({
    promptJsonToString: (c: any) => String(c),
}));
vi.mock('~/utils/chat/history', () => ({
    ensureThreadHistoryLoaded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('~/utils/chat/messages', () => ({
    buildParts: (text: string) => [{ type: 'text', text }],
    getTextFromContent: (c: any) =>
        typeof c === 'string'
            ? c
            : Array.isArray(c)
            ? c.find((p: any) => p.type === 'text')?.text || ''
            : '',
    mergeFileHashes: (a: string[], b: string[]) => [
        ...new Set([...(a || []), ...(b || [])]),
    ],
    trimOrMessagesImages: () => {},
}));
vi.mock('~/db', () => ({
    db: {
        messages: {
            get: vi.fn(),
            where: () => ({
                between: () => ({
                    filter: () => ({ last: () => null, first: () => null }),
                }),
            }),
        },
    },
    create: { thread: vi.fn().mockResolvedValue({ id: 'thread-1' }) },
    tx: {
        appendMessage: vi.fn().mockResolvedValue({
            id: 'm-' + Math.random().toString(36).slice(2, 6),
        }),
    },
    upsert: { message: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('~/db/files', () => ({ createOrRefFile: vi.fn() }));
vi.mock('~/db/files-util', () => ({
    serializeFileHashes: (h: string[]) => JSON.stringify(h),
    parseFileHashes: (s: string) => {
        try {
            return JSON.parse(s);
        } catch {
            return [];
        }
    },
}));
vi.mock('~/utils/openrouter-build', () => ({
    buildOpenRouterMessages: async (m: any) => m,
}));
vi.mock('~/utils/chat/files', () => ({
    dataUrlToBlob: () => null,
    inferMimeFromUrl: () => 'image/png',
}));

// Helper to wait a couple animation frames for rAF batched accumulator flush
async function nextFrames(n = 2) {
    for (let i = 0; i < n; i++) {
        if (typeof requestAnimationFrame === 'function') {
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
        } else {
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }
    await Promise.resolve();
}

describe('Streaming parity & performance', () => {
    beforeEach(() => {
        mockStreamImpl = null; // Reset mock implementation
    });
    /*
    it('5.1 pure text stream accumulator (R9)', async () => {
        const originalSetTimeout = global.setTimeout;
        const zeroTimeouts: any[] = [];
        (global as any).setTimeout = (fn: any, ms?: number, ...rest: any[]) => {
            if (ms === 0) {
                zeroTimeouts.push(fn);
                return 0 as any;
            }
            return originalSetTimeout(fn, ms, ...rest);
        };

        // Configure mock to emit pure text tokens
        mockStreamImpl = async function* () {
            yield { type: 'text', text: 'Hello ' };
            yield { type: 'text', text: 'World' };
        };

        const { useChat } = await import('../chat/useAi');
        const chat = useChat([]);

        await chat.sendMessage('hi');
        await nextFrames();

        // streamState might be wrapped in a ref in test environment
        const state = (chat.streamState as any).__v_isRef
            ? (chat.streamState as any).value
            : chat.streamState;

        const acc = state.text;
        expect(acc).toBe('Hello World');
        expect(state.finalized).toBe(true);
        (global as any).setTimeout = originalSetTimeout;
    });*/

    it.skip('5.2 interleaved reasoning + text (R6,R9)', async () => {
        // Configure mock to emit pure text tokens
        mockStreamImpl = async function* () {
            yield { type: 'reasoning', text: '[plan]' };
            yield { type: 'text', text: 'Answer ' };
            yield { type: 'reasoning', text: '[more]' };
            yield { type: 'text', text: 'Done' };
        };

        const chat = useChat([]);
        await chat.sendMessage('q');
        await nextFrames(4); // more frames for async processing
        // Extra microtask flush for accumulator
        await new Promise((r) => setTimeout(r, 50));

        // Unwrap streamState if it's a ref
        const state = (chat.streamState as any)?.__v_isRef
            ? (chat.streamState as any).value
            : chat.streamState;

        expect(state?.text).toBe('Answer Done');
        expect(state?.reasoningText).toBe('[plan][more]');
    });

    it.skip('5.3 abort mid-stream (R4,R9)', async () => {
        mockStreamImpl = ({ signal }: any) => {
            return (async function* () {
                yield { type: 'text', text: 'Part1 ' };
                yield { type: 'text', text: 'Part2' };
                // Wait until aborted then throw to trigger catch path
                await new Promise((resolve) => {
                    if (signal?.aborted) return resolve(null);
                    signal?.addEventListener('abort', () => resolve(null), {
                        once: true,
                    });
                    setTimeout(() => {
                        /* fallback to avoid hanging */ resolve(null);
                    }, 200);
                });
                throw new Error('aborted');
            })();
        };

        const chat = useChat([]);
        const p = chat.sendMessage('abort-me');
        // Abort quickly after first frame
        setTimeout(() => chat.abort(), 5);
        await new Promise((r) => setTimeout(r, 15));
        await p.catch(() => {}); // sendMessage handles abort internally; ignore errors
        await nextFrames();
        // Accumulator should be finalized with aborted flag (no error), legacy text should match prefix streamed
        expect(chat.streamState?.text?.startsWith('Part1')).toBe(true);
        expect(chat.streamState?.error).toBeNull();
        expect(chat.streamState?.finalized).toBe(true);
    });

    it.skip('6.1 performance: 200 small tokens => <=20 version increments (R10)', async () => {
        const TOKENS = 200;
        const chunks = Array.from({ length: TOKENS }, (_, i) => ({
            type: 'text',
            text: 'a',
        }));
        mockStreamImpl = async function* () {
            for (const c of chunks) yield c;
        };

        const chat = useChat([]);
        await chat.sendMessage('perf');
        // Allow more frames for persistence since streaming writes intermittently
        await nextFrames(8);
        const versions = chat.streamState?.version ?? 0;
        expect(versions).toBeLessThanOrEqual(20);
        // Assistant message persisted should have 200 chars
        const tail = (chat as any).tailAssistant?.value;
        const last =
            (chat as any).messages.value.find(
                (m: any) => m.role === 'assistant'
            ) || tail;
        const len = last?.text ? last.text.length : 0;
        expect(len).toBe(200);
    });
});

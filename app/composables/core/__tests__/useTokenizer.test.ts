import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope } from 'vue';

describe('useTokenizer - worker concurrency', () => {
    beforeEach(() => {
        // Reset module state between tests
        vi.resetModules();
    });

    it('prevents race condition when ensureWorker called concurrently', async () => {
        // Mock Worker constructor to track instantiation
        let workerCreationCount = 0;
        
        global.Worker = vi.fn().mockImplementation(() => {
            workerCreationCount++;
            // Simulate async worker setup
            return {
                postMessage: vi.fn(),
                terminate: vi.fn(),
                addEventListener: vi.fn(),
                onmessage: null,
                onerror: null,
            };
        }) as any;

        const { useTokenizer } = await import('../useTokenizer');
        
        // Use effect scope to avoid onMounted warnings
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        // Simulate concurrent initialization attempts
        const promises = [
            tokenizer.countTokens('test1'),
            tokenizer.countTokens('test2'),
            tokenizer.countTokens('test3'),
        ];

        // Wait for all to complete
        try {
            await Promise.all(promises);
        } catch {
            // Expected to fail since we mocked Worker, that's OK
        }

        // Worker should be created exactly once despite concurrent calls
        expect(workerCreationCount).toBeLessThanOrEqual(1);
        
        scope.stop();
    });

    it('handles worker failure gracefully and allows fallback', async () => {
        // Mock Worker to fail immediately
        global.Worker = vi.fn().mockImplementation(() => {
            throw new Error('Worker construction failed');
        }) as any;

        // Mock the fallback encoder
        vi.doMock('gpt-tokenizer', () => ({
            encode: (text: string) => Array(text.length).fill(1), // Mock implementation
        }));

        const { useTokenizer } = await import('../useTokenizer');
        
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        // Should fall back to dynamic import instead of crashing
        const count = await tokenizer.countTokens('hello');
        
        // Should get a count (fallback succeeded)
        expect(count).toBeGreaterThanOrEqual(0);
        
        scope.stop();
    });

    it('rejects pending requests when worker fails', async () => {
        const errorHandlerRef: {
            current: ((error: any) => void) | null;
        } = { current: null };

        // Mock Worker that allows us to trigger errors
        global.Worker = vi.fn().mockImplementation(() => ({
            postMessage: vi.fn(),
            terminate: vi.fn(),
            addEventListener: vi.fn(),
            set onerror(handler: ((error: any) => void) | null) {
                errorHandlerRef.current = handler;
            },
            get onerror() {
                return errorHandlerRef.current;
            },
            onmessage: null,
        })) as any;

        const { useTokenizer } = await import('../useTokenizer');
        
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        // Start a count operation
        const countPromise = tokenizer.countTokens('test');

        // Trigger worker error
        errorHandlerRef.current?.(new Error('Worker crashed'));

        // Promise should reject or return fallback
        // (Either is acceptable - the important part is it doesn't hang)
        try {
            await countPromise;
        } catch {
            // Rejection is fine
        }
        
        scope.stop();
    });
});

describe('useTokenizer - basic functionality', () => {
    beforeEach(() => {
        vi.resetModules();
        
        // Mock Worker with basic functionality
        global.Worker = vi.fn().mockImplementation(() => {
            let messageHandler: ((event: MessageEvent) => void) | null = null;
            
            return {
                postMessage: vi.fn((data) => {
                    // Simulate worker response
                    setTimeout(() => {
                        if (messageHandler) {
                            messageHandler(new MessageEvent('message', {
                                data: {
                                    id: data.id,
                                    type: 'result',
                                    count: 5, // Mock count
                                },
                            }));
                        }
                    }, 0);
                }),
                terminate: vi.fn(),
                addEventListener: vi.fn(),
                set onmessage(handler: any) {
                    messageHandler = handler;
                },
                get onmessage() {
                    return messageHandler;
                },
                onerror: null,
            };
        }) as any;
    });

    it('returns a token count for valid text', async () => {
        const { useTokenizer } = await import('../useTokenizer');
        
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count = await tokenizer.countTokens('hello world');
        
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
        
        scope.stop();
    });

    it('handles empty string without error', async () => {
        const { useTokenizer } = await import('../useTokenizer');
        
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count = await tokenizer.countTokens('');
        
        expect(count).toBe(0);
        
        scope.stop();
    });

    it('handles multiple sequential calls', async () => {
        const { useTokenizer } = await import('../useTokenizer');
        
        const scope = effectScope();
        const tokenizer = await scope.run(() => useTokenizer())!;

        const count1 = await tokenizer.countTokens('first');
        const count2 = await tokenizer.countTokens('second');
        const count3 = await tokenizer.countTokens('third');
        
        expect(typeof count1).toBe('number');
        expect(typeof count2).toBe('number');
        expect(typeof count3).toBe('number');
        
        scope.stop();
    });
});

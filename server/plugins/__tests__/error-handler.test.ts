/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitWebhookSystemHookMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/webhooks/runtime', () => ({
    emitWebhookSystemHook: emitWebhookSystemHookMock,
}));

vi.mock('nitropack/runtime', () => ({
    defineNitroPlugin: (handler: unknown) => handler,
}));

type CapturedErrorHandler = (error: unknown, context: { event: unknown }) => void;

describe('error-handler webhook emission', () => {
    beforeEach(() => {
        emitWebhookSystemHookMock.mockReset().mockResolvedValue(undefined);
    });

    it('does not emit sync/storage webhook errors for handled 4xx responses', async () => {
        const plugin = (await import('../error-handler')).default as (
            nitro: {
                hooks: {
                    hook: (name: string, handler: (...args: unknown[]) => void) => void;
                };
            }
        ) => void;
        let capturedHandler: CapturedErrorHandler | undefined;

        plugin({
            hooks: {
                hook(name, handler) {
                    if (name === 'error') {
                        capturedHandler = handler as CapturedErrorHandler;
                    }
                },
            },
        });

        expect(capturedHandler).toBeTypeOf('function');
        const errorHandler = capturedHandler;
        if (!errorHandler) {
            throw new Error('Expected error handler to be registered');
        }
        errorHandler(
            Object.assign(new Error('Forbidden'), { statusCode: 403 }),
            {
                event: {
                    method: 'POST',
                    path: '/api/sync/push',
                    node: {
                        req: {
                            url: '/api/sync/push',
                            method: 'POST',
                            headers: {
                                host: 'localhost:3000',
                            },
                        },
                    },
                },
            }
        );

        expect(emitWebhookSystemHookMock).not.toHaveBeenCalled();
    });

    it('emits sync webhook errors for 5xx responses', async () => {
        const plugin = (await import('../error-handler')).default as (
            nitro: {
                hooks: {
                    hook: (name: string, handler: (...args: unknown[]) => void) => void;
                };
            }
        ) => void;
        let capturedHandler: CapturedErrorHandler | undefined;

        plugin({
            hooks: {
                hook(name, handler) {
                    if (name === 'error') {
                        capturedHandler = handler as CapturedErrorHandler;
                    }
                },
            },
        });

        expect(capturedHandler).toBeTypeOf('function');
        const errorHandler = capturedHandler;
        if (!errorHandler) {
            throw new Error('Expected error handler to be registered');
        }
        errorHandler(
            Object.assign(new Error('Boom'), { statusCode: 500 }),
            {
                event: {
                    method: 'POST',
                    path: '/api/sync/push',
                    node: {
                        req: {
                            url: '/api/sync/push',
                            method: 'POST',
                            headers: {
                                host: 'localhost:3000',
                            },
                        },
                    },
                },
            }
        );

        expect(emitWebhookSystemHookMock).toHaveBeenCalledWith(
            'sync:action:error',
            expect.objectContaining({
                source: 'sync',
                status: 500,
                path: '/api/sync/push',
            })
        );
    });
});

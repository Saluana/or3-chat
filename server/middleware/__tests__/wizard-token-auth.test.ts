import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const runtimeConfig = vi.hoisted(() => ({
    wizardUi: {
        enabled: true,
        token: 'wizard-secret',
    },
}));
const setCookieMock = vi.hoisted(() => vi.fn());

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getRequestURL: (event: H3Event) =>
        new URL(
            (event as H3Event & { context: { url: string } }).context.url
        ),
    getHeader: (event: H3Event, name: string) =>
        (event as H3Event & { context: { headers?: Record<string, string> } })
            .context.headers?.[name],
    getCookie: () => undefined,
    setCookie: setCookieMock,
    sendRedirect: vi.fn(),
    createError: (options: {
        statusCode: number;
        statusMessage: string;
    }) =>
        Object.assign(new Error(options.statusMessage), {
            statusCode: options.statusCode,
        }),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

function event(
    url = 'https://example.com/wizard',
    headers: Record<string, string> = {}
): H3Event {
    return {
        context: { url, headers },
        node: { req: {}, res: {} },
    } as unknown as H3Event;
}

describe('wizard token middleware', () => {
    beforeEach(() => {
        runtimeConfig.wizardUi.enabled = true;
        runtimeConfig.wizardUi.token = 'wizard-secret';
        setCookieMock.mockReset();
    });

    it('fails closed when the wizard is enabled without a token', async () => {
        runtimeConfig.wizardUi.token = '';
        const handler = (await import('../wizard-token-auth')).default as (
            event: H3Event
        ) => unknown;

        expect(() => handler(event())).toThrow(
            expect.objectContaining({ statusCode: 503 })
        );
    });

    it('accepts a matching header token', async () => {
        const handler = (await import('../wizard-token-auth')).default as (
            event: H3Event
        ) => unknown;

        expect(() =>
            handler(event('https://example.com/api/wizard/status', {
                'x-wizard-token': 'wizard-secret',
            }))
        ).not.toThrow();
        expect(setCookieMock).toHaveBeenCalled();
    });

    it('does not affect unrelated routes', async () => {
        runtimeConfig.wizardUi.token = '';
        const handler = (await import('../wizard-token-auth')).default as (
            event: H3Event
        ) => unknown;

        expect(() => handler(event('https://example.com/api/health'))).not.toThrow();
    });
});

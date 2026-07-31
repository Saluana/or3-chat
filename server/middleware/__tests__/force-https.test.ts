import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { createEvent, type H3Event } from 'h3';

const mocks = vi.hoisted(() => ({
    sendRedirect: vi.fn((event: unknown, location: string, code: number) => ({
        event,
        location,
        code,
    })),
    runtimeConfig: {
        security: {
            forceHttps: true,
            proxy: { trustProxy: false },
        },
    } as {
        security: {
            forceHttps: boolean;
            proxy?: {
                trustProxy?: boolean;
            };
        };
    },
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        defineEventHandler: (handler: unknown) => handler,
        sendRedirect: mocks.sendRedirect,
    };
});

vi.mock('#imports', () => ({
    useRuntimeConfig: () => mocks.runtimeConfig,
}));

function makeEvent(input: {
    host?: string;
    forwardedProto?: string;
    url?: string;
    encrypted?: boolean;
}): H3Event {
    const req = new IncomingMessage(new Socket());
    req.headers = {};
    if (input.host !== undefined) req.headers.host = input.host;
    if (input.forwardedProto !== undefined) {
        req.headers['x-forwarded-proto'] = input.forwardedProto;
    }
    req.url = input.url ?? '/api/health';
    (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted = input.encrypted;
    const res = new ServerResponse(req);
    return createEvent(req, res);
}

describe('force-https middleware', () => {
    const prevNuxtForceHttps = process.env.NUXT_SECURITY_FORCE_HTTPS;
    const prevOr3ForceHttps = process.env.OR3_FORCE_HTTPS;

    beforeEach(() => {
        mocks.sendRedirect.mockReset();
        mocks.runtimeConfig = {
            security: {
                forceHttps: true,
                proxy: { trustProxy: false },
            },
        };
        delete process.env.NUXT_SECURITY_FORCE_HTTPS;
        delete process.env.OR3_FORCE_HTTPS;
    });

    afterEach(() => {
        if (prevNuxtForceHttps === undefined) {
            delete process.env.NUXT_SECURITY_FORCE_HTTPS;
        } else {
            process.env.NUXT_SECURITY_FORCE_HTTPS = prevNuxtForceHttps;
        }
        if (prevOr3ForceHttps === undefined) {
            delete process.env.OR3_FORCE_HTTPS;
        } else {
            process.env.OR3_FORCE_HTTPS = prevOr3ForceHttps;
        }
    });

    it('redirects insecure non-loopback requests', async () => {
        const handler = (await import('../force-https')).default;
        const event = makeEvent({
            host: 'example.com',
            encrypted: false,
            url: '/api/health',
        });

        await handler(event);

        expect(mocks.sendRedirect).toHaveBeenCalledTimes(1);
        expect(mocks.sendRedirect).toHaveBeenCalledWith(
            event,
            'https://example.com/api/health',
            301
        );
    });

    it('skips redirect for loopback hosts', async () => {
        const handler = (await import('../force-https')).default;
        const event = makeEvent({
            host: 'localhost:4010',
            encrypted: false,
        });

        await handler(event);

        expect(mocks.sendRedirect).not.toHaveBeenCalled();
    });

    it('ignores x-forwarded-proto when trustProxy is disabled', async () => {
        const handler = (await import('../force-https')).default;
        mocks.runtimeConfig.security.proxy = { trustProxy: false };
        const event = makeEvent({
            host: 'example.com',
            forwardedProto: 'https',
            encrypted: false,
        });

        await handler(event);

        expect(mocks.sendRedirect).toHaveBeenCalledTimes(1);
    });

    it('accepts trusted forwarded proto with comma-separated values', async () => {
        const handler = (await import('../force-https')).default;
        mocks.runtimeConfig.security.proxy = { trustProxy: true };
        const event = makeEvent({
            host: 'example.com',
            forwardedProto: 'https,http',
            encrypted: false,
        });

        await handler(event);

        expect(mocks.sendRedirect).not.toHaveBeenCalled();
    });

    it('honors runtime OR3_FORCE_HTTPS override for prebuilt output', async () => {
        const handler = (await import('../force-https')).default;
        process.env.OR3_FORCE_HTTPS = 'false';
        const event = makeEvent({
            host: 'example.com',
            encrypted: false,
        });

        await handler(event);

        expect(mocks.sendRedirect).not.toHaveBeenCalled();
    });
});

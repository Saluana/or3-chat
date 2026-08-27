import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent, type H3Event } from 'h3';
import { testRuntimeConfig } from '../../../tests/setup';
import wizardTokenAuth from '../wizard-token-auth';

function makeEvent(input: {
    path?: string;
    headers?: Record<string, string>;
} = {}): H3Event {
    const request = new IncomingMessage(new Socket());
    request.headers = {
        host: 'localhost:3000',
        ...input.headers,
    };
    request.url = input.path ?? '/wizard';
    return createEvent(request, new ServerResponse(request));
}

describe('wizard token auth middleware', () => {
    const originalRuntimeConfig = testRuntimeConfig.value;

    beforeEach(() => {
        testRuntimeConfig.value = {
            ...originalRuntimeConfig,
            wizardUi: {
                enabled: true,
            },
        };
    });

    afterAll(() => {
        testRuntimeConfig.value = originalRuntimeConfig;
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['whitespace-only', ' \t\n'],
    ])('rejects an enabled wizard with a %s token', (_label, token) => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: {
                enabled: true,
                ...(token === undefined ? {} : { token }),
            },
        };

        expect(() => wizardTokenAuth(makeEvent())).toThrowError(
            expect.objectContaining({
                statusCode: 503,
                statusMessage: 'Wizard token is not configured.',
            })
        );
    });

    it('rejects a wrong token without exposing the wizard', () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: { enabled: true, token: 'expected-token' },
        };

        expect(() =>
            wizardTokenAuth(
                makeEvent({ headers: { 'x-wizard-token': 'wrong-token' } })
            )
        ).toThrowError(
            expect.objectContaining({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            })
        );
    });

    it('allows a valid token through the normal wizard flow', () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: { enabled: true, token: 'expected-token' },
        };

        expect(() =>
            wizardTokenAuth(
                makeEvent({ headers: { 'x-wizard-token': 'expected-token' } })
            )
        ).not.toThrow();
    });

    it('does not affect non-wizard routes', () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: { enabled: true },
        };

        expect(() =>
            wizardTokenAuth(makeEvent({ path: '/api/health' }))
        ).not.toThrow();
    });
});

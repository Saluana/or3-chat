import { beforeEach, describe, expect, it } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import { requireSameOriginMutation } from '../mutation-guard';

const connectOptions = {
    intentHeader: 'x-or3-connect-intent',
    intentValue: 'approve',
    requireJson: true,
} as const;

function makeEvent(headers: Record<string, string | undefined>): H3Event {
    return {
        method: 'POST',
        node: {
            req: { headers },
        },
    } as unknown as H3Event;
}

describe('same-origin mutation guard', () => {
    beforeEach(() => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            security: {
                ...testRuntimeConfig.value.security,
                proxy: {
                    trustProxy: true,
                    forwardedForHeader: 'x-forwarded-for',
                    forwardedHostHeader: 'x-forwarded-host',
                },
            },
        };
    });

    it('accepts exact-origin JSON behind the configured proxy chain', () => {
        const event = makeEvent({
            host: 'internal.local',
            origin: 'https://or3.chat',
            'content-type': 'application/json; charset=utf-8',
            'x-forwarded-host': 'or3.chat',
            'x-forwarded-proto': 'https',
            'x-or3-connect-intent': 'approve',
        });

        expect(() =>
            requireSameOriginMutation(event, connectOptions)
        ).not.toThrow();
    });

    it('accepts an exact-origin Referer when Origin is unavailable', () => {
        const event = makeEvent({
            host: 'internal.local',
            referer: 'https://or3.chat/connect?code=SAFE-CODE-123',
            'content-type': 'application/json',
            'x-forwarded-host': 'or3.chat',
            'x-forwarded-proto': 'https',
            'x-or3-connect-intent': 'approve',
        });

        expect(() =>
            requireSameOriginMutation(event, connectOptions)
        ).not.toThrow();
    });

    it.each([
        {
            name: 'a sibling tunnel origin',
            headers: {
                origin: 'https://attacker.connect.or3.chat',
                'content-type': 'application/json',
                'x-or3-connect-intent': 'approve',
            },
            statusCode: 403,
        },
        {
            name: 'a missing Origin and Referer',
            headers: {
                'content-type': 'application/json',
                'x-or3-connect-intent': 'approve',
            },
            statusCode: 403,
        },
        {
            name: 'a form content type',
            headers: {
                origin: 'https://or3.chat',
                'content-type': 'application/x-www-form-urlencoded',
                'x-or3-connect-intent': 'approve',
            },
            statusCode: 415,
        },
        {
            name: 'a missing intent header',
            headers: {
                origin: 'https://or3.chat',
                'content-type': 'application/json',
            },
            statusCode: 403,
        },
        {
            name: 'the wrong intent value',
            headers: {
                origin: 'https://or3.chat',
                'content-type': 'application/json',
                'x-or3-connect-intent': 'deny',
            },
            statusCode: 403,
        },
    ])('rejects $name', ({ headers, statusCode }) => {
        const event = makeEvent({
            host: 'internal.local',
            'x-forwarded-host': 'or3.chat',
            'x-forwarded-proto': 'https',
            ...headers,
        });

        expect(() => requireSameOriginMutation(event, connectOptions)).toThrow(
            expect.objectContaining({ statusCode })
        );
    });
});

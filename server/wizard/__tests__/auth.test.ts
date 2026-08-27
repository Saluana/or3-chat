import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent, type H3Event } from 'h3';
import { testRuntimeConfig } from '../../../tests/setup';
import { assertWebWizardEnabled } from '../index';

function makeWizardEvent(headers: Record<string, string> = {}): H3Event {
    const request = new IncomingMessage(new Socket());
    request.headers = { host: 'localhost:3000', ...headers };
    request.url = '/api/wizard/session';
    return createEvent(request, new ServerResponse(request));
}

describe('wizard handler auth', () => {
    const originalRuntimeConfig = testRuntimeConfig.value;

    beforeEach(() => {
        testRuntimeConfig.value = {
            ...originalRuntimeConfig,
            wizardUi: { enabled: true },
        };
    });

    afterAll(() => {
        testRuntimeConfig.value = originalRuntimeConfig;
    });

    it.each(['', ' \t\n'])('fails closed for a %s configured token', (token) => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: { enabled: true, token },
        };

        expect(() => assertWebWizardEnabled(makeWizardEvent())).toThrowError(
            expect.objectContaining({
                statusCode: 503,
                statusMessage: 'Wizard token is not configured.',
            })
        );
    });

    it('keeps the valid token and invalid token behavior explicit', () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            wizardUi: { enabled: true, token: 'expected-token' },
        };

        expect(() =>
            assertWebWizardEnabled(
                makeWizardEvent({ 'x-wizard-token': 'wrong-token' })
            )
        ).toThrowError(
            expect.objectContaining({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            })
        );

        expect(() =>
            assertWebWizardEnabled(
                makeWizardEvent({ 'x-wizard-token': 'expected-token' })
            )
        ).not.toThrow();
    });
});

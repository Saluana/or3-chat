import { afterEach, describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent, type H3Event } from 'h3';
import { assertWebWizardEnabled, configureWizardHost } from '../index';

function makeWizardEvent(headers: Record<string, string> = {}): H3Event {
    const request = new IncomingMessage(new Socket());
    request.headers = { host: '127.0.0.1:4173', ...headers };
    request.url = '/api/wizard/session';
    return createEvent(request, new ServerResponse(request));
}

describe('wizard handler auth', () => {
    afterEach(() => configureWizardHost(null));

    it('refuses every request when no wizard host is running', () => {
        expect(() =>
            assertWebWizardEnabled(makeWizardEvent({ 'x-wizard-token': 'anything' }))
        ).toThrowError(expect.objectContaining({ statusCode: 404 }));
    });

    it.each(['', ' \t\n'])('fails closed for a %s configured token', (token) => {
        configureWizardHost({ token });
        expect(() => assertWebWizardEnabled(makeWizardEvent())).toThrowError(
            expect.objectContaining({
                statusCode: 503,
                statusMessage: 'Wizard token is not configured.',
            })
        );
    });

    it('keeps the valid token and invalid token behavior explicit', () => {
        configureWizardHost({ token: 'expected-token' });
        expect(() =>
            assertWebWizardEnabled(makeWizardEvent({ 'x-wizard-token': 'wrong-token' }))
        ).toThrowError(
            expect.objectContaining({
                statusCode: 403,
                statusMessage: 'Invalid wizard token.',
            })
        );
        expect(() =>
            assertWebWizardEnabled(makeWizardEvent({ 'x-wizard-token': 'expected-token' }))
        ).not.toThrow();
    });
});

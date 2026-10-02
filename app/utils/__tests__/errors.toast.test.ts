import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick } from 'vue';
import { useToast } from '@nuxt/ui/composables/useToast';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    doAction: vi.fn(),
}));

vi.unmock('~/utils/errors');

// Supply Nuxt state while exercising the real Nuxt UI toast queue/identity owner.
vi.mock('#imports', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#imports')>();
    const { ref } = await import('vue');
    return { ...actual, useState: (_key: string, init: () => unknown) => ref(init()) };
});

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: mocks.doAction }),
    tryGetHooks: () => ({ doAction: mocks.doAction }),
}));

import { serializeError, errorDiagnostics } from '~~/shared/errors';
import { useApiError } from '~/composables/useApiError';
import {
    err,
    asAppError,
    reportError,
    setErrorToastApi,
    setErrorRecoveryApi,
} from '~/utils/errors';

describe('error toast bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setErrorRecoveryApi({});
        setErrorToastApi(null);
    });

    it('uses a toast API captured during Nuxt plugin setup', () => {
        setErrorToastApi({ add: mocks.addToast });

        reportError(err('ERR_INTERNAL', 'Deferred failure'));

        expect(mocks.addToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Something went wrong',
                description: 'The operation could not be completed. Please try again.',
            })
        );
    });

    it('honors toast false without resolving or displaying a toast', () => {
        setErrorToastApi({ add: mocks.addToast });

        reportError(err('ERR_INTERNAL', 'Background-only failure'), {
            toast: false,
        });

        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('keeps distinct same-millisecond errors and their recovery controls in Nuxt UI', async () => {
        let toast!: ReturnType<typeof useToast>;
        const app = createApp(defineComponent({
            setup() { toast = useToast(); return () => null; },
        }));
        app.mount(document.createElement('div'));
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
        try {
            setErrorRecoveryApi({ update_key: vi.fn() });
            setErrorToastApi(toast);
            reportError({ status: 401, source: 'provider', credentialSource: 'personal' });
            reportError({ status: 503, source: 'provider' });
            for (let i = 0; i < 6; i++) await nextTick();

            expect(toast.toasts.value).toHaveLength(2);
            expect(toast.toasts.value.map(t => t.title)).toEqual(['OpenRouter key rejected', 'AI provider unavailable']);
            expect(toast.toasts.value[0]?.actions).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Update API key' })]));
        } finally {
            clock.mockRestore();
            app.unmount();
            setErrorRecoveryApi({});
        }
    });
});

// Owner boundary: metadata must reach both the reporting hooks and the user toast.
// These inputs reproduce raw-fetch, SDK and serialized HTTP failures without
// mocking the mapper. Existing tests only exercise the injected toast bridge.
describe('classified error presentation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setErrorToastApi({ add: mocks.addToast });
    });

    it.each([
        [401, 'ERR_AUTH', 'OpenRouter key rejected', false],
        [402, 'ERR_CREDITS', 'OpenRouter credits needed', false],
        [403, 'ERR_FORBIDDEN', 'Access denied', false],
        [429, 'ERR_RATE_LIMIT', 'Too many requests', true],
        [503, 'ERR_PROVIDER', 'AI provider unavailable', true],
    ])('classifies provider HTTP %s without exposing its body', (status, code, title, retryable) => {
        const input = Object.assign(new Error('proxy body: {"token":"secret-token-123", "message":"User not found."}'), {
            status, source: 'provider', credentialSource: 'personal', providerCode: status,
            retryAfterMs: 4000, retryable,
        });
        const result = reportError(input, { code: 'ERR_STREAM_FAILURE', tags: { domain: 'chat' } });
        expect(result).toMatchObject({ code, status, source: 'provider', providerCode: status, retryable, retryAfterMs: 4000 });
        expect(mocks.addToast.mock.lastCall?.[0]).toMatchObject({ title });
        expect(JSON.stringify(mocks.addToast.mock.calls)).not.toMatch(/secret-token|User not found|proxy body|ERR_/);
        expect(mocks.doAction).toHaveBeenCalledWith('error:raised', result);
    });

    it('keeps managed credentials separate from OR3 session expiry', () => {
        reportError({ status: 401, source: 'provider', credentialSource: 'server' });
        expect(mocks.addToast.mock.lastCall?.[0]).toMatchObject({ title: 'Server AI connection needs attention', description: expect.stringContaining('administrator') });
        reportError({ statusCode: 401, data: { statusMessage: 'raw session body' } });
        expect(mocks.addToast.mock.lastCall?.[0]).toMatchObject({ title: 'Sign in required', description: expect.stringContaining('Sign in') });
    });

    it('offers retry only with classified retryability and a safe callback', () => {
        const retry = vi.fn();
        reportError(Object.assign(new Error('fetch failed'), { status: 401 }), { retry });
        expect(mocks.addToast.mock.lastCall?.[0].actions).toBeUndefined();
        reportError(Object.assign(new Error('fetch failed'), { status: 503 }), { retry });
        const action = mocks.addToast.mock.lastCall?.[0].actions?.find((a: { label: string }) => a.label === 'Retry');
        expect(action).toBeDefined();
        action.onClick();
        expect(retry).toHaveBeenCalledOnce();
    });

    it('uses truthful operation fallback for unclassified HTML and secret-rich errors', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = reportError(new Error('<html>password=supersecret Bearer token123 /private/app.ts:22</html>'), {
            code: 'ERR_FILE_PERSIST', message: 'The attachment could not be saved.',
        });
        expect(mocks.addToast.mock.lastCall?.[0].description).toBe('The attachment could not be saved.');
        expect(JSON.stringify(spy.mock.calls)).not.toMatch(/supersecret|token123|private.*app/);
        expect(result.cause).toBeInstanceOf(Error);
        spy.mockRestore();
    });
});

// Distinct public boundaries: persisted background failures and API extraction
// must not collapse into strings or bypass the shared safe presentation.
describe('structured failures at UI boundaries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setErrorRecoveryApi({});
        setErrorToastApi({ add: mocks.addToast });
    });
    it.each([
        {
            name: 'development reload', input: new Error('raw token=private-token'),
            context: { code: 'ERR_STREAM_FAILURE', fallbackMessage: 'The development server reloaded. Reload OR3, then resend your message.' } as const,
            title: 'Response interrupted', message: 'The development server reloaded. Reload OR3, then resend your message.',
        },
        {
            name: 'failed sign-in', input: { statusCode: 401, message: 'raw token=private-token' },
            context: { operation: 'login' } as const,
            title: 'Sign-in failed', message: 'Check your sign-in details and try again.',
        },
    ])('preserves trusted $name recovery through repeated normalization and reporting', ({ input, context, title, message }) => {
        setErrorRecoveryApi({ sign_in: vi.fn() });
        const normalized = asAppError(asAppError(input, context));
        const result = reportError(normalized);
        expect(result.message).toBe(message);
        expect(mocks.addToast.mock.lastCall?.[0]).toMatchObject({ title, description: message, actions: undefined });
        expect(JSON.stringify(mocks.addToast.mock.calls)).not.toContain('private-token');
        expect(reportError(normalized, { message: 'New operation guidance.' }).message).toBe(
            'operation' in context && context.operation === 'login' ? message : 'New operation guidance.',
        );
    });
    it('preserves a persisted background failure without retaining upstream text', () => {
        const serialized = serializeError(Object.assign(new Error('secret raw upstream body'), {
            status: 429, providerCode: 429, retryAfterMs: 25000, retryable: true,
        }), { source: 'provider', credentialSource: 'server' });
        expect(serialized).not.toContain('secret raw upstream body');
        const result = reportError(serialized, { code: 'ERR_STREAM_FAILURE' });
        expect(result).toMatchObject({ code: 'ERR_RATE_LIMIT', status: 429, providerCode: 429, retryAfterMs: 25000, credentialSource: 'server', retryable: true });
        expect(mocks.addToast.mock.lastCall?.[0].description).toBe('Please wait 25 seconds before trying again.');
    });
    it('shows only supported recovery and allowlisted diagnostics', () => {
        const recover = vi.fn();
        const details = vi.fn();
        setErrorRecoveryApi({ update_key: recover, details });
        reportError(Object.assign(new Error('Bearer secret123 password=hunter2'), {
            status: 401, source: 'provider', credentialSource: 'personal', body: 'sk-or-v1-private000000', providerCode: 'sk-or-v1-private000000',
        }));
        const toast = mocks.addToast.mock.lastCall?.[0];
        toast.actions.find((a: { label: string }) => a.label === 'Update API key').onClick();
        expect(recover).toHaveBeenCalledOnce();
        toast.actions.find((a: { label: string }) => a.label === 'Details').onClick();
        expect(details).toHaveBeenCalledWith({ code: 'ERR_AUTH', status: 401, source: 'provider', credentialSource: 'personal', providerCode: undefined, retryAfterMs: undefined, retryable: false });
        expect(JSON.stringify(details.mock.calls)).not.toMatch(/secret123|hunter2|private000000/);
    });
    it('classifies network errors and does not suggest retry for unsafe tool outcomes', () => {
        expect(reportError(Object.assign(new Error('transport failed'), { name: 'OpenRouterStreamError', status: 0, kind: 'transport', retryable: true }))).toMatchObject({ code: 'ERR_NETWORK', retryable: true });
        const retry = vi.fn();
        reportError({ code: 'ERR_TOOL_OUTCOME_UNKNOWN', retryable: true }, { retry, retryable: true });
        expect(mocks.addToast.mock.lastCall?.[0]).toMatchObject({ description: expect.stringContaining('Check its result before retrying'), actions: undefined });
        expect(errorDiagnostics({ status: 401, retryable: true })).toMatchObject({ retryable: false });
    });
    it('replaces raw API bodies with operation fallback or classified guidance', () => {
        const { getMessage } = useApiError();
        expect(getMessage({ data: { statusMessage: '<html>password=hunter2</html>' } }, 'Could not load workspaces.')).toBe('Could not load workspaces.');
        expect(getMessage({ statusCode: 401, data: { statusMessage: 'User not found.' } }, 'Could not load workspaces.')).toBe('Sign in to OR3 again to continue.');
        expect(getMessage({ statusCode: 401 }, 'Login failed', { operation: 'login' })).toBe('Check your sign-in details and try again.');
    });
});

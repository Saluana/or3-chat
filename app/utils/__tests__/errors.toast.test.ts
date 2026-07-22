import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    doAction: vi.fn(),
}));

vi.unmock('~/utils/errors');

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: mocks.doAction }),
}));

import {
    err,
    reportError,
    setErrorToastApi,
} from '~/utils/errors';

describe('error toast bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setErrorToastApi(null);
    });

    it('uses a toast API captured during Nuxt plugin setup', () => {
        setErrorToastApi({ add: mocks.addToast });

        reportError(err('ERR_INTERNAL', 'Deferred failure'));

        expect(mocks.addToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'ERR_INTERNAL',
                description: 'Deferred failure',
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
});

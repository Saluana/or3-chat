import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
    getActiveEntitlementResolver,
    getEntitlementResolver,
    registerEntitlementResolver,
    resolveEntitlements,
} from '../registry';

const { useRuntimeConfigMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(() => ({
        public: { sync: { provider: 'default' } },
        sync: { provider: 'default' },
    })),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('entitlement resolver registry', () => {
    it('releases owned replacements without removing a newer resolver or reviving a disposed one', () => {
        const original = async () => ['base'];
        const disposeBase = registerEntitlementResolver('owned-test', original);
        const sameCallback = async () => ['paid'];
        const disposeFirst = registerEntitlementResolver('owned-test', sameCallback);
        const disposeSecond = registerEntitlementResolver('owned-test', sameCallback);
        disposeFirst();
        expect(getEntitlementResolver('owned-test')).toBe(sameCallback);
        disposeSecond();
        expect(getEntitlementResolver('owned-test')).toBe(original);
        disposeBase();
        expect(getEntitlementResolver('owned-test')).toBeNull();
    });
    beforeEach(() => {
        useRuntimeConfigMock.mockReset().mockReturnValue({
            public: { sync: { provider: 'default' } },
            sync: { provider: 'default' },
        });
    });

    it('uses default resolver when no provider resolver is registered', async () => {
        const event = makeEvent();
        const entitlements = await resolveEntitlements(event, {
            authenticated: true,
            user: { id: 'u1' },
            workspace: { id: 'ws1', name: 'Workspace 1' },
        });

        expect(entitlements).toEqual([]);
        expect(getActiveEntitlementResolver()).toBeTypeOf('function');
    });

    it('resolves entitlements through provider-specific resolver', async () => {
        registerEntitlementResolver('convex', async () => ['paid', 'paid', 'beta']);
        useRuntimeConfigMock.mockReturnValue({
            public: { sync: { provider: 'convex' } },
            sync: { provider: 'convex' },
        });

        const entitlements = await resolveEntitlements(makeEvent(), {
            authenticated: true,
            user: { id: 'u1' },
            workspace: { id: 'ws1', name: 'Workspace 1' },
        });

        expect(entitlements).toEqual(['paid', 'beta']);
    });

    it('caches entitlement resolution per request', async () => {
        const resolver = vi.fn(async () => ['paid']);
        registerEntitlementResolver('sqlite', resolver);
        useRuntimeConfigMock.mockReturnValue({
            public: { sync: { provider: 'sqlite' } },
            sync: { provider: 'sqlite' },
        });

        const event = makeEvent();
        const session = {
            authenticated: true,
            user: { id: 'u1' },
            workspace: { id: 'ws1', name: 'Workspace 1' },
        };

        await resolveEntitlements(event, session);
        await resolveEntitlements(event, session);

        expect(resolver).toHaveBeenCalledTimes(1);
    });
});

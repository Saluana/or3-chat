import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import LibraryHome from '../LibraryHome.vue';

const { libraryHolder, installerHolder, sessionHolder } = vi.hoisted(() => ({
    libraryHolder: { current: null as unknown },
    installerHolder: { current: null as unknown },
    sessionHolder: { current: null as unknown },
}));

vi.mock('~/composables/library/useLibraryLink', () => ({ useLibraryLink: () => libraryHolder.current }));
vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => sessionHolder.current }));
vi.mock('~/composables/marketplace/useMarketplace', () => ({
    marketplacePluginDeepLink: (origin: string, pluginId: string, version?: string, requestId?: string) =>
        `${origin}/?dashboard=marketplace&plugin=${pluginId}${version ? `&version=${version}` : ''}${requestId ? `&installRequest=${requestId}` : ''}`,
    useMarketplaceAccount: () => installerHolder.current,
}));

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const stubs = {
    UButton: {
        props: ['to', 'disabled'],
        emits: ['click'],
        template: '<component :is="to ? \'a\' : \'button\'" :href="to" :disabled="disabled" @click="$emit(\'click\')"><slot /></component>',
    },
};

function linked(id: string, accountId: string) {
    return {
        id,
        accountId,
        label: 'My OR3',
        origin: 'https://or3.test',
        scopes: ['library:read', 'downloads:acquire'],
        expiresAt: '2026-12-01T00:00:00.000Z',
    };
}

function entitlements(accountId: string, pluginId: string) {
    return {
        configured: true,
        linked: true,
        accountId,
        plus: { status: 'none', until: null },
        pluginCoverage: [{ pluginId, status: 'valid', until: '2027-01-01T00:00:00.000Z' }],
        acquired: [{
            releaseId: `rel_${pluginId}`,
            pluginId,
            version: '1.2.3',
            coverageKind: 'update-pass',
            coverageUntil: '2027-01-01T00:00:00.000Z',
            acquiredAt: '2026-09-01T00:00:00.000Z',
        }],
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    fetchMock.mockReset();
    sessionHolder.current = { data: ref({ session: { workspace: { id: 'ws-1' } } }) };
    libraryHolder.current = {
        userId: ref('local-1'),
        state: ref('unlinked'),
        link: ref(null),
        status: ref({ configured: true, state: 'unlinked' }),
        configured: ref(true),
        loading: ref(false),
        busy: ref(false),
        failure: ref(null),
        pairing: ref(null),
        load: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
    installerHolder.current = {
        canInstall: ref(true),
        checked: ref(true),
        load: vi.fn().mockResolvedValue(undefined),
        invalidate: vi.fn(),
    };
});

describe('LibraryHome purchases', () => {
    it('loads after linking without remounting and offers an exact-version install route', async () => {
        fetchMock.mockResolvedValue(entitlements('buyer-a', 'sample.plugin'));
        const wrapper = mount(LibraryHome, { global: { stubs } });
        const library = libraryHolder.current as { state: ReturnType<typeof ref<string>>; link: ReturnType<typeof ref<ReturnType<typeof linked> | null>> };
        library.link.value = linked('link-a', 'buyer-a');
        library.state.value = 'linked';
        await flush();

        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/library/entitlements');
        expect(wrapper.text()).toContain('sample.plugin');
        expect(wrapper.text()).toContain('Plugin update coverage');
        const install = wrapper.findAll('a').find((anchor) => anchor.text().includes('Install or restore'));
        expect(install?.attributes('href')).toBe(`${window.location.origin}/?dashboard=marketplace&plugin=sample.plugin&version=1.2.3`);
        wrapper.unmount();
    });

    it('clears disconnected purchases and rejects late results from another linked account', async () => {
        let resolveOld!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
            .mockResolvedValueOnce(entitlements('buyer-b', 'second.plugin'));
        const wrapper = mount(LibraryHome, { global: { stubs } });
        const library = libraryHolder.current as { state: ReturnType<typeof ref<string>>; link: ReturnType<typeof ref<ReturnType<typeof linked> | null>> };
        library.link.value = linked('link-a', 'buyer-a');
        library.state.value = 'linked';
        await nextTick();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        library.state.value = 'unlinked';
        library.link.value = null;
        await nextTick();
        expect(wrapper.text()).not.toContain('first.plugin');

        library.link.value = linked('link-b', 'buyer-b');
        library.state.value = 'linked';
        await flush();
        expect(wrapper.text()).toContain('second.plugin');

        resolveOld(entitlements('buyer-a', 'first.plugin'));
        await flush();
        expect(wrapper.text()).toContain('second.plugin');
        expect(wrapper.text()).not.toContain('first.plugin');
        wrapper.unmount();
    });

    it('rejects a linked entitlement response that omits the expected account id', async () => {
        const response = entitlements('buyer-a', 'wrong.plugin');
        const { accountId: _accountId, ...withoutAccount } = response;
        fetchMock.mockResolvedValue(withoutAccount);
        const wrapper = mount(LibraryHome, { global: { stubs } });
        const library = libraryHolder.current as { state: ReturnType<typeof ref<string>>; link: ReturnType<typeof ref<ReturnType<typeof linked> | null>> };
        library.link.value = linked('link-a', 'buyer-a');
        library.state.value = 'linked';
        await flush();

        expect(wrapper.text()).not.toContain('wrong.plugin');
        expect(wrapper.text()).toContain('Library link changed');
        wrapper.unmount();
    });

    it('lets an ordinary buyer create a guarded install request for their acquired release', async () => {
        (installerHolder.current as { canInstall: ReturnType<typeof ref<boolean>> }).canInstall.value = false;
        fetchMock.mockImplementation((url: string) => url === '/api/plugins/library/entitlements'
            ? Promise.resolve(entitlements('buyer-a', 'sample.plugin'))
            : Promise.resolve({ request: { id: `lir_${'a'.repeat(32)}` } }));
        const wrapper = mount(LibraryHome, { global: { stubs } });
        const library = libraryHolder.current as { state: ReturnType<typeof ref<string>>; link: ReturnType<typeof ref<ReturnType<typeof linked> | null>> };
        library.link.value = linked('link-a', 'buyer-a');
        library.state.value = 'linked';
        await flush();
        const request = wrapper.findAll('button').find((button) => button.text().includes('Request installation'));
        expect(request).toBeDefined();
        await request!.trigger('click');
        await flush();
        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/library/install-requests', expect.objectContaining({
            method: 'POST',
            headers: { 'x-or3-cloud-intent': 'mutation', 'Content-Type': 'application/json' },
            body: { releaseId: 'rel_sample.plugin', pluginId: 'sample.plugin', version: '1.2.3' },
        }));
        expect(wrapper.text()).toContain('Request sent');
        wrapper.unmount();
    });
});

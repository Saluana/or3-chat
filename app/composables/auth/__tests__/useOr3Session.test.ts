import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useOr3Session } from '../useSession';

const pendingRef = ref(true);
const dataRef = ref({
    session: {
        authenticated: true,
        user: { id: 'user-1' },
    },
});

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: true } }),
}));

vi.mock('../useSessionContext', () => ({
    useSessionContext: () => ({
        data: dataRef,
        pending: pendingRef,
    }),
}));

describe('useOr3Session', () => {
    it('computes isLoaded from pending', async () => {
        const session = useOr3Session();
        expect(session.isLoaded.value).toBe(false);
        pendingRef.value = false;
        await nextTick();
        expect(session.isLoaded.value).toBe(true);
    });
});

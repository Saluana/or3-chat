import type { SessionContext } from '~/core/hooks/hook-types';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    type LockPageRuntimeConfig,
    useLockPageRuntimeConfig,
} from './runtime';

export type LockPageAccessReason =
    | 'disabled'
    | 'ssr-auth-disabled'
    | 'authenticated'
    | 'forbidden'
    | 'guest-allowed'
    | 'unauthenticated'
    | 'session-error';

export interface LockPageAccessResult {
    allowed: boolean;
    reason: LockPageAccessReason;
    session: SessionContext | null;
}

export function evaluateLockPageAccess(input: {
    config: LockPageRuntimeConfig;
    session: SessionContext | null;
    appAccessAllowed?: boolean;
    hadSessionError?: boolean;
}): LockPageAccessResult {
    const {
        config,
        session,
        appAccessAllowed,
        hadSessionError = false,
    } = input;

    if (!config.ssrAuthEnabled) {
        return {
            allowed: true,
            reason: 'ssr-auth-disabled',
            session,
        };
    }

    if (!config.enabled) {
        return {
            allowed: true,
            reason: 'disabled',
            session,
        };
    }

    if (hadSessionError) {
        return {
            allowed: false,
            reason: 'session-error',
            session,
        };
    }

    if (session?.authenticated) {
        if (appAccessAllowed === false) {
            return {
                allowed: false,
                reason: 'forbidden',
                session,
            };
        }

        return {
            allowed: true,
            reason: 'authenticated',
            session,
        };
    }

    if (config.guestAccessEnabled) {
        return {
            allowed: true,
            reason: 'guest-allowed',
            session,
        };
    }

    return {
        allowed: false,
        reason: 'unauthenticated',
        session,
    };
}

export async function resolveLockPageAccess(): Promise<LockPageAccessResult> {
    const config = useLockPageRuntimeConfig();
    const sessionState = useSessionContext();
    const cachedPayload = sessionState.data.value;
    const cachedSession = cachedPayload?.session ?? null;
    const cachedAuthenticated = cachedSession?.authenticated === true;

    if (!config.ssrAuthEnabled || !config.enabled) {
        return evaluateLockPageAccess({
            config,
            session: cachedSession,
            appAccessAllowed: cachedPayload?.appAccessAllowed,
        });
    }

    let hadSessionError = !cachedAuthenticated && Boolean(sessionState.error.value);

    try {
        if (!sessionState.data.value && !hadSessionError) {
            await sessionState.refresh();
            hadSessionError = false;
        }
    } catch {
        hadSessionError = true;
    }

    const payload = sessionState.data.value;
    const session = payload?.session ?? null;
    return evaluateLockPageAccess({
        config,
        session,
        appAccessAllowed: payload?.appAccessAllowed,
        hadSessionError:
            hadSessionError ||
            (!session?.authenticated && Boolean(sessionState.error.value)),
    });
}

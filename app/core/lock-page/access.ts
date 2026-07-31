import { useState } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    type LockPageRuntimeConfig,
    useLockPageRuntimeConfig,
} from './runtime';

const LOCK_PAGE_SESSION_TTL_MS = 5_000;

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
    errorMessage?: string;
}

function getSessionValidationState() {
    const validatedAt = useState<number>('lock-page-session-validated-at', () => 0);
    return { validatedAt };
}

function extractErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    return undefined;
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
    const { validatedAt } = getSessionValidationState();
    const cachedPayload = sessionState.data.value;
    const cachedSession = cachedPayload?.session ?? null;

    if (!config.ssrAuthEnabled || !config.enabled) {
        return evaluateLockPageAccess({
            config,
            session: cachedSession,
            appAccessAllowed: cachedPayload?.appAccessAllowed,
        });
    }

    const now = Date.now();
    const shouldRefresh =
        !sessionState.data.value ||
        now - validatedAt.value > LOCK_PAGE_SESSION_TTL_MS;

    let hadSessionError = false;
    let errorMessage = extractErrorMessage(sessionState.error.value);

    try {
        if (shouldRefresh && !sessionState.pending.value) {
            await sessionState.refresh();
            validatedAt.value = Date.now();
            errorMessage = undefined;
        }
    } catch (error) {
        hadSessionError = true;
        validatedAt.value = Date.now();
        errorMessage = extractErrorMessage(error) ?? errorMessage;
    }

    const payload = sessionState.data.value;
    const session = payload?.session ?? null;
    const result = evaluateLockPageAccess({
        config,
        session,
        appAccessAllowed: payload?.appAccessAllowed,
        hadSessionError,
    });

    return errorMessage ? { ...result, errorMessage } : result;
}

/**
 * Client-side session recovery registry.
 *
 * Auth providers can register a recovery callback (e.g. silent refresh) that
 * the host session context invokes when `/api/auth/session` returns null.
 * Survives HMR via globalThis.
 */

export type ClientSessionRecovery = () => boolean | Promise<boolean>;

const GLOBAL_KEY = '__or3_client_session_recovery__';

type RecoveryRegistry = {
  recover?: ClientSessionRecovery;
};

function getRegistry(): RecoveryRegistry {
  const globalAny = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: RecoveryRegistry;
  };
  if (!globalAny[GLOBAL_KEY]) {
    globalAny[GLOBAL_KEY] = {};
  }
  return globalAny[GLOBAL_KEY]!;
}

export function registerClientSessionRecovery(recover: ClientSessionRecovery): void {
  getRegistry().recover = recover;
}

/** Attempt provider-registered recovery. Returns false when none is registered. */
export async function recoverClientSession(): Promise<boolean> {
  const recover = getRegistry().recover;
  if (!recover) {
    return false;
  }
  return await recover();
}

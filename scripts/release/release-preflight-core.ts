import { MANAGED_PROFILE_SHARED_ENV } from '../../shared/cloud/wizard/managed-profile-contract';

/** A release check must not inherit application settings or developer secrets. */
export function releaseCheckEnvironment(caller: NodeJS.ProcessEnv): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'SYSTEMROOT']) {
        if (caller[key] !== undefined) env[key] = caller[key]!;
    }
    return {
        ...env,
        ...MANAGED_PROFILE_SHARED_ENV,
        CI: '1',
        OR3_BASIC_AUTH_DB_PATH: '/tmp/or3-build/auth.sqlite',
        OR3_BASIC_AUTH_JWT_SECRET: 'or3-build-only-jwt-secret-not-for-runtime',
        OR3_BASIC_AUTH_REFRESH_SECRET: 'or3-build-only-refresh-secret-not-for-runtime',
        OR3_SQLITE_DB_PATH: '/tmp/or3-build/sync.sqlite',
        OR3_STORAGE_FS_ROOT: '/tmp/or3-build/storage',
        OR3_STORAGE_FS_TOKEN_SECRET: 'or3-build-only-storage-token-not-for-runtime',
    };
}

export type ReleaseVersionContract = {
    requested: string;
    root: string;
    lock: string | undefined;
    lockRoot: string | undefined;
    launchLock: string | undefined;
    launchLockRoot: string | undefined;
    cloud: string;
    cli: string | undefined;
};

export function assertReleaseVersionContract(contract: ReleaseVersionContract): void {
    if (!/^\d+\.\d+\.\d+$/.test(contract.requested)) {
        throw new Error(`Release version must be an exact stable semantic version, got ${contract.requested}.`);
    }
    const surfaces = ['root', 'lock', 'lockRoot', 'launchLock', 'launchLockRoot', 'cloud', 'cli'] as const;
    const mismatches = surfaces
        .filter(key => contract[key] !== contract.requested)
        .map(key => `${key}=${contract[key] ?? 'missing'}`);
    if (mismatches.length) {
        throw new Error(`Release version ${contract.requested} is not aligned: ${mismatches.join(', ')}.`);
    }
}

export function isRegistryNotFound(output: string): boolean {
    return /\bE404\b|\b404 Not Found\b|manifest unknown|name unknown|no such manifest/i.test(output);
}

export function assertCleanStatus(status: string): void {
    if (status.trim()) {
        throw new Error(`Release preparation requires a clean isolated worktree. Dirty entries:\n${status.trim()}`);
    }
}

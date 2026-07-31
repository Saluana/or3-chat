import { join, resolve } from 'node:path';

const DEFAULT_ADMIN_DATA_DIR = '.data';

export function resolveAdminDataDir(
    configuredDir = process.env.OR3_ADMIN_DATA_DIR
): string {
    const selectedDir = configuredDir?.trim() || DEFAULT_ADMIN_DATA_DIR;
    return resolve(selectedDir);
}

export function resolveAdminCredentialsPath(): string {
    return join(resolveAdminDataDir(), 'admin-credentials.json');
}

export function resolveAdminJwtSecretPath(): string {
    return join(resolveAdminDataDir(), 'admin-jwt-secret');
}

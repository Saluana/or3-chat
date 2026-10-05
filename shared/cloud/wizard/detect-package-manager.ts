/** Browser-safe package manager detection; process execution lives in package-manager.ts. */
export function detectPackageManager(
    userAgent = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.npm_config_user_agent
): 'bun' | 'npm' {
    return userAgent?.trim().toLowerCase().startsWith('bun/') ? 'bun' : 'npm';
}

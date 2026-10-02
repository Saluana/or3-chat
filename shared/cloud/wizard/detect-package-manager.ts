/** Browser-safe package manager detection; process execution lives in package-manager.ts. */
export function detectPackageManager(
    userAgent = typeof process !== 'undefined' ? process.env?.npm_config_user_agent : undefined
): 'bun' | 'npm' {
    return userAgent?.trim().toLowerCase().startsWith('bun/') ? 'bun' : 'npm';
}

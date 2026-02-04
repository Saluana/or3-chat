const hotZones = [
    'app/pages',
    'app/plugins',
    'server/api',
    'server/middleware',
    'server/plugins',
];

const bannedImports = [
    '@clerk/nuxt',
    '@clerk/nuxt/server',
    'convex',
    'convex-vue',
    'convex-nuxt',
    '~~/convex/_generated',
    'convex/_generated',
];

function runRg(pattern: string): boolean {
    const result = Bun.spawnSync(['rg', '-n', pattern, ...hotZones], {
        stdout: 'pipe',
        stderr: 'pipe',
    });

    if (result.exitCode === 0) {
        const output = result.stdout.toString().trim();
        if (output.length > 0) {
            console.error(`\\n[provider-decoupling] Banned import detected: ${pattern}`);
            console.error(output);
            return false;
        }
    }

    return true;
}

let ok = true;
for (const pattern of bannedImports) {
    ok = runRg(pattern) && ok;
}

if (!ok) {
    console.error('\\n[provider-decoupling] Remove provider SDK imports from hot zones.');
    process.exit(1);
}

console.log('[provider-decoupling] Provider import check passed.');

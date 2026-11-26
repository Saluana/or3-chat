type ClientChunk = {
    file: string;
    isEntry?: boolean;
    imports?: string[];
    css?: string[];
};

function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Build a neutral SPA shell from the same Nuxt runtime config and assets as the app. */
export function renderOfflineShell(
    manifest: Record<string, ClientChunk>,
    config: { public: unknown; app: { baseURL: string; buildAssetsDir: string } },
    hostImports: Record<string, string>,
    colorModeScript: string,
): string {
    const entries = Object.entries(manifest).filter(([, item]) => item.isEntry && /\.m?js$/.test(item.file));
    if (entries.length !== 1 || !config.public || !config.app) {
        throw new Error('Cannot build offline shell: expected one Nuxt client entry and public runtime config.');
    }
    const assetPrefix = config.app.baseURL.replace(/\/$/, '') + '/' + config.app.buildAssetsDir.replace(/^\/|\/$/g, '');
    const asset = (name: string) => {
        if (!/^[\w./-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) {
            throw new Error('Invalid offline shell asset path.');
        }
        return assetPrefix + '/' + name;
    };
    const [entryKey, entry] = entries[0]!;
    const seen = new Set<string>();
    const css = new Set<string>();
    function collect(key: string) {
        if (seen.has(key)) return;
        seen.add(key);
        const chunk = manifest[key];
        if (!chunk) return;
        for (const dependency of chunk.imports ?? []) collect(dependency);
        for (const sheet of chunk.css ?? []) css.add(asset(sheet));
    }
    collect(entryKey);
    const entryUrl = asset(entry.file);
    const imports = { ...hostImports, '#entry': entryUrl };
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        + '<title>OR3</title><link rel="manifest" href="./manifest.webmanifest">'
        + '<style>@layer properties, theme, base, components, utilities;</style>'
        + [...css].map(url => `<link rel="stylesheet" href="${url}" crossorigin>`).join('')
        + `<script type="importmap">${scriptJson({ imports })}</script>`
        + `<script>${colorModeScript.replace(/<\/script/gi, '<\\/script')}</script>`
        + '</head><body><div id="__nuxt"></div><div id="teleports"></div>'
        + '<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="false" id="__NUXT_DATA__">[{"serverRendered":1},false]</script>'
        + `<script>window.__NUXT__={config:${scriptJson({ public: config.public, app: config.app })}};</script>`
        + `<script type="module" src="${entryUrl}" crossorigin></script></body></html>`;
}

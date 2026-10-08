import type { PluginToolCardManifestEntry } from './manifest';
export const MAX_CARD_BUNDLE_BYTES = 1536 * 1024;
export function isToolCardEmbedOrigin(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 255 || value.includes('*'))
        return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            url.origin === value &&
            !url.username &&
            !url.password &&
            !url.hostname.includes(':') &&
            !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
            url.hostname.includes('.')
        );
    } catch {
        return false;
    }
}
export function toolCardManifestProblems(manifest: {
    id?: unknown;
    trust?: unknown;
    requestedGrants?: unknown;
    toolCards?: unknown;
}): { path: (string | number)[]; message: string }[] {
    const out: { path: (string | number)[]; message: string }[] = [];
    const issue = (path: (string | number)[], message: string) =>
        out.push({ path: ['toolCards', ...path], message });
    if (manifest.toolCards === undefined) return out;
    if (manifest.trust !== 'isolated-client')
        issue([], 'toolCards is only supported for isolated-client packages');
    const cards = manifest.toolCards;
    if (!Array.isArray(cards) || cards.length > 16) {
        issue([], 'Declare at most 16 tool cards');
        return out;
    }
    const grants = Array.isArray(manifest.requestedGrants)
        ? manifest.requestedGrants
        : [];
    if (cards.length && !grants.includes('chat.tool.card'))
        issue([], 'Tool cards require chat.tool.card');
    const prefix = String(manifest.id).replace(/[^a-z0-9]/g, '_') + '_';
    const ids = new Set();
    const tools = new Set();
    for (const [index, raw] of cards.entries()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            issue([index], 'Invalid card entry');
            continue;
        }
        const card = raw as Record<string, unknown>;
        for (const key of Object.keys(card))
            if (
                ![
                    'id',
                    'tool',
                    'entry',
                    'label',
                    'placement',
                    'renderWhile',
                    'chrome',
                    'minHeight',
                    'embeds'
                ].includes(key)
            )
                issue([index, key], 'Unknown card field');
        if (
            typeof card.id !== 'string' ||
            !/^[a-z][a-z0-9-]{0,31}$/.test(card.id) ||
            ids.has(card.id)
        )
            issue([index, 'id'], 'Card IDs must be unique lowercase slugs');
        ids.add(card.id);
        if (
            typeof card.tool !== 'string' ||
            !/^[a-zA-Z0-9_]{1,64}$/.test(card.tool) ||
            !card.tool.startsWith(prefix) ||
            tools.has(card.tool)
        )
            issue([index, 'tool'], 'Card tools must be unique and namespaced');
        tools.add(card.tool);
        if (
            typeof card.entry !== 'string' ||
            !/^[a-zA-Z0-9_./-]+\.(?:m?js)$/.test(card.entry) ||
            card.entry.startsWith('/') ||
            card.entry.split('/').some((part) => !part || part === '.' || part === '..')
        )
            issue(
                [index, 'entry'],
                'Card entry must be a safe package-relative .js or .mjs path'
            );
        if (
            card.label !== undefined &&
            (typeof card.label !== 'string' ||
                !card.label.trim() ||
                card.label.length > 40)
        )
            issue([index, 'label'], 'Card label must contain 1–40 characters');
        for (const [key, options] of [
            ['placement', ['inline', 'end']],
            ['renderWhile', ['complete', 'always']],
            ['chrome', ['card', 'none']]
        ] as const)
            if (card[key] !== undefined && !options.includes(card[key] as never))
                issue([index, key], 'Invalid presentation option');
        if (
            card.minHeight !== undefined &&
            (typeof card.minHeight !== 'number' ||
                !Number.isFinite(card.minHeight) ||
                card.minHeight < 48 ||
                card.minHeight > 720)
        )
            issue([index, 'minHeight'], 'Card minHeight must be 48–720');
        if (card.embeds !== undefined) {
            if (!grants.includes('chat.tool.card.embed'))
                issue([index, 'embeds'], 'Embeds require chat.tool.card.embed');
            if (
                !card.embeds ||
                typeof card.embeds !== 'object' ||
                Array.isArray(card.embeds)
            ) {
                issue([index, 'embeds'], 'Invalid embed declaration');
                continue;
            }
            let count = 0;
            for (const [kind, origins] of Object.entries(card.embeds)) {
                if (!['frames', 'images'].includes(kind) || !Array.isArray(origins)) {
                    issue([index, 'embeds', kind], 'Invalid embed list');
                    continue;
                }
                count += origins.length;
                for (const [n, origin] of origins.entries())
                    if (!isToolCardEmbedOrigin(origin))
                        issue(
                            [index, 'embeds', kind, n],
                            'Use an exact HTTPS origin with no path, wildcard or IP literal'
                        );
            }
            if (count > 8) issue([index, 'embeds'], 'Declare at most 8 embed origins');
        }
    }
    return out;
}
/** Includes cards/embeds in the existing authority expansion comparison. */
export function toolCardAuthorityEntries(
    cards?: readonly PluginToolCardManifestEntry[]
): string[] {
    return (cards ?? [])
        .flatMap((card) => [
            'tool-card:' +
                JSON.stringify({
                    id: card.id,
                    tool: card.tool,
                    label: card.label ?? card.tool
                }),
            ...(card.embeds?.frames ?? []).map(
                (origin) => 'tool-card-frame:' + card.id + ':' + origin
            ),
            ...(card.embeds?.images ?? []).map(
                (origin) => 'tool-card-image:' + card.id + ':' + origin
            )
        ])
        .sort();
}

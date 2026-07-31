import type {
    PaletteCommandDefinition,
    PalettePostSourceDefinition,
} from './types';

/** Mirrors `INTERNAL_POST_TYPES` from `app/db/posts` without importing Dexie. */
export const PALETTE_EXCLUDED_POST_TYPES = new Set([
    'or3:document-revision',
    'or3:document-revision-chunk',
]);

const ID_RE = /^[a-z0-9-]+$/;
const TARGET_ID_RE = /^[a-z0-9][a-z0-9._:-]*$/;
const ALIAS_RE = /^[a-z0-9-]{2,32}$/;
const MAX_META_KEYS = 16;

export type PaletteValidationResult =
    | { ok: true }
    | { ok: false; message: string };

export function validatePaletteId(id: string, label = 'id'): PaletteValidationResult {
    if (typeof id !== 'string' || !id) {
        return { ok: false, message: `${label} is required` };
    }
    if (!ID_RE.test(id)) {
        return {
            ok: false,
            message: `${label} must be lowercase alphanumeric with hyphens`,
        };
    }
    return { ok: true };
}

export function validatePaletteAlias(alias: string): PaletteValidationResult {
    if (typeof alias !== 'string' || !alias) {
        return { ok: false, message: 'alias is required' };
    }
    const normalized = alias.trim().toLowerCase();
    if (!ALIAS_RE.test(normalized)) {
        return {
            ok: false,
            message: 'alias must be 2–32 lowercase alphanumeric characters with hyphens',
        };
    }
    return { ok: true };
}

function validateTargetId(
    id: string,
    label: string
): PaletteValidationResult {
    if (typeof id !== 'string' || !TARGET_ID_RE.test(id)) {
        return {
            ok: false,
            message: `${label} must be a lowercase contribution identifier`,
        };
    }
    return { ok: true };
}

export function validatePostType(postType: string): PaletteValidationResult {
    if (typeof postType !== 'string' || !postType.trim()) {
        return { ok: false, message: 'postType is required' };
    }
    if (PALETTE_EXCLUDED_POST_TYPES.has(postType)) {
        return {
            ok: false,
            message: `postType "${postType}" is reserved for internal revisions`,
        };
    }
    return { ok: true };
}

export function validateMetaKeys(
    metaKeys: readonly string[] | undefined
): PaletteValidationResult {
    if (!metaKeys) return { ok: true };
    if (metaKeys.length > MAX_META_KEYS) {
        return {
            ok: false,
            message: `metaKeys may contain at most ${MAX_META_KEYS} entries`,
        };
    }
    const seen = new Set<string>();
    for (const key of metaKeys) {
        if (typeof key !== 'string' || !key.trim()) {
            return { ok: false, message: 'metaKeys entries must be non-empty strings' };
        }
        if (seen.has(key)) {
            return { ok: false, message: `duplicate metaKey "${key}"` };
        }
        seen.add(key);
    }
    return { ok: true };
}

export function validatePalettePostSourceDefinition(
    definition: PalettePostSourceDefinition
): PaletteValidationResult {
    const idCheck = validatePaletteId(definition.id, 'id');
    if (!idCheck.ok) return idCheck;

    const categoryCheck = validatePaletteId(definition.categoryId, 'categoryId');
    if (!categoryCheck.ok) return categoryCheck;

    if (!definition.label?.trim()) {
        return { ok: false, message: 'label is required' };
    }

    const postTypeCheck = validatePostType(definition.postType);
    if (!postTypeCheck.ok) return postTypeCheck;

    if (!definition.filterAliases?.length) {
        return { ok: false, message: 'filterAliases must include at least one alias' };
    }

    const seenAliases = new Set<string>();
    for (const alias of definition.filterAliases) {
        const aliasCheck = validatePaletteAlias(alias);
        if (!aliasCheck.ok) return aliasCheck;
        const normalized = alias.trim().toLowerCase();
        if (seenAliases.has(normalized)) {
            return { ok: false, message: `duplicate alias "${normalized}"` };
        }
        seenAliases.add(normalized);
    }

    const metaCheck = validateMetaKeys(definition.metaKeys);
    if (!metaCheck.ok) return metaCheck;

    if (
        !definition.openTarget ||
        (definition.openTarget.kind !== 'pane-app' &&
            definition.openTarget.kind !== 'dashboard')
    ) {
        return { ok: false, message: 'openTarget must be pane-app or dashboard' };
    }

    if (definition.openTarget.kind === 'pane-app') {
        const appCheck = validateTargetId(
            definition.openTarget.appId,
            'openTarget.appId'
        );
        if (!appCheck.ok) return appCheck;
    } else {
        const pluginCheck = validateTargetId(
            definition.openTarget.pluginId,
            'openTarget.pluginId'
        );
        if (!pluginCheck.ok) return pluginCheck;
    }

    return { ok: true };
}

export function validatePaletteCommandDefinition(
    definition: PaletteCommandDefinition
): PaletteValidationResult {
    const idCheck = validatePaletteId(definition.id, 'id');
    if (!idCheck.ok) return idCheck;
    if (!definition.label?.trim()) {
        return { ok: false, message: 'label is required' };
    }
    return { ok: true };
}

export function normalizeAlias(alias: string): string {
    return alias.trim().toLowerCase();
}

/**
 * @module app/core/theme/background-image-library
 *
 * Purpose:
 * Shared helpers for choosing stored workspace images as theme backgrounds.
 * Used by the dashboard image picker and the chat appearance tools so both
 * write the same `internal-file://<hash>` layer shape.
 *
 * Constraints:
 * - Queries are bounded and use the gallery indexes; blobs are never read here.
 * - Only trusted raster images (png/jpeg/webp/gif) in the current workspace DB qualify.
 */
import Dexie from 'dexie';
import { getDb, type Or3DB } from '~/db/client';
import { getImageMetasByHashes, listImagePage, listImageSummaries } from '~/db/files-select';
import { parseFileHashes } from '~/db/files-util';
import type { FileMeta } from '~/db/schema';
import type { UserBackgroundLayer, UserThemeOverrides } from './user-overrides-types';

/** Background areas a user can decorate. */
export const BACKGROUND_AREAS = ['content', 'overlay', 'sidebar'] as const;
export type BackgroundArea = (typeof BACKGROUND_AREAS)[number];

export const BACKGROUND_AREA_LABELS: Record<BackgroundArea, string> = {
    content: 'Content Layer 1',
    overlay: 'Content Layer 2',
    sidebar: 'Sidebar Background',
};

/** Theme pattern each area falls back to ("theme" in the chat tool). */
export const BACKGROUND_AREA_PATTERNS: Record<BackgroundArea, { src: string; opacity: number }> = {
    content: { src: '/bg-repeat.v2.webp', opacity: 0.08 },
    overlay: { src: '/bg-repeat-2.v2.webp', opacity: 0.125 },
    sidebar: { src: '/sidebar-repeater.v2.webp', opacity: 0.1 },
};

/** Opacity floor so a 0% leftover from "Remove" does not hide a newly chosen image. */
export const MIN_CHOSEN_IMAGE_OPACITY = 0.35;

const TOKEN_PREFIX = 'internal-file://';

export function internalFileToken(hash: string): string {
    return `${TOKEN_PREFIX}${hash}`;
}

export function hashFromBackgroundUrl(url: string | null | undefined): string | null {
    return url?.startsWith(TOKEN_PREFIX) ? url.slice(TOKEN_PREFIX.length) : null;
}

export function readBackgroundArea(
    overrides: UserThemeOverrides,
    area: BackgroundArea
): Partial<UserBackgroundLayer> | undefined {
    const backgrounds = overrides.backgrounds;
    if (area === 'sidebar') return backgrounds?.sidebar;
    return area === 'content' ? backgrounds?.content?.base : backgrounds?.content?.overlay;
}

/** Build one override patch that writes each given layer into its area. */
export function backgroundAreasPatch(
    layers: Partial<Record<BackgroundArea, Partial<UserBackgroundLayer>>>,
    extra: { enabled?: boolean } = {}
): Partial<UserThemeOverrides> {
    const backgrounds: NonNullable<UserThemeOverrides['backgrounds']> = { ...extra };
    if (layers.sidebar) backgrounds.sidebar = layers.sidebar;
    if (layers.content || layers.overlay) {
        backgrounds.content = {
            ...(layers.content ? { base: layers.content } : {}),
            ...(layers.overlay ? { overlay: layers.overlay } : {}),
        };
    }
    return { backgrounds };
}

/** Build the override patch that writes `layer` into one area. */
export function backgroundAreaPatch(
    area: BackgroundArea,
    layer: Partial<UserBackgroundLayer>
): Partial<UserThemeOverrides> {
    return backgroundAreasPatch({ [area]: layer });
}

/** Layer values for a chosen photo: a single cover image with a visible opacity. */
export function chosenImageLayer(
    hash: string,
    currentOpacity: number | undefined
): Partial<UserBackgroundLayer> {
    return {
        url: internalFileToken(hash),
        fit: true,
        repeat: 'no-repeat',
        opacity: currentOpacity && currentOpacity > 0 ? currentOpacity : MIN_CHOSEN_IMAGE_OPACITY,
    };
}

export interface BackgroundImagePage {
    items: FileMeta[];
    hasMore: boolean;
}

/**
 * List active workspace images, newest first. A query filters by file name
 * (case-insensitive substring) over the compact covering index.
 */
export async function listBackgroundImages(input: {
    limit: number;
    query?: string;
}): Promise<BackgroundImagePage> {
    const limit = Math.max(1, Math.floor(input.limit));
    const query = input.query?.trim().toLowerCase() ?? '';
    if (!query) {
        const page = await listImagePage({ state: 'active', sort: 'newest', limit });
        return { items: page.items, hasMore: page.hasMore };
    }
    const matches = (await listImageSummaries())
        .filter((row) => row.state === 'active' && row.name.toLowerCase().includes(query))
        .sort((a, b) => b.created_at - a.created_at || (a.hash < b.hash ? -1 : 1));
    const items = await getImageMetasByHashes(matches.slice(0, limit).map((row) => row.hash));
    return { items: items.filter((item) => item.deleted !== true), hasMore: matches.length > limit };
}

/** How many recent messages are scanned for chat images. */
const THREAD_SCAN_LIMIT = 40;

/** Image hashes attached to a thread's recent messages, newest first. */
export async function listThreadImageHashes(
    threadId: string,
    db: Or3DB = getDb()
): Promise<string[]> {
    const rows = await db.messages
        .where('[thread_id+index]')
        .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
        .reverse()
        .limit(THREAD_SCAN_LIMIT)
        .toArray();
    const seen = new Set<string>();
    const hashes: string[] = [];
    for (const row of rows) {
        if (row.deleted) continue;
        // Later attachments in one message are newer than earlier ones.
        for (const hash of parseFileHashes(row.file_hashes).reverse()) {
            if (seen.has(hash)) continue;
            seen.add(hash);
            hashes.push(hash);
        }
    }
    return hashes;
}

/** Return the meta when `hash` is an active raster image in this workspace. */
export async function getBackgroundImageMeta(hash: string): Promise<FileMeta | null> {
    const [meta] = await getImageMetasByHashes([hash]);
    return meta && meta.deleted !== true ? meta : null;
}

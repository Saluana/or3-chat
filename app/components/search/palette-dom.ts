import {
    computeTimeGroup,
    formatTimeDisplay,
} from '~/utils/sidebar/sidebarTimeUtils';

export const PALETTE_LISTBOX_ID = 'or3-palette-listbox';
export const PALETTE_INPUT_ID = 'or3-palette-input';

/** Stable option id derived from the result key so it survives re-renders. */
export function paletteOptionDomId(key: string): string {
    return `or3-palette-option-${encodeURIComponent(key)}`;
}

/** Short recency label for a palette row (timestamps are epoch seconds). */
export function paletteTimeLabel(updatedAt?: number): string {
    if (!updatedAt) return '';
    return formatTimeDisplay(updatedAt, computeTimeGroup(updatedAt));
}

/** Human-readable metadata key, e.g. `mime_type` -> `Mime type`. */
export function paletteMetaLabel(key: string): string {
    const spaced = key.replace(/[_.-]+/g, ' ').trim();
    if (!spaced) return key;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function paletteMetaValue(
    value: string | number | boolean | null
): string {
    if (value === null) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

export interface PaletteMetaRow {
    key: string;
    label: string;
    value: string;
}

const META_ROW_LIMIT = 6;
const META_LABELS: Record<string, string> = {
    mime_type: 'Type',
    size_bytes: 'Size',
};
// Folded into a single "Dimensions" row, so they are never listed on their own.
const META_MERGED_KEYS = new Set(['width', 'height']);

/**
 * Metadata rows for the preview panel. Raw source keys are technical
 * (`size_bytes`, `width`), so they are relabelled and folded where a pair reads
 * better as one line.
 */
export function paletteMetaRows(
    metadata: Readonly<Record<string, string | number | boolean | null>>
): PaletteMetaRow[] {
    const rows: PaletteMetaRow[] = [];
    const dimensions = paletteDimensions(metadata);
    if (dimensions) {
        rows.push({ key: 'dimensions', label: 'Dimensions', value: dimensions });
    }
    for (const [key, value] of Object.entries(metadata)) {
        if (rows.length >= META_ROW_LIMIT) break;
        if (value === null || value === '') continue;
        if (META_MERGED_KEYS.has(key)) continue;
        rows.push({
            key,
            label: META_LABELS[key] ?? paletteMetaLabel(key),
            value:
                key === 'size_bytes' && typeof value === 'number'
                    ? paletteByteSize(value)
                    : paletteMetaValue(value),
        });
    }
    return rows;
}

function paletteDimensions(
    metadata: Readonly<Record<string, string | number | boolean | null>>
): string | null {
    const width = metadata['width'];
    const height = metadata['height'];
    if (typeof width !== 'number' || typeof height !== 'number') return null;
    if (width <= 0 || height <= 0) return null;
    return `${width} × ${height}`;
}

export function paletteByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

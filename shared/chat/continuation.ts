export const CONTINUE_TAIL_CHARS = 1200;
export const CONTINUATION_PREFIX = '>>';

export interface ContinuationDeltaNormalizer {
    push(value: unknown): string;
    finish(): string;
}

function needsContinuationBoundarySpace(
    previous: string,
    next: string
): boolean {
    if (!previous || !next || /\s$/.test(previous) || /^\s/.test(next)) {
        return false;
    }
    const last = previous.slice(-1);
    const first = next[0] ?? '';
    if ('([{<«“‘"`/\\-–—'.includes(last)) return false;
    if (',.…;:!?%)]}>»”’"\'`'.includes(first)) return false;
    return (
        /[\p{L}\p{N}.!?;:…)\]}>'"»”’]/u.test(last) &&
        /[\p{L}\p{N}]/u.test(first)
    );
}

/** Normalize the continuation marker, replay overlap, and join boundary once. */
export function createContinuationDeltaNormalizer(
    existingText: string,
    prefix = CONTINUATION_PREFIX
): ContinuationDeltaNormalizer {
    const overlapSource = existingText.slice(-CONTINUE_TAIL_CHARS);
    let prefixPending = prefix.length > 0;
    let prefixBuffer = '';
    let overlapPending = overlapSource.length > 0;
    let overlapBuffer = '';
    let boundaryPending = true;

    const withBoundary = (value: string): string => {
        if (!value || !boundaryPending) return value;
        boundaryPending = false;
        return needsContinuationBoundarySpace(existingText, value)
            ? ` ${value}`
            : value;
    };

    const resolveOverlap = (atEnd: boolean): string => {
        if (!overlapPending || !overlapBuffer) return '';
        const possibleSuffixes: string[] = [];
        for (let start = 0; start < overlapSource.length; start += 1) {
            const suffix = overlapSource.slice(start);
            if (suffix.startsWith(overlapBuffer)) possibleSuffixes.push(suffix);
        }
        if (
            !atEnd &&
            possibleSuffixes.some(
                (suffix) => suffix.length > overlapBuffer.length
            )
        ) {
            return '';
        }
        let overlap = 0;
        const max = Math.min(overlapSource.length, overlapBuffer.length);
        for (let size = max; size >= 2; size -= 1) {
            if (overlapBuffer.startsWith(overlapSource.slice(-size))) {
                overlap = size;
                break;
            }
        }
        const output = overlapBuffer.slice(overlap);
        overlapBuffer = '';
        overlapPending = false;
        return withBoundary(output);
    };

    const consumePrefix = (value: string, atEnd: boolean): string => {
        if (!prefixPending) return value;
        prefixBuffer += value;
        if (!atEnd && prefixBuffer.length < prefix.length) return '';
        if (prefixBuffer.startsWith(prefix)) {
            prefixBuffer = prefixBuffer.slice(prefix.length);
        }
        prefixPending = false;
        const output = prefixBuffer;
        prefixBuffer = '';
        return output;
    };

    return {
        push(value: unknown): string {
            if (typeof value !== 'string' || value.length === 0) return '';
            const unprefixed = consumePrefix(value, false);
            if (!unprefixed) return '';
            if (!overlapPending) return withBoundary(unprefixed);
            overlapBuffer += unprefixed;
            return resolveOverlap(false);
        },
        finish(): string {
            const unprefixed = consumePrefix('', true);
            if (unprefixed) overlapBuffer += unprefixed;
            return resolveOverlap(true);
        },
    };
}

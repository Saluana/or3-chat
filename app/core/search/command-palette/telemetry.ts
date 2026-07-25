import type { PaletteTelemetryEvent } from './types';

const FORBIDDEN_KEYS = new Set([
    'query',
    'term',
    'title',
    'snippet',
    'body',
    'content',
    'raw',
]);

type TelemetryListener = (event: PaletteTelemetryEvent) => void;

const listeners = new Set<TelemetryListener>();

export function subscribePaletteTelemetry(
    listener: TelemetryListener
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function emitPaletteTelemetry(event: PaletteTelemetryEvent): void {
    assertSafeTelemetry(event);
    for (const listener of [...listeners]) {
        try {
            listener(event);
        } catch {
            // Telemetry must never break search.
        }
    }
}

export function assertSafeTelemetry(event: PaletteTelemetryEvent): void {
    const json = JSON.stringify(event);
    for (const key of FORBIDDEN_KEYS) {
        // Only flag explicit property names, not values that happen to match.
        if (new RegExp(`"${key}"\\s*:`).test(json)) {
            throw new Error(
                `Palette telemetry must not include content field "${key}"`
            );
        }
    }
}

/** Test helper */
export function __resetPaletteTelemetryForTests(): void {
    listeners.clear();
}

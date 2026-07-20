import { HookDiagnostics } from './hook-diagnostics';
import type { HookEngine, HookKind } from './hook-engine-core';

export interface V1HookDiagnosticsAdapter {
    readonly diagnostics: HookDiagnostics;
    readonly facade: HookEngine['_diagnostics'];
    recordTiming(name: string, milliseconds: number): void;
    recordError(name: string): void;
}

/** Mutable V1 shape backed in parallel by bounded V2 metrics. */
export function createV1HookDiagnosticsAdapter(options: {
    callbacks(kind?: HookKind): number;
}): V1HookDiagnosticsAdapter {
    let timings: Record<string, number[]> = {};
    let errors: Record<string, number> = {};
    const diagnostics = new HookDiagnostics({
        legacySource: {
            read: () => ({ timings, errors }),
            reset(metric) {
                if (metric === undefined || metric === 'timing') timings = {};
                if (metric === undefined || metric === 'error') errors = {};
            },
        },
    });
    const facade = {
        callbacks: options.callbacks,
    } as HookEngine['_diagnostics'];

    Object.defineProperties(facade, {
        timings: {
            enumerable: true,
            configurable: false,
            get: () => timings,
            set: (next: Record<string, number[]>) => {
                timings = next;
            },
        },
        errors: {
            enumerable: true,
            configurable: false,
            get: () => errors,
            set: (next: Record<string, number>) => {
                errors = next;
            },
        },
    });

    return Object.freeze({
        diagnostics,
        facade,
        recordTiming(name: string, milliseconds: number) {
            if (Object.hasOwn(timings, name)) timings[name]!.push(milliseconds);
            else timings[name] = [milliseconds];
        },
        recordError(name: string) {
            errors[name] = Object.hasOwn(errors, name) ? errors[name]! + 1 : 1;
        },
    });
}

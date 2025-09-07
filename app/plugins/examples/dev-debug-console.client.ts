// Dev helper: ensure console.debug messages are visible even if browser "Verbose" is disabled.
// Maps console.debug to also emit a normal console.log (single line) so existing debug instrumentation shows up.
// Safe no-op in production build (guarded by import.meta.dev).
export default defineNuxtPlugin(() => {
    if (!import.meta.dev) return; // only in dev
    if (typeof window === 'undefined') return;
    try {
        const anyWin: any = window as any;
        if (anyWin.__or3ConsoleDebugPatched) return;
        anyWin.__or3ConsoleDebugPatched = true;
        const orig = console.debug?.bind(console) || console.log.bind(console);
        console.debug = (...args: any[]) => {
            try {
                console.log(...args);
            } catch {}
            try {
                orig(...args);
            } catch {}
        };
        console.log('[dev-debug-console] console.debug patched to also log');
    } catch {}
});

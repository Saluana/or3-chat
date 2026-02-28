import type { ThemeManifestEntry } from './theme-manifest';

export interface ThemeLoadState {
    loadedThemes: Set<string>;
    loadingThemes: Map<string, Promise<boolean>>;
}

export interface ThemeActivationResult {
    ok: boolean;
    activeTheme: string;
    reason:
        | 'requested'
        | 'requested-invalid'
        | 'requested-load-failed-fallback'
        | 'fallback-load-failed-kept-previous';
    error?: unknown;
}

export async function ensureThemeLoaded(
    themeName: string,
    opts: {
        manifestByName: Map<string, ThemeManifestEntry>;
        state: ThemeLoadState;
        registerTheme: (entry: ThemeManifestEntry) => Promise<void>;
    }
): Promise<boolean> {
    if (opts.state.loadedThemes.has(themeName)) {
        return true;
    }

    const inFlight = opts.state.loadingThemes.get(themeName);
    if (inFlight) {
        return inFlight;
    }

    const manifestEntry = opts.manifestByName.get(themeName);
    if (!manifestEntry) {
        return false;
    }

    const loadPromise = opts
        .registerTheme(manifestEntry)
        .then(() => {
            opts.state.loadedThemes.add(themeName);
            return true;
        })
        .catch(() => false)
        .finally(() => {
            opts.state.loadingThemes.delete(themeName);
        });

    opts.state.loadingThemes.set(themeName, loadPromise);
    return loadPromise;
}

export async function setActiveThemeSafe(
    requested: string,
    opts: {
        availableThemes: Set<string>;
        defaultTheme: string;
        previousTheme: string;
        ensureLoaded: (name: string) => Promise<boolean>;
    }
): Promise<ThemeActivationResult> {
    const preferred = opts.availableThemes.has(requested)
        ? requested
        : opts.defaultTheme;

    if (!opts.availableThemes.has(preferred)) {
        return {
            ok: false,
            activeTheme: opts.previousTheme,
            reason: 'fallback-load-failed-kept-previous',
        };
    }

    try {
        const loaded = await opts.ensureLoaded(preferred);
        if (loaded) {
            return {
                ok: true,
                activeTheme: preferred,
                reason:
                    preferred === requested ? 'requested' : 'requested-invalid',
            };
        }

        const fallbackLoaded = await opts.ensureLoaded(opts.defaultTheme);
        if (fallbackLoaded) {
            return {
                ok: true,
                activeTheme: opts.defaultTheme,
                reason: 'requested-load-failed-fallback',
            };
        }

        return {
            ok: false,
            activeTheme: opts.previousTheme,
            reason: 'fallback-load-failed-kept-previous',
        };
    } catch (error) {
        return {
            ok: false,
            activeTheme: opts.previousTheme,
            reason: 'fallback-load-failed-kept-previous',
            error,
        };
    }
}

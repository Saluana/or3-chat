---
artifact_id: 0f5e6d5e-2a29-4d61-94e3-6a9c2a0a5220
status: draft
owner: or3-chat
last_updated: 2026-02-01
---

# design.md

## Overview
The theme system is implemented via Nuxt plugins (client/server), a theme manifest, a runtime resolver, and per-theme assets (overrides + stylesheets). The issues in this folder indicate:
- Two sources of truth for defaults (`isDefault` vs runtime config) with silent overrides.
- Significant duplicated logic across client/server plugins.
- Several correctness/safety gaps (cookie regex, name normalization, unhandled rejections).
- Multiple memory leaks/unbounded caches (hooks, override cache, selector caches, icon registry, etc.).

This design focuses on refactoring toward a single shared theme loading/activation core, with platform adapters for DOM-only responsibilities.

## Architecture

### High-level flow
```mermaid
flowchart TD
  A[Nuxt plugin (client/server)] --> B[Theme manifest loader]
  A --> C[Default theme selector]
  A --> D[Theme activation orchestrator]
  D --> E[Theme module loader]
  D --> F[RuntimeResolver registry]
  D --> G[App config overrides registry]
  D --> H[IconRegistry]
  D --> I[Stylesheet loader (client only)]
  D --> J[CSS variable injector (client only)]
```

### Key design decisions
1. **Shared core, thin plugins:**
   - Extract shared functions into `app/theme/_shared/` modules.
   - Client/server plugins become wiring + environment-specific hooks.

2. **Single default selection function:**
   - A pure function selects the default theme given runtime config and manifest.
   - Dev-only warnings when config overrides manifest defaults.

3. **Bounded caches for runtime identifiers/selectors:**
   - Per-component override caches capped.
   - Selector caches capped (or cleared on HMR).
   - For caches that are truly finite, document why unbounded is acceptable.

4. **DOM operations are isolated and defensive:**
   - Stylesheet loading and CSS injection run only on client.
   - Both operations are resilient to errors.

## Components and Interfaces

### Shared constants
Create a shared constants module to remove hardcoded strings:

```ts
// app/theme/_shared/constants.ts
export const FALLBACK_THEME_NAME = 'retro';
export const THEME_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
```

### Default theme selection
```ts
// app/theme/_shared/default-theme.ts
export interface DefaultThemeInputs {
  manifestNames: string[];
  manifestDefaultName: string | null; // first entry with isDefault
  configuredDefaultName: string | null; // runtimeConfig.public.branding.defaultTheme
  fallbackThemeName: string; // from constants
}

export interface DefaultThemeDecision {
  defaultTheme: string;
  reason:
    | 'runtime-config'
    | 'manifest-isDefault'
    | 'first-manifest-entry'
    | 'fallback-constant';
  warnings: string[]; // dev-only use
}

export function pickDefaultTheme(inputs: DefaultThemeInputs): DefaultThemeDecision;
```

Behavior:
- Normalize `configuredDefaultName` via `sanitizeThemeName`.
- If it matches an available name, choose it.
- Else choose `manifestDefaultName` (if present).
- Else choose `manifestNames[0]`.
- Else choose `fallbackThemeName`.

Dev warning policy:
- If config overrides manifest default, return a warning string. Plugin decides whether to log (dev only).

### Theme name sanitization
```ts
// app/theme/_shared/theme-core.ts
export function sanitizeThemeName(
  themeName: string | null,
  availableThemes: Set<string>
): string | null {
  if (!themeName) return null;
  const normalized = themeName.toLowerCase();
  if (!THEME_NAME_PATTERN.test(normalized)) return null;
  if (!availableThemes.has(normalized)) return null;
  return normalized;
}
```

### Cookie parsing
Standardize on a shared cookie read helper.

```ts
// app/theme/_shared/theme-core.ts
export function readCookie(cookieHeader: string, name: string): string | null;
```

Client plugin uses `document.cookie` and this helper; server plugin uses request cookie header and this helper.

### Manifest loader result
Convert manifest load to return entries + errors to avoid silent failure.

```ts
// app/theme/_shared/theme-manifest.ts
export interface ThemeManifestError {
  path: string;
  error: unknown;
}

export interface ThemeManifestResult {
  entries: ThemeManifestEntry[];
  errors: ThemeManifestError[];
}

export async function loadThemeManifest(): Promise<ThemeManifestResult>;
```

### Shared theme loader / activation
Unify the duplicated `loadTheme`, `ensureThemeLoaded`, `getResolver`, and activation logic.

```ts
// app/theme/_shared/theme-loader.ts
export interface ThemeLoadState {
  loadedThemes: Set<string>;
  loadingThemes: Map<string, Promise<boolean>>; // in-flight
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
    // registry hooks for registering resolver/theme overrides/icons
    registerTheme: (entry: ThemeManifestEntry) => Promise<void>;
  }
): Promise<boolean>;

export async function setActiveThemeSafe(
  requested: string,
  opts: {
    availableThemes: Set<string>;
    defaultTheme: string;
    previousTheme: string;
    ensureLoaded: (name: string) => Promise<boolean>;
  }
): Promise<ThemeActivationResult>;
```

Notes:
- `ensureThemeLoaded` dedupes concurrent loads via `loadingThemes`.
- `setActiveThemeSafe` never throws; it returns structured result.

### Client-only stylesheet loader
Deduplicate per `(themeName, href)` via an in-flight map.

```ts
// app/theme/_shared/theme-manifest.ts (client-only section or separate module)
const inFlight = new Map<string, Promise<void>>();

export async function loadThemeStylesheets(entry: ThemeManifestEntry, overrideList?: string[]): Promise<void>;
```

Key behavior:
- Return existing in-flight promise if present.
- Avoid races by writing to `inFlight` before appending.

### Client-only CSS injection
Keep current strategy (one style tag per theme variables) but add a defensive wrapper:
- Guard `document.head`.
- Escape `</style>` sequences.
- Sanitize themeName for element IDs.

### Cache policy

#### useThemeOverrides per-component cache
Replace unbounded `entries: Map` growth with a capped cache per component instance:
- `MAX_CACHE_ENTRIES = 50` (tunable).
- Track access order for eviction.
- Reset cache when theme changes.

#### Selector cache
`compiler-core.ts` selector cache should be:
- Either bounded (simple Map-LRU) OR
- Cleared on HMR (dev only).

#### kebabCache
If the set of keys is bounded by known token names, document that unbounded is safe.

### Icon registry cleanup
Ensure both client and server cleanup paths call `iconRegistry.unregisterTheme(themeName)` when unloading inactive themes.

## Error handling
- No unhandled rejections from `setActiveTheme` or fallback paths.
- Manifest loader aggregates failures and logs once in dev.
- DOM operations return `boolean` or `void` but never throw.

## Testing strategy

### Unit tests (Vitest)
- Default theme selection precedence and warnings.
- `sanitizeThemeName` normalization and pattern rules.
- `readCookie` correctness for edge cases.
- `setActiveThemeSafe` behavior for requested invalid theme and fallback failures.
- Stylesheet loader dedupe: repeated calls produce one append (mock DOM).

### Integration tests
- Client plugin: theme switch flow doesn’t leak hooks across HMR-like re-instantiation.
- Server plugin: cleanup inactive themes on repeated SSR requests (simulated).

### Non-functional checks
- Ensure no SSR imports reference `document`.
- Ensure hot-path caches remain bounded under repeated resolution calls.

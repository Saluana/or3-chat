# OR3 Theme System Complete Audit

**Audit target:** OR3 Nuxt theme system snapshot packed in `or3-theme-system-audit.md`  
**Scope reviewed:** theme DSL, validation, compilation, runtime resolver, client and server theme plugins, selector runtime, icons, backgrounds and user overrides, custom components, theme administration and install pipeline, CLI/build tooling, built-in themes, documentation, and tests.  
**Method:** static source audit of the supplied Repomix snapshot, plus structural searches and similarity analysis across the extracted files. This was not a production trace, browser profile, dependency audit, or full repository test run.

---

## Executive verdict

The system has a strong core idea and several pieces worth keeping:

- `defineTheme()` is a sensible authoring boundary.
- The theme package convention is understandable.
- The resolver indexes overrides by component and caps its cache.
- The manifest, icon, background, custom-component, validation, and CLI subsystems show good intent.
- SSR support, user customization, theme installation, and typed targets are all valuable capabilities.

The clunky feeling is not caused by one bad algorithm. It comes from **too many independent subsystems believing they own theme application**:

1. `90.theme.client.ts` owns base-theme loading, persistence, CSS, app config, icons, backgrounds, selector classes, and component overrides.
2. `90.theme.server.ts` implements a similar but not identical version for SSR.
3. `useUserThemeOverrides.ts` independently applies and persists derived theme state.
4. `theme-overrides.client.ts` applies it again after mount.
5. `91.auto-theme.client.ts` performs DOM mutation for component overrides.
6. `92.theme-lazy-sync.client.ts` globally force-renders async components.
7. `page:finish` and `useThemeClasses()` independently re-run selector scans.
8. Build-time and runtime compilers separately transform the same theme definitions.

That creates state leakage, repeated work, races, hydration risk, dead APIs, and a documentation contract that is more capable than the implementation.

**The correct strategy is not a rewrite.** Keep the author-facing DSL and theme packages. Introduce one shared, transactional activation coordinator, migrate existing effects into it, then remove the competing compatibility paths. The work can be delivered incrementally.

---

## Immediate release blockers

| ID | Severity | Finding | Primary location |
|---|---:|---|---|
| ~~SEC-01~~ | Critical | ~~Existing extensions are overwritten even when `force` is false~~ | Resolved |
| ~~SEC-02~~ | Critical | ~~Uninstall can derive and recursively delete a path from an unsanitized request ID~~ | Resolved |
| ~~RUN-01~~ | Critical | ~~`v-theme` does not reliably apply Vue component props and does not re-resolve on a theme change~~ | Resolved with truthful DOM-only compatibility contract |
| ~~PERF-01~~ | Critical | ~~Every consumer of `useUserThemeOverrides()` installs another pair of deep watchers~~ | Resolved |
| ~~STATE-01~~ | High | ~~Client app-config patches accumulate across themes instead of being recomputed from the base config~~ | Resolved |
| ~~SSR-01~~ | High | ~~Server compilation omits `hasStyleSelectors`, so generated selector CSS is not linked during SSR~~ | Resolved |
| ~~SSR-02~~ | High | ~~The module-global icon registry is mutable across SSR requests~~ | Resolved |
| ~~RUN-02~~ | High | ~~Theme activation has no last-request-wins transaction, allowing stale async work to commit~~ | Resolved |

Fix these before doing broad cleanup.

---

# 1. Security audit

## ~~SEC-01: overwrite confirmation is bypassed~~

**Resolved:** duplicate installs reject unless `force` is explicit, and forced
replacement uses staging, backup, rollback, and regression coverage.

### Evidence

`installExtensionFromZip()` checks whether the target exists:

```ts
try {
    await fs.access(targetDir);
    if (!force) {
        throw new Error('Extension already installed');
    }
} catch {
    if (force === true) {
        await fs.rm(targetDir, { recursive: true, force: true });
    }
}
```

The intentionally thrown `Extension already installed` error is caught by the same `catch`, so execution continues. Later, the target is always removed before rename:

```ts
await fs.rm(targetDir, { recursive: true, force: true });
await fs.rename(tmpDir, targetDir);
```

### Impact

- The admin UI's replacement confirmation is not enforced server-side.
- A second install silently replaces an extension even with `force: false`.
- The API and documentation make a guarantee the implementation does not keep.
- This is especially dangerous for URL installs and automated clients.

### Surgical fix

Use an explicit existence helper and keep the error outside an existence-check `catch`:

```ts
const exists = await pathExists(targetDir);
if (exists && !force) {
    throw new ExtensionAlreadyInstalledError(manifest.id);
}
```

Do not remove the old install until the new package is completely staged and validated. For forced replacement, use a backup-and-rollback sequence:

1. Extract and validate into a random staging directory.
2. Rename existing target to a random backup.
3. Rename staging to target.
4. Synchronize the theme.
5. Remove backup only after all steps succeed.
6. Restore backup on failure.

### Tests to add

- Installing the same ID twice with `force: false` rejects and leaves the original bytes unchanged.
- Installing with `force: true` replaces it.
- A failed forced replacement restores the previous install.

---

## ~~SEC-02: uninstall path traversal and arbitrary deletion~~

**Resolved:** API and manager share `ExtensionIdSchema`; resolved and real paths
must remain contained; the on-disk manifest identity must match before deletion.

### Evidence

The endpoint accepts any non-empty string:

```ts
const BodySchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['plugin', 'theme', 'admin_plugin']),
});
```

The manager then directly joins the ID into a recursive delete path:

```ts
const targetDir = join(EXTENSIONS_BASE_DIR, kindDir, id);
await fs.rm(targetDir, { recursive: true, force: true });
```

The endpoint comment says sanitization occurs in the manager, but it does not. `ExtensionIdSchema` exists for package manifests, but is private to `types.ts` and is not reused by uninstall.

### Impact

An authorized owner request can supply traversal segments and make the process recursively delete outside the selected extension directory. Owner-only access lowers exposure, but this remains a critical server-side filesystem defect and is dangerous under CSRF, compromised admin sessions, bugs in callers, or future permission changes.

### Surgical fix

- Export one canonical `ExtensionIdSchema` and reuse it in every API and filesystem entry point.
- For themes, use a stricter lower-kebab-case schema.
- Resolve the kind root and target path, then enforce containment.
- Read the target manifest and require that its `id` and `kind` match the requested values before deletion.

```ts
const id = ExtensionIdSchema.parse(inputId);
const root = resolve(EXTENSIONS_BASE_DIR, getKindDir(kind));
const target = resolve(root, id);

if (dirname(target) !== root) {
    throw new Error('Invalid extension path');
}

const manifest = await readAndValidateManifest(join(target, 'or3.manifest.json'));
if (manifest.id !== id || manifest.kind !== kind) {
    throw new Error('Extension identity mismatch');
}
```

Add tests for `../`, encoded variants at the HTTP layer, dots, slashes, backslashes, root deletion attempts, manifest mismatch, and symlink edge cases.

---

## ~~SEC-03: a “theme” install is trusted code execution~~

**Resolved:** packages declare declarative or trusted-code intent; declarative
themes are JSON/schema-only, reject executable files, and trusted themes carry
an explicit admin warning and component contract version.

The default extension allow-list permits JavaScript, TypeScript, Vue, and preprocessors. Installed theme directories are linked or copied into `app/theme`, and the build/runtime imports `theme.ts`, `app.config.ts`, icon config, and optional Vue component overrides.

This means a theme ZIP or URL is not merely visual data. It can become application code during build and can replace significant UI surfaces.

### Recommendation: two explicit trust tiers

**Declarative theme**, safe by default:

- `or3.theme.json`
- tokens, fonts, icons, assets, scoped CSS, metadata
- no JS/TS/Vue or arbitrary app config
- schema-validated
- hot-installable without rebuilding application code

**Trusted code theme**, advanced:

- may contain TypeScript, Vue components, and config code
- explicit admin warning that it is equivalent to installing code
- disabled unless deployment policy allows it
- package checksum/signature and provenance displayed
- engine/API version requirements
- rebuild required

This single distinction would substantially improve security, install UX, and the marketplace story.

---

## ~~SEC-04: requested install kind is not enforced~~

**Resolved:** file, URL, and base64 installs require `expectedKind`, compare it
to the archive manifest before extraction, and enforce lower-kebab-case theme IDs.

The client APIs accept a `kind`, but neither the multipart request nor URL JSON sends the expected kind. The server trusts the archive manifest. Consequently, the Themes page can be used to install a plugin or admin plugin packaged under another kind.

### Fix

Send `expectedKind` with the request and compare it to `manifest.kind` before extraction or persistence. Use separate endpoints or a shared endpoint with strict expected-kind validation.

For themes, additionally require:

- extension manifest ID is lower-kebab-case
- theme definition name equals manifest ID
- package contains a valid theme entry
- no disallowed runtime routes

---

## ~~SEC-05: remote-fetch DNS validation has a time-of-check/time-of-use gap~~

**Resolved:** every HTTPS hop connects through a custom lookup pinned to the
validated public IPv4 answer while retaining TLS SNI and host verification.

`url-fetch.ts` resolves and validates public IPs, then calls ordinary `fetch(currentUrl)`. The fetch performs its own DNS resolution. The checked address is not pinned to the connection, so the implementation should not claim complete DNS-rebinding prevention.

### Fix options

- Use an Undici dispatcher/agent with a custom pinned `lookup` result.
- Resolve once per hop, choose a validated address, connect to it while preserving TLS SNI and Host.
- Or use a strict hostname allow-list for remote theme stores.

The existing HTTPS-only policy, private CIDR checks, redirect revalidation, response-size limit, timeout, and ZIP signature checks are good and should remain.

---

## ~~SEC-06: external stylesheets are accepted without a trust policy~~

**Resolved:** manifests, runtime resolution, and validation reject external,
data, and blob stylesheet URLs; theme styles must be local package assets.

`resolveThemeStylesheetHref()` accepts protocol-relative, HTTPS, data, and blob URLs. A safe/declarative theme should not silently load third-party CSS or allow CSS imports to become an uncontrolled supply-chain dependency.

### Fix

- Declarative themes: local package assets only.
- Trusted themes: external assets opt-in through deployment policy and CSP allow-lists.
- Validate URL scheme, origin policy, and CSS size.
- Surface every external origin in the install preview.

---

## ~~SEC-07: CSS values need a safe-theme grammar~~

**Resolved:** declarative definitions now use typed color/length validation,
declaration-only style maps, local URL policy, and event-handler rejection.

The current validator often emits warnings rather than rejecting invalid CSS values. Font, border, custom token, selector, and style values can contain arbitrary CSS syntax. Escaping `</style>` prevents one HTML-breakout form, but does not turn arbitrary CSS strings into a safe declarative format.

For trusted code themes, arbitrary CSS is expected. For safe themes, validate each field by type:

- colors via a CSS color parser/support check
- lengths via a constrained grammar
- font stacks through a restricted parser
- image references through asset tokens
- selectors against an allowed subset
- no raw braces, declarations, `@import`, or unapproved URLs

---

# 2. Runtime correctness and performance

## ~~RUN-01: `v-theme` promises a component-prop system but implements DOM decoration~~

**Resolved:** the compatibility directive is documented and implemented as an
owned, reactive DOM decorator; Vue props use `useThemeOverrides()` + `v-bind`.

This is the most important product-level mismatch.

### What the code does

For a component, `applyOverrides()` stores resolved props on a private element field:

```ts
(el as any).__theme_overrides__ = resolvedProps;
```

No other code reads that field. It then applies values to the rendered DOM element. `applyToElement()` handles:

- `data-id`
- `data-theme-color`
- `data-theme-variant`
- `data-theme-size`
- classes
- debug `data-*` attributes

It does not set Vue component props such as `variant`, `color`, `size`, `disabled`, `loading`, `icon`, or `ui`. It also does not apply the documented `style` object.

### Theme switching is also broken for unchanged directive bindings

The directive's `updated` hook returns when `binding.value === binding.oldValue`. `92.theme-lazy-sync.client.ts` force-updates components after a theme switch, but the directive sees the same binding and skips resolution. Therefore the global force-update mechanism does not make the directive reactive as claimed.

### Recommendation

Do not attempt to mutate component props from a runtime directive. Vue directives are the wrong abstraction for that contract.

Preserve compatibility while making the distinction explicit:

1. **Use `useThemeOverrides()` plus `v-bind` for component props.**
2. **Keep a directive only for target annotation and DOM class/style hooks.** Rename it to `v-theme-target` over a deprecation period.
3. Generate typed helpers from a central target registry, such as `useButtonThemeProps('chat.send')`.
4. Compile interactive states such as hover/focus into CSS, not a one-time `state: 'default'` runtime lookup.

```vue
<script setup lang="ts">
const sendTheme = useThemeTarget('button', {
  context: 'chat',
  id: 'chat.send',
  nuxtUi: true,
});
</script>

<template>
  <UButton v-bind="sendTheme.props" v-theme-target="sendTheme.targetAttrs">
    Send
  </UButton>
</template>
```

This is a migration, not a rewrite of theme definitions.

---

## ~~PERF-01: user override watchers multiply per component~~

**Resolved:** one HMR-safe singleton store owns one deep watch, one microtask
commit scheduler, and one debounced persistence scheduler.

`useUserThemeOverrides()` is called by the plugin and by every theme settings subsection. Each call reaches the bottom of the composable and installs two deep watchers on the singleton refs.

`set()` itself already:

- merges
- optionally revokes blobs
- calls `applyMergedTheme()`
- writes localStorage

Then every registered deep watcher calls `applyMergedTheme()` and writes localStorage again. Two components also call `reapply()` immediately after `set()`.

### Real-world effect

A slider input can produce:

- the direct `set()` apply
- an explicit `reapply()` in some controls
- one apply from every composable instance watching the active mode
- one storage write from every watcher
- background object URL revocation and reconstruction

This is a direct explanation for clunky settings interactions.

### Fix

Create one HMR-safe `UserThemeOverrideStore` initialized once in a plugin:

- one pair of storage loads
- one mode listener
- one watch/effect
- one batched apply scheduler
- one debounced persistence scheduler

Methods should only mutate state. They should not both mutate and directly apply.

```ts
function set(patch: DeepPartial<UserThemeOverrides>) {
  state[mode.value] = mergeAndValidate(state[mode.value], patch);
  scheduleCommit();
}

function scheduleCommit() {
  pendingRevision++;
  queueMicrotask(commitLatestRevision);
  schedulePersistDebounced();
}
```

Remove `reapply()` calls after `set()` and make `reapply()` an internal recovery/debug API.

---

## ~~PERF-02: every background edit revokes all blob URLs~~

**Resolved:** blob cache invalidation is selective and occurs only when an
internal-file URL changes or is reset.

Any patch containing `backgrounds` calls `revokeBackgroundBlobs()`, even when the user changes only opacity, size, repeat, fit, or color. The next apply must fetch file blobs and create object URLs again.

### Fix

Invalidate a background token only when its `url`/file hash changes or the layer is reset. Preserve object URLs for visual-property changes. The existing `invalidateBackgroundToken(hash)` is the right primitive but is not used by the store.

---

## ~~STATE-01: client app-config patches bleed between themes~~

**Resolved:** client and server compute config from an immutable base and
replace absent keys; A→B→A leakage has regression coverage.

The client takes a base JSON snapshot but restores it only during HMR cleanup. On each switch it merges the next patch into the current config with `defu`:

```ts
appConfig.ui = defu(theme.ui, appConfig.ui);
Object.assign(appConfig, defu(patch, appConfig));
```

If Theme A adds a key and Theme B omits it, the Theme A value remains. Arrays and class lists can accumulate or follow different semantics from the server's custom `deepMerge()`.

### Fix

Use one pure shared function on server and client:

```ts
const effective = computeEffectiveAppConfig(baseConfig, {
  appPatch: themePatch,
  uiPatch: compiledTheme.ui,
});
replaceReactiveObject(appConfig, effective);
```

`replaceReactiveObject()` must delete keys absent from the effective config, not only assign new keys. Define explicit array policies per path.

A simpler long-term boundary is better: deprecate arbitrary theme `app.config.ts` patches and allow only `theme.ui`, with a compatibility adapter for existing themes.

---

## ~~SSR-01: server omits `hasStyleSelectors`~~

**Resolved:** the canonical compiler supplies the field identically to client,
server, and build tooling.

The server's `CompiledTheme` object does not copy `manifestEntry.hasCssSelectorStyles`. Later, SSR head generation checks `compiledTheme.hasStyleSelectors` before adding `/themes/<name>.css`. That condition is therefore false or undefined.

### Impact

- generated selector styles may appear only after hydration
- flash of unthemed content
- SSR/client visual mismatch
- static generation can omit required theme CSS

### Fix

Immediate:

```ts
hasStyleSelectors: manifestEntry.hasCssSelectorStyles,
```

Structural fix: one `compileThemeDefinition()` function must construct every `CompiledTheme`, preventing client/server/build fields from drifting.

---

## ~~SSR-02: global icon registry is not request-isolated~~

**Resolved:** SSR creates and serializes one icon registry per Nuxt request;
the client retains its own hydrated singleton.

`iconRegistry` is a module singleton. Each SSR request registers themes, changes `activeTheme`, unregisters inactive themes, and serializes global state into that request's payload. Concurrent requests can mutate the same registry.

### Fix

- Instantiate an `IconRegistry` per Nuxt app/request on the server.
- Provide that instance through Nuxt injection.
- Keep a client singleton only if desired.
- Prefer explicit `resolve(token, themeName)` on SSR instead of mutable global active-theme state.

Audit other module-level registries for the same request isolation issue.

---

## ~~RUN-02: theme activation is not transactional~~

**Resolved:** activation uses a monotonic revision, preloads target resources,
checks supersession at async boundaries, and blocks stale background commits.

A theme switch performs multiple awaited stages with no activation ID or abort signal:

- load/compile theme
- load stylesheets
- remove previous classes and links
- update persistence and icon state
- apply config
- load generated CSS
- set `data-theme`
- scan and add runtime classes
- inject variables
- resolve and apply backgrounds
- swap custom components

If A and B are requested quickly, A can finish after B and commit stale backgrounds, CSS, config, or component maps. The current in-flight dedupe prevents duplicate loading of one theme, but it does not establish last-request-wins activation.

### Fix: activation transaction

```ts
const revision = ++activationRevision;
const prepared = await prepareTheme(target);
if (revision !== activationRevision) return { status: 'superseded' };

await preloadThemeAssets(prepared);
if (revision !== activationRevision) return { status: 'superseded' };

commitTheme(prepared); // synchronous or tightly bounded commit
scheduleCleanup(previous);
```

Background/token resolution should also receive the revision or abort signal and refuse stale writes.

Preload the new theme before removing old resources to avoid a flash.

---

## ~~PERF-03: stylesheets are loaded during registration and activation~~

**Resolved:** registration is DOM-pure; only the activation transaction loads
visual stylesheets and selector CSS.

`registerThemeFromEntry()` starts `loadThemeStylesheets()` while the theme is merely being loaded/compiled. `setActiveTheme()` loads them again during activation.

Although link deduplication prevents exact duplicates, this still mixes a visual side effect into compilation and can load unscoped theme CSS before `data-theme` changes.

### Fix

Theme registration must be pure with respect to the DOM. It may resolve URLs and metadata, but only the activation transaction should insert or remove visual resources.

---

## ~~PERF-04: selector class application repeatedly scans the entire document~~

**Resolved:** a single cancellable selector session performs the initial scan
and observes added subtrees; page-finish and composable rescans were removed.

`applyThemeClasses()` executes `document.querySelectorAll()` for every selector. It is invoked from:

- theme activation
- `page:finish`
- `useThemeClasses()`
- possibly additional lazy flows

The 5 ms chunking budget is per selector loop. A single expensive selector returning many elements can still exceed the budget. `themeName` is not used by the implementation.

### Fix hierarchy

1. Prefer generated static CSS for visual styling.
2. Replace arbitrary global selectors with stable semantic hook attributes where possible.
3. Have one selector-class coordinator, not three callers.
4. If dynamic class application remains, observe added subtrees once with a `MutationObserver` and match only relevant selectors.
5. Instrument selector time and warn on expensive selectors in development.

---

## ~~RUN-03: selector-class jobs cannot be canceled and do not track ownership~~

**Resolved:** sessions cancel work and track per-theme additions, preserving
pre-existing app classes and removing owned classes even after match changes.

The rAF chunk loop has no cancellation handle. A superseded theme can continue adding classes after a new theme is active.

The WeakMap stores only a set of class names, not which theme added them or whether a class already existed. Removal blindly removes all configured class names from current selector matches. This can:

- remove an application-owned class that predated the theme
- leave a theme class on an element that no longer matches the original selector
- confuse ownership when two themes use the same class

### Fix

Return an application session with `cancel()` and track theme-owned additions per element:

```ts
WeakMap<Element, Map<ThemeName, Set<ClassName>>>
```

Only remove classes the specific theme actually added. On switch, cancel the previous session before committing the new one.

---

## ~~RUN-04: the selector DSL parser has correctness traps~~

**Resolved:** one explicit production parser handles hyphenated targets,
contexts, states/attributes, structured errors, specificity, and source order.

`compiler-core.ts` intentionally implements a shallow grammar, but several behaviors are too silent for an author-facing system:

- component extraction uses `^(\w+)`, so `color-picker` parses as `color`
- an unknown `.context` is left in the string but then effectively ignored by matching, potentially turning an intended scoped override into a global one
- a state followed by an attribute can be missed by `:(\w+)(?:\(|$)`
- a missing/invalid component defaults to `button`
- specificity is an approximate colon count
- equal-specificity source order is reversed by the resolver merge, so the earlier declaration wins rather than the later declaration

### Fix

Implement a small explicit parser for the supported DSL rather than a collection of regular expressions. The grammar is small:

```text
component [ .context ] [ #identifier ] [ :state ] [ attribute ]*
```

Return a structured error instead of defaulting to `button`. Store `sourceOrder` in `CompiledOverride` and resolve by `(specificity, sourceOrder)` so later equal-specificity declarations win.

Unknown contexts and unsupported syntax should be validation errors, not warnings or silent fallbacks.

---

## ~~RUN-05: component-name inference does not match the theme DSL reliably~~

**Resolved:** a canonical target registry maps Vue/Nuxt UI names to semantic
targets and records allowed props; directive inference uses only that registry.

The directive derives internal Vue component names such as `ubutton`, while theme authors generally target semantic names such as `button`. It then uses a hard-coded, incomplete set to determine whether a component is Nuxt UI.

### Fix

Create a canonical theme-target registry:

```ts
{
  vueNames: ['UButton'],
  target: 'button',
  kind: 'nuxt-ui',
  allowedProps: ['variant', 'color', 'size', 'ui', 'class', ...]
}
```

Prefer explicit target metadata over inference. Generate types, docs, validation, and inspector labels from this registry.

---

## ~~PERF-05: lazy-sync global mixin is broad and mostly ineffective~~

**Resolved:** the global force-update plugin was deleted; reactive consumers,
directive watchers, and selector observation update only affected surfaces.

`92.theme-lazy-sync.client.ts` installs a global mixin that runs for every component, tracks async component instances in a strong `Set`, and force-updates all of them after a theme version change.

The directive still skips when its binding value is unchanged, so this does not fix directive reactivity. A Vue global mixin cannot be cleanly uninstalled during HMR, which can also leave obsolete closures across reloads.

### Fix

Remove this plugin after consumers use reactive `useThemeOverrides()` or explicit active-component refs. Vue reactivity should update only components that consume theme state. Do not force-render an unrelated class of components globally.

---

## ~~PERF-06: inactive theme eviction saves little and causes recompilation~~

**Resolved:** compiled themes and resolvers remain cached while their visual
resources are activated and cleaned independently.

The plugins keep only the active and default compiled themes. Theme definitions, resolvers, app patches, icons, and component maps are discarded on every switch away, while some style tags remain in the document.

Compiled themes are small compared with application components and assets. Re-importing and recompiling can cost more than the memory saved, especially in a theme picker.

### Fix

Use a small configurable LRU, such as 4 to 8 compiled themes, or keep all compiled definitions after moving to precompiled payloads. Treat loaded assets separately from compiled metadata.

---

## ~~STATE-02: user override merge can clear a base image unintentionally~~

**Resolved:** layer conversion preserves `undefined`, treats `null` as explicit
clear, and replaces only string URLs.

`convertLayerToThemeFormat()` uses:

```ts
image: layer.url || null
```

An opacity-only or size-only partial layer with `url: undefined` becomes `image: null`, clearing the base theme image. The conversion must distinguish:

- `undefined`: preserve base value
- `null`: explicitly remove image
- string: replace image

The same principle should be applied to every deep partial merge.

---

## ~~STATE-03: reset paths leave derived values behind~~

**Resolved:** derived variables are removed when absent, theme font variables
replace hard-coded fallbacks, and contrast clamps immutable effective layers.

Examples:

- gradient display variables are set when an override is defined, but are not removed when it becomes undefined
- high-contrast opacity reduction destructively overwrites current CSS vars and does not restore their previous values when high contrast is disabled
- `useSystemFont: false` hard-codes retro fonts rather than returning to the active theme's fonts

### Fix

Stop incrementally mutating unrelated CSS variables from multiple locations. Compute one immutable effective theme from:

```text
base theme + color mode + contrast mode + user overrides
```

Then diff the previous and next effective output. Variables absent from the next output are removed. No special reset branch is required.

---

## ~~STATE-04: base theme background application and user dark-mode merge are split~~

**Resolved:** the singleton effective-theme store is the only final background
owner; activation bumps its resolver revision instead of applying a base layer.

The base theme plugin applies `theme.backgrounds` directly, while `applyMergedTheme()` separately resolves dark-mode background overrides and user settings. The user override store does not subscribe directly to base-theme changes. This produces ordering dependencies and stale-background risks.

### Fix

The activation coordinator should be the only owner of final backgrounds. It should call one pure `computeEffectiveBackgrounds(theme, mode, userOverrides)` function.

---

## ~~STATE-05: selection persistence has multiple conflicting sources~~

**Resolved:** startup awaits the selection repository (KV first), with cookie
for SSR, local storage as cache/migration, serialized latest-only writes, and a
diagnostic selection source.

Current sources include:

- `activeTheme` localStorage
- `or3_active_theme` cookie
- `theme_selection` KV
- `previousDefaultTheme` localStorage
- `or3_previous_default_theme` cookie
- runtime-config default
- manifest `isDefault`
- first manifest entry
- hard-coded fallback

`90.theme.client.ts` writes KV but does not read it. `useThemeSelection.ts` reads KV and removes the localStorage key, but it is unused. The UI claims cross-device synchronization, while startup uses localStorage/cookie.

### Fix

Create one `ThemeSelectionRepository` with documented precedence and migration:

1. SSR cookie mirror for first paint.
2. Canonical signed-in user KV preference after DB/auth readiness.
3. localStorage only as migration/cache.
4. deployment default if no explicit preference.
5. deterministic fallback.

Include a revision or updated timestamp for conflict resolution. Expose the selection source for diagnostics.

---

## ~~STATE-06: default selection is not deterministic enough~~

**Resolved:** metadata is sorted, multiple defaults are errors, and the named
fallback constant wins before a stable sorted first-entry fallback.

Both included built-in themes set `isDefault: false`. If runtime config does not provide a valid default, `pickDefaultTheme()` chooses the first manifest entry before the fallback constant. Import-glob or filesystem order should not define a product default.

### Fix

- Require exactly one manifest default unless deployment config supplies one.
- Or prefer the configured fallback constant before first-entry fallback.
- Sort manifest entries by name for stable UI and generated output.
- Treat multiple defaults as a validation error.

---

## ~~RUN-06: global `useNuxtApp` discovery is fragile~~

**Resolved:** the store captures Nuxt dependencies during valid setup and pure
application functions receive the theme runtime explicitly.

`applyMergedTheme.ts` and `useUserThemeOverrides.ts` look for `globalThis.useNuxtApp`. Nuxt auto-imports are compile-time conveniences, not a dependable public global API. Tests make this work by manually creating the global, which can hide a production integration defect.

### Fix

Pass dependencies explicitly when creating the store or import/use Nuxt context only inside a valid plugin/setup scope. The pure apply functions should accept a `ThemeRuntime`/registry dependency rather than discovering it globally.

---

# 3. Build system and compiler audit

## ~~BUILD-01: build-time and runtime compilers are different products~~

**Resolved:** client, SSR, CLI, and Vite use the same pure definition compiler,
CSS variable generator, selector parser, and compiled payload shape.

The Vite compiler validates themes and generates types, but the runtime plugins compile definitions again with other functions.

The build compiler's `CompiledTheme` omits several fields used at runtime:

- `isDefault`
- `stylesheets`
- `cssSelectors`
- `hasStyleSelectors`
- `backgrounds`
- `customComponents`
- inline `definition.icons` when no separate icon config exists

Its CSS variable generator scopes to global `.light` and `.dark`, while the runtime generator scopes to `html[data-theme="..."]`. It also has a separate token map and font behavior.

### Fix

Create one pure source of truth:

```ts
export function compileThemeDefinition(
  definition: ThemeDefinition,
  assets: ResolvedThemeAssets
): CompiledTheme
```

Use it in:

- client
- server
- CLI compiler
- Vite validation
- tests

Then generate a virtual build manifest containing precompiled immutable payloads. Runtime can lazy-import the precompiled payload instead of reparsing selectors and regenerating CSS.

---

## ~~BUILD-02: `failOnError` can be bypassed by hook order~~

**Resolved:** the Vite plugin caches the compilation promise/result and throws
stored build errors from `buildStart` when `failOnError` is enabled.

The Vite plugin sets `compiled = true` before compilation. `configResolved()` calls `compileThemes(null)`, where errors are logged because there is no Rollup context. If `buildStart()` runs afterward, it returns early because `compiled` is already true, so `context.error()` never executes.

### Fix

- In serve mode, validate from `configResolved` without marking the build validation complete.
- In build mode, validate from `buildStart` with Rollup context.
- Cache the result or promise, not only a boolean.
- If a cached result contains errors and `failOnError` is true, throw in `buildStart`.
- Set completed state only after success or a stored result.

---

## ~~BUILD-03: manifest discovery is eager despite a lazy architecture~~

**Resolved:** deterministic metadata is generated at validation/build time;
startup joins it to lazy definition/config/icon/style loaders without importing
every theme, and UI consumes `$theme.availableThemes`.

`loadThemeManifest()` imports every theme definition in parallel to obtain metadata, and `app.config.ts` modules are globbed with `{ eager: true }`. It is called on every client boot, each SSR request, and again by dashboard/admin UI code. Active theme registration then imports the selected definition again.

### Fix

Generate a metadata-only manifest at build time:

```ts
{
  name,
  displayName,
  description,
  isDefault,
  hasStyleSelectors,
  loaders: { compiledTheme, appConfig, icons, components, stylesheets }
}
```

The UI should consume `themeApi.availableThemes`, not call the manifest loader independently. Theme config should stay lazy.

---

## ~~BUILD-04: static CSS scoping breaks comma-separated selectors~~

**Resolved:** selector lists are parsed at top-level nesting/quote boundaries
and every branch is independently scoped, including functional selectors.

The generator prefixes the selector string once:

```ts
[data-theme="retro"] #a, #b { ... }
```

Only `#a` is scoped. `#b` remains global. The retro theme contains comma-separated selector keys.

### Fix

Use a selector parser such as PostCSS Selector Parser and prefix every top-level selector branch:

```css
[data-theme="retro"] #a,
[data-theme="retro"] #b { ... }
```

Validate and normalize selectors during compilation. Add regression tests for comma lists, `:is()`, pseudo-elements, and nested functional selectors.

---

## ~~BUILD-05: HMR is coarse and can leave generated artifacts stale~~

**Resolved:** any theme TS/Vue/CSS-like dependency invalidates compilation and
generated artifacts during the transitional full-reload path.

The Vite plugin only recompiles definitions/types for `theme.ts` and `icons.config.ts`. A change in an imported style-helper TypeScript file launches the CSS subprocess and full reload but does not necessarily refresh generated types or every compiled artifact.

A fresh subprocess avoids ESM cache problems but is expensive. Every matching change triggers a full reload.

### Fix

Build a dependency graph per theme and invalidate only that theme's compiled payload, CSS, and generated type fragments. During transition, treat any TypeScript file under a theme as an entry-affecting change.

---

## ~~BUILD-06: generated files are nondeterministic~~

**Resolved:** timestamps were removed, all unions/metadata are sorted, and
unchanged generated files are not rewritten.

`theme-generated.d.ts` includes the current timestamp and emits unsorted `Set` iteration order. Running validation can dirty the repository even when semantic output is unchanged.

### Fix

- remove the generated timestamp or put it in a non-versioned build artifact
- sort theme names, identifiers, and contexts
- write only if content changed
- add a CI check that generated artifacts are current

---

## ~~BUILD-07: stale generated CSS is not cleaned~~

**Resolved:** the CSS builder deletes generated files outside the expected set;
stale removal and current-file preservation are covered by tests.

`buildThemeCSSFiles()` writes current theme files but does not remove CSS for deleted or renamed themes.

### Fix

Generate into a temporary directory and atomically replace the output set, or delete known generated files not present in the current manifest.

---

## ~~BUILD-08: `theme:switch` appears to target an obsolete configuration path~~

**Resolved:** the CLI now edits the actual `OR3_DEFAULT_THEME` deployment value
in `.env` rather than an unused app-config path.

The runtime reads `runtimeConfig.public.branding.defaultTheme`. The CLI edits an app-config path. This should be verified in the full repository, but within the supplied scope it appears to be a stale control plane.

### Fix

Have the CLI update the actual deployment configuration source, or retire it in favor of the admin API. One default-setting mechanism should exist.

---

# 4. API, types, and maintainability

## ~~API-01: there are too many public ways to do the same thing~~

**Resolved:** docs select tokens, `useThemeOverrides` + `v-bind`, scoped CSS,
and trusted custom components as the primary surfaces; used helpers were kept
and the unused rescan composable is a deprecated no-op.

The snapshot contains:

- `v-theme`
- `useThemeResolver`
- `useThemeOverrides`
- `useTypedThemeOverrides`
- `buildThemeOverrideProps`
- `useThemeClasses`
- direct `$theme.getResolver()` calls
- `cssSelectors.class`
- `cssSelectors.style`
- theme `ui`
- theme `app.config.ts`
- custom components
- user overrides

Several helper APIs have no non-test consumers in the supplied scope:

- `useThemeSelection.ts`
- all wrappers in `useTypedThemeOverrides.ts`
- `buildThemeOverrideProps()`
- `useThemeClasses()`
- `LocalHexKeys`
- `ColorGroup`

### Recommendation

Choose and document a small primary surface:

1. tokens for visual values
2. theme target registry + `useThemeOverrides` for component props
3. static scoped CSS for non-component DOM
4. custom components only for trusted, contract-versioned replacements
5. one runtime API for selection/preview/diagnostics

Adopt or remove the orphaned helpers. Do not leave parallel “future” APIs in production code.

---

## ~~API-02: token definitions are duplicated and drifting~~

**Resolved:** a canonical design-token registry drives runtime generation,
user application, and settings mappings, including semantic success/warning.

Color/token knowledge appears in:

- `BaseColorPalette`
- user override types
- dashboard `ColorKey`
- dashboard CSS variable map
- `applyMergedTheme()` color map
- build compiler map
- runtime generator
- documentation

One visible drift is semantic colors: base theme generation emits `--md-success` and `--md-warning`, while the user editor writes extended token names such as `--md-extended-color-success-color`.

### Fix

Create one design-token registry with:

- key
- CSS variable
- type/validator
- default/fallback relationship
- editable flag
- dark-mode support
- documentation label/group

Generate types, CSS mapping, settings UI, docs, and validation from it.

---

## ~~API-03: prop maps merge only at the category level~~

**Resolved:** prop-map categories are deep-merged over defaults.

The resolver uses a shallow object spread:

```ts
this.propMaps = {
  ...defaultPropMaps,
  ...(compiledTheme.propMaps || {}),
};
```

A theme that supplies one custom `size` mapping replaces the entire default size map. Deep merge each category or document full replacement explicitly.

---

## ~~API-04: cached resolver results are mutable shared objects~~

**Resolved:** compiled and resolved outputs are recursively frozen before they
are cached or returned.

The resolver returns the exact cached object reference. A consumer that mutates `class`, `ui`, or another property mutates the cache for future components.

### Fix

- freeze compiled and resolved outputs in development
- return immutable/read-only objects
- or clone only at the binding boundary

Do not allow component consumers to mutate cached resolver state.

---

## ~~API-05: merge semantics are incomplete~~

**Resolved:** scalars follow specificity/source order, class strings append,
style and UI maps merge by property, prop maps deep-merge, and event handlers
are rejected.

The resolver deep-merges `ui` but overwrites `style`. Classes concatenate without semantic conflict resolution. Tailwind classes such as two different backgrounds or paddings can coexist, making final behavior depend on generated CSS order rather than selector specificity.

### Fix

Define merge policies per field:

- scalar component props: highest specificity then later source order
- `class`: concatenate, optionally run a Tailwind conflict merger if dependency cost is acceptable
- `style`: shallow/deep merge by property
- `ui`: documented deep merge with array policy
- event handlers and unsafe props: reject from themes

---

## ~~API-06: custom components need a formal compatibility contract~~

**Resolved:** trusted replacements declare contract version 1; a complete
target contract registry records required props/emits/slots/accessibility and
validation rejects incompatible versions.

A theme can replace major app components. The included blank ChatInput is hundreds of lines and must manually mirror core props, emits, slots, and behavior. This is a powerful WordPress-like feature, but currently it behaves like an internal fork.

### Fix

For every custom component target, define:

- stable TypeScript props and emits
- required slots
- lifecycle expectations
- accessibility requirements
- core service injections
- contract version
- fallback/loading/error component
- conformance test kit

Theme manifests should declare compatible `appApiVersion`/`componentContractVersion`. Keep custom components trusted-only.

---

## ~~API-07: component defaults are partly eager~~

**Resolved:** all heavy core defaults and theme replacements are async, null
exports are rejected, and per-theme caches can be invalidated during HMR.

`theme-components-registry.ts` statically imports several heavy default components, while others are async. Because the registry is imported by the theme plugins, these eager imports can reduce code splitting.

`isComponentLike()` also treats `null` as an object and should reject it.

### Fix

Make all large default surfaces async where architecture permits, or inject defaults from the consuming feature rather than importing the whole application into the theme core. Reject null exports and add cache invalidation when a theme is unloaded or hot-reloaded.

---

## ~~API-08: client/server plugins still duplicate substantial orchestration~~

**Resolved:** shared manifest/default/load/prepare/compiler/config primitives
own common orchestration; request-local server and DOM client effects remain as
small environment-specific adapters.

A shared `theme-loader.ts` now deduplicates in-flight loading and safe fallback selection, which is good. The plugins still separately implement:

- theme registration and compilation
- resolver creation
- icon loading
- app-config loading
- cleanup policy
- active-component synchronization
- default and stored selection handling
- active theme refs/versioning

This is where fields such as `hasStyleSelectors` diverged.

### Fix

Create a shared runtime core with environment adapters:

```text
ThemeRuntimeCore
  - manifest and compiled registry
  - selection decision
  - load/prepare/activate state machine
  - effective config calculation
  - lifecycle and diagnostics

ClientEffects
  - DOM, link/style tags, local persistence, backgrounds

ServerEffects
  - request cookie, SSR head, payload hydration
```

The environment adapters should be small. The core should be pure or request-local.

---

# 5. Theme package duplication

**Addressed without destabilizing existing themes:** stable target IDs, design
tokens, compiler/config preparation, component contracts, and settings styles
now live in shared registries/helpers. Skin-specific class recipes remain local
to Blank and Retro; runtime inheritance was intentionally not introduced as an
implicit compatibility layer.

Similarity analysis of the supplied built-in themes found substantial near-duplication:

| Pair | Approximate normalized similarity |
|---|---:|
| blank vs retro `app.config.ts` | ~62% |
| chat style helpers | ~62% |
| dashboard style helpers | ~75% |
| documents style helpers | ~77% |
| sidebar style helpers | ~45% |
| theme definitions | ~29% |

The themes should remain independently expressive, so do not overabstract every class string. Extract only stable structural recipes:

- shared component target IDs
- shared base props/slots
- shared layout/density recipes
- shared dashboard settings target map
- shared CSS selector hook names
- shared app-config structural defaults

Then let themes override skin-specific values. A modest inheritance feature can help:

```ts
export default defineTheme({
  name: 'retro',
  extends: 'or3-base',
  tokens: { ... },
  components: overrideRecipes({ ... }),
});
```

Inheritance must compile to a fully materialized theme and detect cycles. It should not create runtime parent lookups.

---

# 6. Settings UI audit

## ~~UI-01: composables are created inside computed getters~~

**Resolved:** settings composables and icon resolvers are created once in setup;
computed values only read and merge their refs.

Several settings components call `useThemeOverrides()` inside another `computed()` getter. Every recomputation can create another computed/effect outside the normal setup pattern. `useIcon()` is also called from computed/template expressions in places.

Instantiate each composable once in setup, then merge its `.value` in a computed:

```ts
const presetOverride = useThemeOverrides({...});
const presetButtonProps = computed(() => ({
  size: 'sm',
  ...presetOverride.value,
}));
```

---

## ~~UI-02: background preview duplicates the asset subsystem~~

**Resolved:** preview uses the shared token cache through a revision-safe asset
composable and respects the actual layer size/repeat model.

`BackgroundLayersSection.vue` maintains its own internal-file cache, object URLs, revocation, and resolver, separate from `core/theme/backgrounds.ts`. The same file can produce duplicate blob URLs and lifecycle rules.

Its async refresh can also finish out of order, and preview repeat sizing is hard-coded rather than consistently using the layer size.

### Fix

Create one `useResolvedThemeAsset(token)` composable backed by the central token cache and revision/abort semantics. Use the same normalized background model for preview and final application.

---

## ~~UI-03: repeated styles and dead scoped rules~~

**Resolved:** section typography styles moved to the shared theme page layer;
dead scoped selectors and the unused live region were removed.

`.group-heading` is repeated across the section components. `supporting-text` differs between files. `ThemePage.vue` has scoped styles that cannot style internals of child components, plus an unused live-status ref and legacy fallback rules.

### Fix

Create a small `ThemeSettingsSection` component or shared CSS layer for heading/support text/card layout. Remove dead scoped selectors and wire the live region to actual status messages or remove it.

---

# 7. Test audit

**Resolved for the concrete findings:** tests now import the production parser,
all user-override skips were removed, and regressions cover install/uninstall
security, trust tiers, activation supersession, config reset, compiler parity,
SSR icon isolation, selector cancellation/ownership, source order, persistence,
blob reuse, safe CSS, component contracts, and stale generated CSS. The full
repository suite passes; the visual matrix remains a Phase 4 enhancement.

The suite contains useful resolver, cache, CSS runtime, background, icon, manifest, compiler, URL-fetch, and extension-limit tests. However, the most dangerous behavior is not covered.

## Problems

- `app/plugins/__tests__/theme-runtime.test.ts` reimplements parser functions instead of importing production code, so it can pass while production is broken.
- Three user-override tests are skipped because singleton state is difficult to reset. That is a design smell and leaves persistence failure paths uncovered.
- The resolver performance test resolves the same cached key 1,000 times, mostly measuring cache lookup rather than realistic cold/mixed resolution.
- No test protects app-config reset across A→B→A.
- No test proves `v-theme` updates on theme switch or applies actual component props.
- No test checks SSR/client compiled-theme equality.
- No concurrent SSR test protects icon request isolation.
- No rapid activation test enforces last-request-wins.
- No selector class test covers cancellation or pre-existing class ownership.
- No duplicate install test currently catches SEC-01.
- No uninstall traversal test catches SEC-02.

## High-value regression matrix

1. **Security**
   - duplicate install force behavior
   - uninstall ID containment
   - expected-kind mismatch
   - safe-theme file policy
   - URL DNS pinning/redirects

2. **Activation**
   - A→B rapid switch, B always wins
   - failed B keeps A intact
   - no FOUC resources removed before preload
   - app config has no A-only keys after B
   - old background promise cannot overwrite B

3. **SSR**
   - SSR and client compile same definition to identical payload
   - selector CSS appears in SSR head
   - two concurrent requests with different themes do not share icon/config state
   - disabled theme policy is identical on server and client

4. **Resolver/parser**
   - hyphenated component
   - unknown context rejection
   - state plus attribute
   - equal-specificity later source wins
   - cold, mixed, and hot-cache benchmarks

5. **User overrides**
   - one mutation causes one effective apply and one debounced persistence operation
   - opacity change does not recreate a blob URL
   - undefined preserves a base image; null clears it
   - reset removes all derived variables

6. **Visual/a11y**
   - screenshot matrix for theme × light/dark × mobile/desktop
   - contrast and focus visibility checks
   - reduced-motion and forced-colors checks
   - custom-component contract tests

---

# 8. Documentation audit

**Resolved:** public docs and the in-repo README now describe `v-theme` as DOM
decoration, `useThemeOverrides` as the Vue-prop boundary, KV/cookie selection
precedence, pinned DNS fetches, trust tiers, local stylesheet policy, the real
default-theme CLI target, component contracts, and a capability truth table.

The documentation is extensive, which is a strength. It currently overstates or drifts from implementation in important places:

- `v-theme` is recommended for component prop overrides, but it applies DOM annotations/classes rather than Vue props.
- state selectors are documented even though the directive always resolves `state: 'default'`.
- cross-device theme selection is claimed, but startup does not read the KV selection path.
- the installer documentation claims force protection that the server bypasses.
- URL docs claim DNS-rebinding protection stronger than the actual pinned-connection model.
- `theme:switch` and some example APIs appear stale.
- multiple README, public-doc, agent-skill, planning, and generated copies increase drift.

### Fix

Choose one canonical source per concept and generate or link the others. Generate API tables from the token registry, theme target registry, and schema. Add a “capability truth table” showing which mechanism can affect tokens, component props, DOM styles, custom code, SSR, and user overrides.

---

# 9. Recommended target architecture

This keeps the existing theme DSL and packages.

```text
Theme packages
  theme.ts / declarative JSON
  icons / assets / optional trusted components
          │
          ▼
Canonical compiler
  validate + normalize + compile once
  immutable CompiledTheme
          │
          ▼
Generated metadata manifest
  lightweight list + lazy compiled loaders
          │
          ▼
ThemeRuntime (one per Nuxt app/request)
  selection repository
  compiled-theme cache
  activation revision/state machine
  effective theme computation
  lifecycle/diagnostics
          │
      ┌───┴───────────────┐
      ▼                   ▼
Server effects        Client effects
SSR head/cookies      DOM/config/assets/persistence
request-local icons   selector hook coordinator
```

## Core state model

```ts
interface ThemeRuntimeState {
  status: 'idle' | 'preparing' | 'committing' | 'error';
  requestedTheme: string;
  activeTheme: string;
  mode: 'light' | 'dark';
  contrast: 'normal' | 'medium' | 'high';
  activationRevision: number;
  userOverrides: UserThemeOverrides;
  effective: EffectiveTheme;
  lastError?: ThemeRuntimeError;
}
```

## Lifecycle

```text
beforePrepare
prepared
beforeCommit
committed
superseded
failed
cleanedUp
```

This supports plugins, diagnostics, preview, rollback, and performance timing without ad hoc global hooks.

## Effective theme

`EffectiveTheme` should contain exactly what gets committed:

- CSS variable map, not only a CSS string
- scoped static stylesheet URLs
- owned runtime class plan, if still needed
- effective Nuxt UI/app config
- effective backgrounds for current mode
- icon map
- component map
- metadata and warnings

Generate the CSS string only at the SSR/head boundary. Keeping a map enables precise diffs and resets.

---

# 10. Migration plan without a rewrite

## Phase 0: security and correctness

1. Fix extension force handling and add rollback-safe replacement.
2. Reuse strict ID validation and path containment for uninstall.
3. Enforce `expectedKind` and a theme-specific package schema.
4. Add `hasStyleSelectors` to server compilation.
5. Make icon registry request-local on SSR.
6. Correct documentation warnings immediately.
7. Decide that `v-theme` is DOM-target-only; migrate actual Nuxt UI prop consumers to `useThemeOverrides()` and `v-bind`.

**Exit criteria:** no silent overwrite, no arbitrary delete path, SSR includes theme CSS, and documented component-prop behavior is true.

## Phase 1: one owner for state application

1. Create `ThemeRuntime` with activation revision and structured status.
2. Move final app-config, CSS variables, backgrounds, icons, and component-map commit into the runtime.
3. Convert `useUserThemeOverrides()` to a thin store facade initialized once.
4. Batch effective-theme computation and DOM commit.
5. Unify selection persistence.
6. Remove direct apply calls from settings components.

**Exit criteria:** one user action produces one effective commit; rapid switching is deterministic.

## Phase 2: compiler and manifest consolidation

1. Extract canonical `compileThemeDefinition()`.
2. Make client, server, CLI, and tests use it.
3. Generate a lightweight metadata manifest and lazy compiled payloads.
4. Fix selector parsing/source order and comma-list CSS scoping.
5. Generate token/target types and documentation.

**Exit criteria:** one definition produces byte-equivalent compiled semantics everywhere; inactive themes are not eagerly imported.

## Phase 3: remove compatibility machinery

1. Delete `92.theme-lazy-sync.client.ts`.
2. Remove duplicate `page:finish`/`useThemeClasses()` selector application paths.
3. Remove or adopt orphaned composables.
4. Deprecate arbitrary theme `app.config.ts` in favor of a constrained `ui` patch.
5. Replace runtime selector classes with static CSS or one owned hook coordinator.
6. Make core default components lazy where practical.

**Exit criteria:** the runtime has one activation path and a much smaller plugin surface.

## Phase 4: platform-grade features

1. Declarative safe themes and trusted code themes.
2. Theme inheritance/composition.
3. Compatibility/version metadata.
4. Preview sandbox and rollback.
5. Theme inspector/devtools.
6. visual, accessibility, and performance gates.

---

# 11. Features that would make the system genuinely exceptional

## 11.1 Theme target registry

A first-class catalog of every themable UI target, allowed props, context, states, and contract version. Generate autocomplete, docs, validation, an interactive gallery, and inspector data from it.

## 11.2 Live preview with rollback

Preview a theme in an iframe or isolated root before committing it globally. Capture activation errors, missing assets, contract violations, and contrast failures. Automatically revert to the last-known-good theme.

## 11.3 Theme inspector

A development panel that answers:

- active theme/mode/contrast
- target name/context/identifier
- matched selectors in order
- winning source for each prop/token
- conflicting classes
- loaded assets and their timing
- app-config diff
- user override diff
- activation timeline

This would eliminate much of the current debugging guesswork.

## 11.4 Compatibility manifest

```json
{
  "themeEngine": ">=2 <3",
  "appApi": "^1.4",
  "componentContracts": {
    "chat-input": "^2"
  },
  "requiredTargets": ["button", "input"],
  "capabilities": ["tokens", "icons", "backgrounds"]
}
```

Reject incompatible packages before installation.

## 11.5 Inheritance and recipes

Allow themes to extend a neutral OR3 base or another theme at compile time. Provide reusable recipes for density, shape, shadows, typography, and motion. Materialize inheritance during compilation to preserve fast runtime lookup.

## 11.6 Automatic accessibility audit

During validation and preview:

- WCAG contrast pairs
- focus indicators
- forced-colors behavior
- reduced-motion support
- minimum touch targets
- text scaling at 200%
- background pattern interference

Make violations visible before a theme can be published.

## 11.7 Performance budgets

Record and gate:

- cold theme preparation
- warm switch time
- commit time
- selector matching time
- layout/style recalculation
- asset bytes and request count
- number of DOM writes
- number of components invalidated

Suggested initial budgets on a representative app screen:

- warm switch JavaScript work under 16 ms
- visual commit within one animation frame after preload
- zero full-document selector rescans during ordinary navigation
- one user-override commit per frame maximum
- no additional network request when switching to a warm cached theme

## 11.8 Theme package signatures and provenance

Show package checksum, source URL, publisher, signature status, requested capabilities, external origins, and whether it contains executable code. This is essential for a serious theme ecosystem.

## 11.9 User profile import/export and migrations

Version user override schemas, migrate safely, and let users export/import profiles independently of base themes. Store image references by content hash and report missing assets.

## 11.10 Visual regression matrix

Every built-in or published theme should render a canonical gallery of targets and key application screens. Generate screenshot diffs for light/dark, contrast modes, mobile/desktop, and custom components.

---

# 12. What should remain unchanged

Do not rewrite these merely for novelty:

- the `app/theme/<name>/` package convention
- `defineTheme()` as the author-facing entry
- the concept of semantic tokens
- the indexed runtime resolver
- optional icons and backgrounds
- theme-specific Nuxt UI configuration, after constraining its merge boundary
- the custom-component feature, after adding trust and compatibility contracts
- `import.meta.glob` as a loader implementation detail, once backed by generated metadata
- existing built-in theme designs

The resolver itself is not the main bottleneck. Its per-component index and bounded cache are reasonable. Improve parser semantics, source order, immutable outputs, and prop-map merging, but do not replace it with a large generic CSS engine.

---

# 13. Recommended first pull requests

## PR 1: extension filesystem safety

- fix force overwrite logic
- export/reuse extension ID schema
- path containment and manifest identity checks on uninstall
- expected-kind enforcement
- rollback-safe replacement
- regression tests

## PR 2: SSR parity

- canonical `compileThemeDefinition()`
- add missing server fields
- request-local icon registry
- server/client compiled parity tests
- server disabled-theme parity

## PR 3: user override performance

- initialize store once
- remove per-consumer deep watchers
- batch commit and debounce persistence
- selective blob invalidation
- fix undefined-versus-null layer merge
- remove redundant `reapply()` calls

## PR 4: component override truthfulness

- migrate Nuxt UI prop consumers to `useThemeOverrides()` + `v-bind`
- reduce `v-theme` to target annotation/DOM hooks
- remove ineffective lazy force-update dependency
- add target registry aliases
- update docs and examples

## PR 5: transactional activation and config reset

- activation revision/token
- prepare/preload/commit/cleanup phases
- recompute app config from base on every switch
- only one background and selector commit owner
- rapid-switch and failure rollback tests

## PR 6: build and manifest performance

- generated metadata manifest
- lazy compiled payloads and app config
- Vite fail-on-error fix
- deterministic generated files
- CSS selector list scoping fix

---

# Final assessment

The theme system is ambitious and already contains many of the capabilities required for a top-tier platform. Its weakness is not lack of features. It is **unclear ownership and duplicated orchestration**.

The highest-leverage move is to make one runtime responsible for one immutable effective theme and one transactional commit. Once that exists, the client/server plugins, user overrides, selector runtime, icons, backgrounds, persistence, and custom components can become small adapters rather than competing state machines.

That approach preserves the current themes and authoring model, fixes the real performance and correctness problems, and creates a foundation for safe installable themes, live previews, compatibility contracts, inspector tooling, accessibility validation, and a serious ecosystem.

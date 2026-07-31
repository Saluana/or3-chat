# Host ESM facade production spike

**Decision:** post-build `ModuleV2Loader` trusted-host UI is formally blocked and
reported as `rebuild-required`. Post-build UI must use a future isolated-client
or declarative path. This does not claim that either isolation path is shipped.

The Nuxt production build currently emits hashed application chunks, not stable
public ESM entries for the host's Vue and `@or3/plugin-sdk` module instances. It
also emits no import map connecting package bare imports to those instances.
Pointing a runtime package at another bundled Vue copy would split component and
reactivity identity, so the loader must not do that.

`shared/plugins/host-esm-facade.ts` is the fail-closed capability gate. It permits
trusted-host `ModuleV2Loader` UI only when a production browser suite proves all
of the following independently:

- a build-generated facade and predeclared import map exist;
- plugin and host share Vue module identity;
- plugin and host share SDK runtime identity;
- cross-boundary Vue reactivity works;
- a plugin component renders through the host renderer; and
- the path works under the production CSP without `eval` or `new Function`.

The production build probe writes
`.output/plugin-runtime/host-esm-facade-report.json`. The current expected report
is `rebuild-required`; any partial facade remains blocked. This preserves the
allowed `vue` external for rebuild-time V2 packages without representing it as a
safe post-build loader capability.

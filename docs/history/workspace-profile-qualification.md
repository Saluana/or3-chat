# Workspace profile qualification evidence

This record preserves the manual smoke and automated coverage notes that were
previously embedded in the public workspace-profile reference. It was moved on
October 1, 2026; that is not the date the recorded smoke checks ran. Those notes
did not record a run date and have not been rerun as part of documentation cleanup.
The [maintained guide](../../public/_documentation/architecture/workspace-profiles.md)
describes the current runtime contract.

## Recorded coverage and limitations

The [server bootstrap plugin](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/plugins/93.workspace-profiles.server.ts)
resolves built-in profiles and validated profiles it can load from themes. Its
[request test](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/plugins/__tests__/workspace-profile-server.test.ts)
covers request isolation and a theme-provided profile. The
[rendered hydration test](https://github.com/Saluana/or3-chat/blob/or3-cloud/tests/integration/workspace-profile-hydration-render.integration.test.ts)
SSR-renders a Vue probe, hydrates it in a DOM, and checks that serialized
built-in profile markup stays in place without Vue hydration warnings. It does
not boot a built Nuxt server or load a client package.

A separate local browser check of a built Nuxt app confirmed that applying
Document Workspace survives a hard reload without hydration warnings. HTTP
payload checks also confirmed Standard OR3 fallback for an unavailable
Coding Workspace ID and for a selection cookie scoped to another workspace.
That check used an isolated Undici 7 override because the installed Undici 8
requires a worker-thread API missing from Bun. It verifies the built-in
profile boundary, but does not qualify the normal production build or an
authenticated client-package transition.

To verify that boundary in a browser, use a disposable SSR-auth workspace with
External Agents installed and enabled. In the Dashboard's **Workspace Profile**
settings, apply **Coding Workspace**, then hard-reload the workspace. Capture
the response payload and browser console: SSR should resolve to Standard OR3
because Coding Workspace is registered by the client package through the
[External Agents host bridge](https://github.com/Saluana/or3-chat/blob/or3-cloud/app/composables/plugins/external-agent-host-bridge.ts);
after the package registers, the client should restore Coding Workspace. Check
that hydration emits no Vue mismatch warnings and that the profile selector
settles on Coding Workspace. Repeat in another workspace to check the
workspace-scoped selection cookie. This authenticated client-package path
remains unverified.


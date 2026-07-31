# Component Review - High

## 1) Monolithic chat message renderer with too many responsibilities
- Files: `app/components/chat/ChatMessage.vue:346`, `app/components/chat/ChatMessage.vue:700`, `app/components/chat/ChatMessage.vue:987`
- Problem: Rendering, hydration, thumbnail lifecycle, markdown/code highlighting, and plugin action wiring are tightly coupled in one large component.
- Recommendation: Split into focused composables/components (`useMessageThumbnails`, hydration helper, markdown renderer wrapper) and keep the root message component orchestration-only.
- Status: ✅ Resolved
- Implementation: `app/composables/chat/useMessageThumbnails.ts`, `app/composables/chat/useMessageMarkdown.ts`, `app/components/chat/ChatMessage.vue`

## 2) Admin system page is an all-in-one maintenance bottleneck
- File: `app/pages/admin/system.vue:1`, `app/pages/admin/system.vue:240`
- Problem: Status cards, operations, provider actions, config form handling, normalization watchers, and mutation flows all live in one page.
- Recommendation: Decompose into sub-panels (`StatusCard`, `OperationsPanel`, `ProviderActions`, `ConfigForm`) and move save/action orchestration into composables.
- Status: ✅ Resolved
- Implementation: `app/components/admin/system/AdminSystemStatusCard.vue`, `app/components/admin/system/AdminSystemOperationsCard.vue`, `app/components/admin/system/AdminSystemProviderActions.vue`, `app/pages/admin/system.vue`

## 3) Sync harness page is monolithic and difficult to maintain
- File: `app/pages/tests/sync-harness.vue:216`
- Problem: Test catalog, async runner logic, logging helpers, state wiring, and UI rendering are packed into a single oversized page.
- Recommendation: Move test definitions and runner helpers into plain `.ts` modules/composables; keep the page focused on status display and control wiring.
- Status: ✅ Resolved
- Implementation: `app/composables/tests/syncHarnessRunner.ts`, `app/pages/tests/sync-harness.vue`

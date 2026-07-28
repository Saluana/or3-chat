# Activity, Agents, and Profiles Compatibility Baseline

Recorded: 2026-07-27

## Repository baseline

| Repository | Branch | Commit | Role |
|---|---|---|---|
| `Saluana/or3-chat` | `or3-cloud` | `60161554668bf89a0bf2c652a7f5fa688bb51376` | Activity UI/adapters, External Agents client UI, Workspace Profiles |
| `Saluana/or3-intern` | `remove-agent` | `68197a8840898c5ed367a1b0dfa2cb58b8be74a3` | Canonical runner/session/job/approval service and shared protocol owner |
| `Saluana/or3-app` | `remove-agent` | `28e7cb1245945bc9dae8f394319769d30cfd55a6` | Existing consumer used to prove shared-client compatibility |

`remove-agent` is the paired branch currently checked out in both `or3-intern`
and `or3-app`. Implementation must not switch either repository implicitly.

## Existing ownership boundaries

- Workflows: OR3 workflow execution state and hooks remain canonical.
- Background chat: existing background job trackers and server run store remain
  canonical.
- Document AI: editor lifecycle remains canonical; Activity integration is
  conditional on a framework-free read boundary.
- External agents: `or3-intern` owns runner discovery, CLI execution,
  authentication readiness, roots, permissions, sessions, events, approvals,
  artifacts, and cancellation.
- UI surfaces: sidebar, pane app, dashboard, and command registries remain
  canonical. Workspace Profiles reference their IDs.

## Service contract used by clients

| Area | Method and path | Existing `or3-app` consumer |
|---|---|---|
| Health | `GET /internal/v1/health` | `useHostReachability`, `usePairing` |
| Readiness | `GET /internal/v1/readiness` | app bootstrap/connection UI |
| Capabilities | `GET /internal/v1/capabilities` | app bootstrap/feature gates |
| Pairing bootstrap | `GET /internal/v1/app/bootstrap` | `usePairing` |
| Secure pairing | `POST /internal/v1/secure-connections/pairing/approve` | `usePairing` |
| Runner discovery | `GET /internal/v1/chat-runners` | `useChatRunners` |
| Runner fallback discovery | `GET /internal/v1/runner-runners` | `useChatRunners`, `useJobs` |
| Create session | `POST /internal/v1/runner-chat/sessions` | runner chat composables |
| Session detail | `GET /internal/v1/runner-chat/sessions/:id` | runner chat composables |
| Start/follow-up turn | `POST /internal/v1/runner-chat/sessions/:id/turns` | runner chat composables |
| Turn events | `GET /internal/v1/runner-chat/sessions/:id/turns/:turn/events?after_seq=N` | runner chat composables |
| Turn stream | `GET /internal/v1/runner-chat/sessions/:id/turns/:turn/stream?after_seq=N` | runner chat composables |
| Cancel turn | `POST /internal/v1/runner-chat/sessions/:id/turns/:turn/abort` | runner chat composables |
| Turn approval | `POST /internal/v1/runner-chat/sessions/:id/turns/:turn/approve` | runner chat composables |
| Jobs | `GET /internal/v1/jobs/:id`, `GET .../stream`, `POST .../abort` | `useJobs` |
| Artifacts | `GET /internal/v1/artifacts/:id` | `useJobs` |
| Approval queue | `GET /internal/v1/approvals` | `useApprovals` |
| Approval decisions | `POST /internal/v1/approvals/:id/{approve,deny,cancel}` | `useApprovals` |

## Existing OR3 Chat extension points

- Typed hook engine and `useHookEffect` provide isolated lifecycle-aware
  subscriptions. Workflow state already emits
  `workflow.execution:action:state_update` and
  `workflow.execution:action:complete`.
- `usePaneApps`, `useSidebarPages`, `useDashboardPlugins`, and the command
  palette registry use owned registration handles and HMR-safe cleanup.
- Workspace-scoped Dexie databases and KV helpers are the persistence boundary
  for lightweight UI preferences.
- `DEFAULT_MAX_PANES` and `useMultiPane` remain the deployment/runtime pane-limit
  authority.

## Compatibility gates

1. Freeze representative Go response/SSE fixtures before extracting a client.
2. Keep the shared client framework-free and inject transport/auth/storage.
3. Migrate `or3-app` through a compatibility adapter before OR3 Chat consumes
   the package.
4. Reject unknown provider features unless the host advertises them.
5. Treat route, response, error-code, and SSE sequence changes as contract
   changes requiring both client suites.


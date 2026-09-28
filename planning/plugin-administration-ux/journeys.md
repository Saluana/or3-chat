# Browser journey qualification

These cases use a disposable host and signed, locally approved test releases. The browser must show the operation named by the server; a successful package selection never stands in for workspace enablement or runtime observation.

| Journey | Browser action | Server operation and expected result |
| --- | --- | --- |
| First install with consent and setup | Open an exact release; review its complete authority; approve; supply required setup; Continue. | Preflight, digest-bound grant review, one durable acquisition operation, candidate canary, promotion, then workspace rollout preview. Setup pause precedes package selection. Retry resumes the same operation ID. |
| Admin session expires | Start an install, let the admin session expire, then sign in and return to the deep link. | The mutation refuses unauthorized access. After sign-in, restore the operation for the same plugin, version, workspace and install request; no second acquisition starts. |
| Workspace changes | Open a plugin in workspace A, switch to B before consent or Continue. | The stale A response cannot authorize B. An A-owned operation is identified as such and can resume only from A; B requires its own consent/setup. |
| Refresh during acquisition | Reload after candidate download or setup pause. | The page reads the durable operation, displays the frozen release and Continue, and does not replay a successful candidate or workspace write. |
| Shared update blocked | Stage a proposed version while another enabled workspace needs grant review or setup. | Update view keeps current and proposed versions distinct; preflight lists the blocked workspace; promotion does not change the selected digest or future default. |
| Return from scoped setup | Follow Configure from a paused install or update and return. | The plugin, release, workspace and operation remain in the URL/record; Continue rechecks setup and signed authority before promotion. |

At 1440px and 375px, verify keyboard focus, no horizontal overflow from errors or digests, and a screenshot of each completed or blocked outcome. Include both a browser-observed activation and a 30-second unobserved result. A no-model Workflows run proves only the simple path recorded in its receipt. A separate portable release pair must exercise UI update and compatible restore.

## Health and recovery failure cases

| Case | Expected result | Existing verification seam |
| --- | --- | --- |
| Browser reports the right version with a different digest or workspace | No running claim; retry observes only the selected digest in the selected workspace. | Installed health component and portable activation tests |
| Workspace is unopened or browser observation reaches 30 seconds | Enabled remains true; browser check is pending, with Run check and Open available. | Installed health component and activation confirmation tests |
| Server status refresh fails | Check unavailable; cached enablement is not treated as a new server confirmation. | Installed health component |
| Required pane/sidebar contribution fails | Needs attention with the failing contribution named. | Portable activation and Installed health component |
| Optional contribution fails | Running can still be confirmed, with the degraded contribution named. | Portable activation and Installed health component |
| Previous release is quarantined, revoked, corrupt, or missing | Restore is refused before pointer commit; current selection stays active. | Rollback route and package promotion tests |
| Another enabled workspace lacks old authority, setup, or compatible state | Restore review identifies that workspace; no pointer swap. | Rollback workspace preflight tests |
| Enabled workspace set changes after review | Reviewed set fingerprint fails at commit; refresh impact review. | Rollback workspace preflight tests |
| Failure before pointer commit | Current selection and data remain; repair and review again. | Package promotion and rollback tests |
| Observer fails after pointer commit | Return the committed selected version and pending browser check, without inviting an unsafe duplicate restore. | Rollback route and UI tests |

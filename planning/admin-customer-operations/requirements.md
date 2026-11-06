# Requirements

## Introduction

Build the customer support and operational capabilities described in the approved admin dashboard concepts. An administrator must be able to explain an account's effective access, diagnose a refused upload or stopped sync, and perform a narrowly scoped, recorded correction. Deliver the work in independently useful stages; reuse OR3's existing stores, policies, admin UI and provider adapters instead of building another administration platform.

## Context

Inspected on 2026-11-06 starting at `29c867d8` with billing/trial/accounting changes in progress; final source review confirmed those changes committed as `827da946` (`[Fix] Harden hosted billing against abuse`). OR3 uses Nuxt/Vue, Nuxt UI and theme tokens, Bun commands, Node for supported SQLite execution, Vitest and Playwright. Canonical identity and membership belong to `AuthWorkspaceStore`; admin search/workspace stores and provider adapters already exist. Hosted billing is an optional source module with private SQLite, Stripe Checkout/portal, account leases, revisioned allowance settings and a read-only canonical SQLite quota reader. The current trial implementation differs from the earlier review: `status()` still creates an absent billing account, but trial claims now run separately through eligibility checks. Both active and expired upload reservations count. Permanent filesystem/S3 cleanup is disabled; a dormant immutable-generation coordinator exists. Existing admin configuration, restart/update control and deployment backup tooling must be extended, not replaced.

## Assumptions

- This is an implementation plan only; it authorizes no production mutation, release, price change or cleanup run. Preserve ongoing checkout changes and refresh the baseline before implementation.
- The six mockups are approved visual direction. These saved copies are part of this plan and must be committed with it:

  | Screen | Saved mockup | Implementation home |
  |---|---|---|
  | Customers | [01-customers.png](assets/mockups/01-customers.png) | New `/admin/customers` |
  | Customer account | [02-customer-account.png](assets/mockups/02-customer-account.png) | New `/admin/customers/:id` |
  | Storage | [03-storage.png](assets/mockups/03-storage.png) | New `/admin/storage` |
  | Billing health | [04-billing-health.png](assets/mockups/04-billing-health.png) | Existing hosted-billing extension, with tabs |
  | Overview | [05-overview.png](assets/mockups/05-overview.png) | Existing `/admin` |
  | Configuration | [06-configuration.png](assets/mockups/06-configuration.png) | Existing `/admin/advanced` |

- [Instance admin](assets/reference-screenshots/instance-admin-existing.png) and [workspace settings](assets/reference-screenshots/workspace-admin-existing.png) are pre-existing repository captures, not fresh screenshots of this commit. The original review bundle remains at `../../../output/admin-dashboard-mockups-2026-11-06.zip`; this plan does not depend on that external copy.
- Written requirements override invented image content: no new subscription tiers, organization billing or monthly prices; default offer stays USD 40/year, 50 GB account allowance, 1 GB trial allowance, seven-day trial. GB is decimal. Correct all image arithmetic, dates, labels and navigation while implementing.
- BYOK means the customer's AI provider credentials. No PostgreSQL/GCS support or automatic migration is implied by the configuration image. Application labels come from actual handlers; background concurrency is not automatically a rebuild setting. Keep one Overview link and retain Registration, Administrators, Themes, Plugins and Webhooks.
- First implementation targets the existing hosted SQLite profile. Core inspection/settings pages also work on non-billing deployments when the provider supports the necessary reads; unsupported data is explicit. Billing is absent from static/non-hosted builds. No new support-agent role is introduced: cross-account inspection and actions use the existing separate super-admin authentication.
- Initial reads are bounded and on demand. Start with 50 rows per page, 200 characters per search, and 1–500 characters for mandatory action reasons. Do not add a cache, worker queue or separate service without measurements.
- Release stages: A = inspector + refresh/review; B = storage + support exceptions/pauses; C = billing health, configuration, overview and activity; D = safe provider reclamation then retention; E = historical offers before any pricing change. D/E are planned functionality, not prerequisites for A–C.

## Out of Scope

- Replacing authentication, identity, the sync protocol, Stripe Checkout/portal, the plugin permission model or deployment updater.
- Reading conversations, prompts, documents, filenames/content, API keys, card information or raw webhook bodies in customer support pages; account impersonation.
- Team/seat billing, owner-sponsored member entitlement, Marketplace license bundling, metered AI billing, a general pricing engine or a new telemetry platform.
- Changing existing live prices, tax settings, trial eligibility defaults or retention promises as part of the dashboard rollout. Review tax configuration separately before any future commercial offer change; this plan does not enable collection.
- Automatic identity/provider migration; arbitrary SQL, object deletion, counter resets, raw environment editing or direct shell execution from the dashboard.

## Requirements

### R1: Familiar, accessible administration

**User Story:** As an operator, I want the new screens to fit the existing admin application so I can use them without learning a different product.

**Acceptance Criteria:**
- R1.AC1: WHEN the pages are implemented THEN they SHALL use the six saved mockups for visual hierarchy and existing Nuxt UI/theme components for behavior, retaining existing navigation and correcting the illustrative details above.
- R1.AC2: WHEN viewed at 1440px and 390px widths, in light and dark themes, THEN actions, labels and errors SHALL remain usable with keyboard navigation, visible focus, labeled controls and announced results; tables may scroll inside their container.
- R1.AC3: WHEN a page loads, a section fails or an action is pending THEN it SHALL distinguish loading, empty, unavailable, stale and failed states, and SHALL prevent duplicate submissions while retaining recoverable input.

### R2: Support privacy and authorization

**User Story:** As a deployment owner, I want support tools to expose operational metadata without expanding access to workspace content.

**Acceptance Criteria:**
- R2.AC1: WHEN any cross-account read or mutation is requested THEN the server SHALL require the existing super-admin context, no-store responses and explicit target IDs; ordinary members, workspace admins and deployment-admin grants alone SHALL be denied.
- R2.AC2: WHEN a mutation is requested THEN existing host/origin/intent checks, bounded validated bodies and applicable rate limits SHALL run before the operation; the actor SHALL come from the authenticated principal.
- R2.AC3: WHEN an administrator opens/searches an account THEN neither the target's trial/account/membership nor the administrator's workspace SHALL be provisioned; no Stripe request SHALL run automatically.
- R2.AC4: WHEN operational records are returned or logged THEN secrets, private workspace content and raw payment payloads SHALL be excluded. Workspace ownership/membership SHALL still come from the canonical store.

### R3: Customer directory and account inspection

**User Story:** As a support administrator, I want to find a canonical user and see their account situation in one place.

**Acceptance Criteria:**
- R3.AC1: WHEN searching by canonical ID, email or display name THEN results SHALL be bounded and paginated, with identity, independent payment/access states, storage accounting and available last-contact observations.
- R3.AC2: WHEN filtering by paid, trial or needs-attention state THEN filtering SHALL apply to the matching population on the server, not just the visible page; unsupported filters/counts SHALL be labeled unavailable.
- R3.AC3: WHEN opening an account THEN owned workspaces (including retained deleted workspaces), memberships, trial eligibility decision, trial deadline, paid-through date, grace, cancellation, reviews and support history SHALL be shown when available. An absent billing record SHALL appear as “Cloud not started,” without a write.
- R3.AC4: IF a supporting provider fails THEN the account SHALL retain independently available sections with explicit failed/unknown status rather than presenting zero usage or denied access as fact.

### R4: One explanation of effective access

**User Story:** As a support administrator, I want the exact controlling restriction so I can fix the right problem.

**Acceptance Criteria:**
- R4.AC1: WHEN evaluating access THEN the same server domain logic used by enforcement SHALL supply payment facts, entitlement source/deadline and ordered blocking reasons; a review or suspension SHALL override an ordinary grant.
- R4.AC2: WHEN diagnosing a target workspace/upload THEN provider availability, uploader entitlement, owner entitlement/allowance, membership permission, workspace cap, file size/type and relevant operational pause SHALL remain separate checks; increasing an account allowance SHALL NOT bypass another check.
- R4.AC3: WHEN a payment/trial/grant/pause expires or is revoked THEN subsequent admission and active sync-stream checks SHALL use the effective state; expiry SHALL preserve Free Local editing, foreground BYOK, downloads, export, billing/recovery and existing admitted-work completion rules.
- R4.AC4: WHEN reporting sync state THEN last server contact, successful server operation and recorded failure SHALL be distinguished, with observation times and coverage; offline device contents SHALL never be inferred.

### R5: Safe Stripe refresh and payment review resolution

**User Story:** As a support administrator, I want to reconcile and deliberately resolve payment holds without editing the private database.

**Acceptance Criteria:**
- R5.AC1: WHEN Refresh from Stripe runs THEN it SHALL use the existing reconciliation service, account lease and timeout/error handling, show the outcome, and SHALL NOT clear a review automatically or invent payment facts.
- R5.AC2: WHEN a review is resolved THEN the administrator SHALL inspect its recorded reason, perform a successful reconciliation, and submit a reason against the current review revision. A concurrent/new review or unresolved conflicting subscriptions SHALL block stale resolution.
- R5.AC3: WHEN a review decision commits THEN review state and its audit record SHALL commit together; resolving a hold SHALL only remove that hold, with access recomputed from remaining facts.
- R5.AC4: WHEN historical held accounts have no recorded reason THEN they SHALL show “Legacy review — reason unavailable”; failed refresh, repeated commands and delayed/duplicate risk events SHALL not silently clear or recreate an already resolved identical review.

### R6: Accurate storage management

**User Story:** As an operator, I want to explain storage admission and adjust the actual limiting allowance.

**Acceptance Criteria:**
- R6.AC1: WHEN viewing accounting THEN retained charged bytes and deduplicated active/expired reservations SHALL equal the admission total for the same snapshot; active versus deleted-retained bytes SHALL be separate where provable, with unknown/unclassified portions explicit.
- R6.AC2: WHEN reviewing usage THEN account allowance, owner-workspace contributions, workspace caps, pending/expired reservations, physical measurements, scope, completeness and observation time SHALL be distinct. Shared uploads SHALL identify both uploader entitlement and owner budget.
- R6.AC3: WHEN inspecting physical usage THEN it SHALL be explicitly requested with bounded scope/progress; opening Overview or Customers SHALL NOT scan a bucket/filesystem. Unknown, partial and stale physical totals SHALL not display as current zeroes.
- R6.AC4: WHEN changing global allowances, account bonuses or workspace caps THEN a revisioned impact preview SHALL show affected counts and paginated examples; confirmation SHALL revalidate policy/account revisions. Existing bytes SHALL remain available; lower limits SHALL only refuse additional admission.
- R6.AC5: WHEN supported upload policies change THEN maximum file size, allowed types and workspace caps SHALL be enforced at the existing admission/verification boundaries. Capacity warnings SHALL compare explicit thresholds to measured usage and capacity.
- R6.AC6: WHILE safe cleanup is unavailable THEN UI SHALL explain that deletion and reservation expiry do not release charged bytes, and SHALL offer only supported remedies.

### R7: Audited account exceptions

**User Story:** As a support administrator, I want targeted temporary remedies without changing payment evidence or global policy.

**Acceptance Criteria:**
- R7.AC1: WHEN granting access, extending a trial or adding storage THEN a dedicated support record SHALL preserve Stripe facts and original trial/eligibility history; each mutation SHALL record actor, reason, before/after and time.
- R7.AC2: WHEN granting access THEN an explicit future expiry and storage allowance SHALL be required; grants SHALL be revocable and SHALL not bypass reviews, suspensions, unavailable providers or permissions.
- R7.AC3: WHEN extending a trial or overriding a legitimate denial THEN the extension SHALL be separate from the original deadline and decision; it SHALL not restart eligibility or affect an existing paid subscription.
- R7.AC4: WHEN adding account storage THEN a nonnegative additional byte allowance SHALL apply over the effective plan/grant allowance, with optional expiry and revision checks; a bonus alone SHALL not grant Cloud access.
- R7.AC5: WHEN an account is paused/resumed THEN only hosted admissions/transport SHALL change, with a reason, actor, optional expiry and visible scope; the preserved recovery/Free Local paths in R4 SHALL remain accessible.

### R8: Narrow operational pauses

**User Story:** As an operator, I want to stop new problematic work without unnecessarily taking the service offline.

**Acceptance Criteria:**
- R8.AC1: WHEN a deployment pause is applied THEN new uploads, new background jobs, new registrations or new purchases SHALL be individually controllable, with actor, reason, start, optional expiry and revision; per-account upload/background restrictions SHALL also be supported.
- R8.AC2: WHEN pauses are active THEN the actual server admission boundaries SHALL reject new work with distinct retry guidance, preserving downloads, sign-in, recovery, portal access and previously admitted work. Already issued upload grants and checkout sessions SHALL be described honestly, not claimed revoked.
- R8.AC3: WHEN a pause expires THEN evaluation SHALL stop enforcing it without a scheduler; resuming SHALL not bypass registration mode, billing or another independent policy.

### R9: Billing integration health and outcomes

**User Story:** As an operator, I want missed or failed reconciliation and payment reviews to be visible.

**Acceptance Criteria:**
- R9.AC1: WHEN opening billing health THEN test/live environment, current advertised offer, price-match validation with timestamp, latest reconciliation, paid/trial/expired counts and unresolved reviews SHALL be displayed without exposing credentials or doing a global Stripe refresh.
- R9.AC2: WHEN a verified webhook or account refresh is processed THEN a bounded structured outcome SHALL record source/event identity, account if known, time, result and safe error code. Webhook deduplication SHALL remain separate from failure recording.
- R9.AC3: IF processing fails THEN no success/dedup marker SHALL be written, the delivery SHALL retain retry behavior, and history SHALL distinguish payment failure from webhook-processing failure.

### R10: Effective deployment configuration

**User Story:** As an operator, I want to know which setting controls behavior and when a saved change applies.

**Acceptance Criteria:**
- R10.AC1: WHEN reading configuration THEN actual build/deployment profile, installed providers, billing inclusion and enforced properties SHALL be reported separately from account permissions.
- R10.AC2: WHEN a setting is displayed THEN effective running value, source, pending saved value and application status SHALL be accurate and redacted where necessary; an unset environment value SHALL not override a resolved default in the display.
- R10.AC3: WHEN editing is supported THEN the existing configuration/controller path and revision checks SHALL be used. Labels SHALL distinguish immediate, refresh, restart, rebuild, migration and unavailable; provider switches SHALL not pretend to migrate data.
- R10.AC4: WHILE hosted billing is installed THEN BYOK and no-guest requirements SHALL be shown as enforced; sync-off SHALL not imply that canonical backend data or credential-vault dependencies disappear.

### R11: Resource and feature policy

**User Story:** As an operator, I want frequently used policies grouped clearly and safely editable where supported.

**Acceptance Criteria:**
- R11.AC1: WHEN inspecting deployment controls THEN AI funding, background enablement/concurrency/timeouts, rate-limit groups for AI/sync/uploads/webhooks, model limits, features, plugins and registration SHALL point to existing owning settings and their effective sources.
- R11.AC2: WHEN an existing setting has no safe runtime writer THEN it SHALL remain informational with the supported deployment application path; adding an editor SHALL require validation and enforcement together, not a duplicate flag.
- R11.AC3: WHEN showing AI funding THEN allowing user overrides and requiring user keys SHALL have different explanations; hosted policies SHALL take precedence. Workspace model/feature settings SHALL remain bounded by deployment policy.

### R12: Actionable overview and recovery evidence

**User Story:** As an operator, I want the home page to show what needs attention and what recovery evidence actually exists.

**Acceptance Criteria:**
- R12.AC1: WHEN opening Overview THEN it SHALL link to review queues, processing failures, over/near-quota accounts, provider failures, background recovery, stale/missing backup verification and pending configuration where these are supported, with source and time.
- R12.AC2: WHEN showing provider status THEN enabled, checked-healthy, failed, stale and unknown SHALL be separate, and every health claim SHALL identify the check and timestamp.
- R12.AC3: WHEN showing backup coverage THEN canonical data, auth, files, configuration, billing/trial data and separately protected credential recovery keys SHALL each show evidence/unknown, last verification, independent-copy evidence, last recovery test and incomplete operations. App health alone SHALL not mark a backup verified.
- R12.AC4: WHEN recovery information is unsupported THEN UI SHALL offer existing documented CLI/operator paths without broadening the web process's host privileges.

### R13: Shared administrative history

**User Story:** As an operator, I want to know who changed access, limits or configuration and why.

**Acceptance Criteria:**
- R13.AC1: WHEN support, quota, pause, workspace delete/restore, plugin-permission, configuration or deployment actions occur THEN history SHALL identify actor, target, time, action, safe before/after, reason where sensitive and outcome.
- R13.AC2: WHEN an action is retried or crashes THEN its stable operation ID SHALL prevent duplicate successful mutations and history SHALL distinguish attempted, completed, failed and incomplete operations; audit persistence failure SHALL not produce unrecorded success for access/quota/review actions.
- R13.AC3: WHEN searching activity THEN target, actor, action and time filters SHALL be bounded/paginated; unavailable sources and the start of recorded coverage SHALL be explicit. Secrets/content SHALL never be serialized to the history.

### R14: Safe reclamation and later retention automation

**User Story:** As an operator, I want eligible deleted storage to be safely reclaimed so customers can reuse their allowance.

**Acceptance Criteria:**
- R14.AC1: WHEN enabling cleanup for a provider pair THEN canonical writers, immutable object identity, reference checks, active/expired upload handling, deletion barriers, retries and crash recovery SHALL first pass the existing generation-coordination contract and lifecycle qualification; unsupported/legacy objects SHALL stay retained.
- R14.AC2: WHEN reclaiming THEN a bounded dry run SHALL precede explicit destructive confirmation, and actual deletion SHALL recheck eligibility under the canonical barrier. Accounting SHALL be released exactly once only after verified exact-generation removal; delayed uploads/writers SHALL not resurrect that generation.
- R14.AC3: IF deletion, accounting completion or process recovery fails THEN the durable operation SHALL remain resumable and charged until safe completion; ambiguity SHALL block cleanup.
- R14.AC4: WHEN retention automation is later enabled THEN it SHALL use the same qualified primitive, be opt-in with scope/age/batch limits and audit evidence, and respect recovery/retention promises. Full expired-account deletion SHALL require separate approval and is not implied by file reclamation.

### R15: Safe evolution of offers

**User Story:** As an operator, I want future offer changes without stranding existing subscribers or changing existing trial promises.

**Acceptance Criteria:**
- R15.AC1: BEFORE an editable checkout price is exposed THEN current checkout price and accepted historical prices SHALL be separate, with a small versioned offer record containing amount/currency/interval/storage/trial duration/status.
- R15.AC2: WHEN a new offer becomes current THEN existing subscriptions SHALL remain matched to their accepted offer, existing trial deadlines SHALL remain unchanged, and newly eligible trials SHALL use the new default.
- R15.AC3: WHEN retiring an offer for new purchases THEN reconciliation SHALL continue recognizing existing subscriptions; unsupported/ambiguous matches SHALL become review cases, not silently erase paid dates. No existing subscriber SHALL be automatically migrated.

### R16: Repeatable verification and staged delivery

**User Story:** As the maintainer, I want each stage to be independently safe to ship and supported by repeatable evidence.

**Acceptance Criteria:**
- R16.AC1: BEFORE implementing each behavioral slice THEN its failure cases and primary E2E/owner-boundary coverage SHALL be written; unit tests SHALL not be added after production code merely to mirror its implementation.
- R16.AC2: WHEN a stage is accepted THEN its relevant tests/typechecks SHALL pass with retained screenshots, traces and machine-readable state/operation receipts using disposable data; failures introduced by the stage SHALL not be waived.
- R16.AC3: WHEN provider contracts, configuration or public behavior change THEN affected provider READMEs and `public/_documentation/` entries via `docmap.json` SHALL be updated.
- R16.AC4: BEFORE shipping destructive/provider/recovery changes THEN clean installed-package qualification and disposable backup/update/rollback/restart checks SHALL pass under repository release rules. Dashboard implementation SHALL not bypass published-version or production-deployment gates.

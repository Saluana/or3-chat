# Tasks

## 1. Policy and architecture spike

- [ ] 1.1 Build a throwaway local Capacitor shell that presents one native-managed remote WebView without the Capacitor bridge
      Requirements: R2.AC1, R3.AC1, R3.AC2
      Done when: iOS and Android proof builds load the qualification OR3 instance, `window.Capacitor` is absent in the remote page, and the root Capacitor WebView remains on bundled local assets.

- [ ] 1.2 Prove exact current theme, V1 UI plugin, and V2 logic-package rendering in the remote surface
      Requirements: R2.AC1, R2.AC2, R2.AC4
      Done when: the proof build renders a non-default theme and both plugin classes, then observes a server-side theme/plugin revision after WebView reload without rebuilding the mobile app.

- [ ] 1.3 Implement a native-only camera/file action proof that hands one attachment to OR3 without exposing a callable native bridge to the remote page
      Requirements: R3.AC2-R3.AC4, R4.AC2, R7.AC3
      Done when: a user-selected image reaches an OR3 draft through a temporary test endpoint and hosted JavaScript cannot initiate camera or read a device credential.

- [ ] 1.4 Create an App Review/Play review positioning memo and request early policy feedback with the vertical slice
      Requirements: R7.AC1, R7.AC3, R7.AC8, R11.AC4-R11.AC6
      Done when: the memo maps the proof to Apple 2.5.2, 4.2, 4.7, 5.1 and current Google runtime-code, functionality, privacy, and AI policies; review feedback and required changes are recorded in the planning folder.

- [ ] 1.5 Record a go/no-go decision for the store runtime boundary
      Requirements: R3, R7, R11
      Done when: maintainers accept the separate-WebView/no-bridge boundary or document a policy-backed replacement before production scaffolding begins.

## 2. Shared mobile contracts

- [ ] 2.1 Add framework-free discovery, QR, device, session-ticket, software-index, inbox, report, policy-bundle, and error types under `shared/mobile/`
      Requirements: R1, R2, R3, R4, R5, R7, R9
      Done when: TypeScript discriminated unions represent every valid state in the design and contain no Nuxt, Vue, Node-only, Capacitor, Swift, or Android imports.

- [ ] 2.2 Add Zod boundary schemas and malicious/oversized fixture tests for every mobile wire type
      Requirements: R1.AC2-R1.AC3, R3.AC4, R4.AC2, R7.AC1-R7.AC2
      Done when: valid fixtures round-trip and invalid origins, URLs, sizes, enums, colors, versions, and unknown fields fail with stable safe error codes.

- [ ] 2.3 Implement origin normalization and remote-navigation policy as pure shared functions
      Requirements: R1.AC2, R3.AC2-R3.AC5, R4.AC5
      Done when: a table-driven suite covers Unicode/punycode hosts, default ports, redirects, userinfo, fragments, paths, loopback, IP literals, custom schemes, mixed content, local files, and user gestures.

- [ ] 2.4 Define mobile sensitive-value classifications and extend redaction fixtures
      Requirements: R5.AC3-R5.AC5, R6.AC3, R10.AC2
      Done when: QR secrets, device credentials, tickets, push tokens, report excerpts, and attachment URLs are redacted from server/native error fixtures.

## 3. Discovery and compatibility

- [ ] 3.1 Add typed mobile runtime configuration with disabled-by-default production settings
      Requirements: R1.AC3, R8.AC4, R9.AC3, R11.AC6
      Done when: config types, resolver tests, generated documentation, and environment metadata cover runtime range, public origin, mobile entry, policy URLs, minimum age, and feature gates.

- [ ] 3.2 Implement `/.well-known/or3-mobile.json` with proxy-safe origin resolution
      Requirements: R1.AC1-R1.AC3, R9.AC3
      Done when: the endpoint returns the validated V1 discovery contract, redirects never change origin, private fields are absent, and disabled/incompatible providers produce an explicit capability result.

- [ ] 3.3 Add the native chrome-palette projection to the theme resolver
      Requirements: R2.AC5
      Done when: active themes produce three validated colors, invalid/low-contrast values fall back to OR3 defaults, and arbitrary CSS/URLs cannot enter the discovery payload.

- [ ] 3.4 Add mobile compatibility diagnostics to `doctor`
      Requirements: R1.AC3, R9.AC1, R11.AC5
      Done when: `doctor` checks HTTPS/public origin, discovery, mobile store registration, auth support, privacy/deletion URLs, software index, and mobile entry reachability with actionable output.

## 4. Mobile device persistence

- [ ] 4.1 Define `MobileDeviceStore` and `MobileSafetyReportStore` contracts and registries following the ConnectStore pattern
      Requirements: R5, R7.AC4, R8
      Done when: contracts cover atomic pairing redemption, rotating credentials, session tickets, device revocation, inbox/report lifecycle, cleanup, and typed store errors.

- [ ] 4.2 Add canonical provider contract tests for device, pairing, ticket, inbox, and report stores
      Requirements: R4.AC2, R5.AC1-R5.AC6, R7.AC4, R8.AC3
      Done when: one suite proves atomicity, replay rejection, tenant scope, TTL cleanup, quotas, revocation, and idempotency against an in-memory reference implementation.

- [ ] 4.3 Implement SQLite migrations and the canonical mobile-store contracts in the SQLite provider
      Requirements: R4.AC2, R5, R7.AC4, R8
      Done when: recommended self-hosted SQLite passes the full contract suite, concurrent redemption/rotation tests, and upgrade/rollback migration tests.

- [ ] 4.4 Register and validate the SQLite mobile store in OR3 provider startup
      Requirements: R1.AC3, R5, R9.AC1
      Done when: recommended self-host startup reports mobile ready and a missing/mismatched store fails discovery/doctor without crashing unrelated web functionality.

- [ ] 4.5 Implement the same contracts in the Convex provider after the protocol stabilizes
      Requirements: R5, R8
      Done when: Convex passes the unchanged canonical suite and its schema/deployment changes follow the first-party provider release process.

## 5. Pairing, rotation, and browser sessions

- [ ] 5.1 Implement authenticated mobile-pairing request creation and QR rendering in OR3 account/device settings
      Requirements: R1.AC1, R5.AC1
      Done when: a signed-in user creates a 10-minute single-use request, sees hostname/expiry, and the server stores only a purpose-separated HMAC of the secret.

- [ ] 5.2 Implement challenge-bound pairing redemption with rate limits
      Requirements: R5.AC2-R5.AC3
      Done when: a valid app-generated public key receives one device credential and expired, replayed, denied, wrong-origin, malformed, and rate-limited requests issue none.

- [ ] 5.3 Implement short-lived mobile access tokens and rotating refresh credentials
      Requirements: R5.AC2, R5.AC5-R5.AC6
      Done when: refresh rotation, the 60-second retry window, replay outside the window, status checks, token audience/scope, and revocation all pass security tests.

- [ ] 5.4 Implement one-time browser session-ticket issuance and atomic consumption
      Requirements: R5.AC4
      Done when: a device credential creates a 60-second ticket, `/mobile/session` consumes it once, sets the standard secure session cookie, redacts the URL, applies no-store/no-referrer headers, and redirects to `/mobile`.

- [ ] 5.5 Add mobile device list, rename, last-seen, and revoke actions to web account settings
      Requirements: R1.AC5, R5.AC6, R8.AC1-R8.AC2
      Done when: users can distinguish browser sign-out from device revocation, revoke one device, and see its inbox/session access fail while other devices remain active.

- [ ] 5.6 Add bounded cleanup for pairing requests, tickets, revoked device metadata, expired inbox items, and report delivery attempts
      Requirements: R5, R7.AC4, R9
      Done when: cleanup is idempotent, batch-bounded, covered by retention tests, and never removes active credentials or unresolved local reports prematurely.

## 6. Capacitor shell foundation

- [ ] 6.1 Scaffold `mobile/` with pinned Capacitor, iOS, and Android projects and a minimal local Vue shell
      Requirements: R3.AC1, R11.AC1-R11.AC3
      Done when: Bun installs reproducibly, the shell builds into the configured local `webDir`, native projects compile, and production config contains no remote `server.url`, cleartext, wildcard navigation, or `allowNavigation`.

- [ ] 6.2 Implement the non-secret Instance Registry and migration/version handling
      Requirements: R1.AC4-R1.AC5, R8.AC2, R9.AC3
      Done when: multiple instance records persist across restart, corrupt/unknown versions fail safely, and removal deletes only the selected record.

- [ ] 6.3 Implement Keychain/Keystore credential vault adapters
      Requirements: R4.AC6, R5.AC2, R6.AC6, R8.AC2
      Done when: secrets never appear in Preferences, backups, logs, snapshots, or JavaScript storage and platform tests cover store/read/rotate/delete/device-lock failures.

- [ ] 6.4 Build the local onboarding, manual-address, QR-scan, confirmation, and instance-picker screens
      Requirements: R1.AC1-R1.AC4, R4.AC5, R9.AC1
      Done when: the user can discover, confirm, pair, open, switch, retry, diagnose, and remove instances without entering the remote surface.

- [ ] 6.5 Implement shell biometric lock and privacy-preserving app-switcher state
      Requirements: R4.AC6, R6.AC5
      Done when: enabled lock gates instance metadata/surfaces, passcode fallback works, screenshots/app switcher hide protected content, and denial does not delete credentials.

- [ ] 6.6 Implement native diagnostics and categorized recovery UI
      Requirements: R9.AC1-R9.AC3
      Done when: DNS, TLS, discovery, compatibility, pairing, session, policy, and renderer failures show safe actionable states rather than a blank WebView.

## 7. Origin-locked remote surfaces

- [ ] 7.1 Implement `Or3RemoteSurfaceViewController` and per-instance/origin WKWebsiteDataStore handling on iOS
      Requirements: R1.AC4, R2.AC1, R3.AC2-R3.AC4, R9.AC2
      Done when: the controller loads one paired origin, lacks Capacitor handlers, isolates instance data, enforces navigation decisions, and recovers once from WebContent process termination.

- [ ] 7.2 Implement `Or3RemoteSurfaceActivity` and origin-scoped WebView cookie/storage handling on Android
      Requirements: R1.AC4, R2.AC1, R3.AC2-R3.AC4, R9.AC2
      Done when: the activity matches the iOS boundary, relies on origin separation rather than unsupported per-instance data-directory changes, purges an origin on removal/replacement, disables mixed content/file access/debugging in release, and passes process-death recovery tests.

- [ ] 7.3 Connect native surfaces to session-ticket bootstrap and device revocation
      Requirements: R5.AC4, R5.AC6, R8.AC1-R8.AC2
      Done when: first open obtains a ticket, cookies remain scoped to the instance, sign-out clears only browser state, and device revoke removes both cookie and secure credential.

- [ ] 7.4 Implement system-browser external navigation and OS OAuth sessions with PKCE
      Requirements: R3.AC3-R3.AC4, R5.AC7
      Done when: ordinary external links require a user gesture and leave the app, Google/social OAuth never opens in the remote WebView, verified callbacks succeed, and intercepted/custom-scheme callbacks fail.

- [ ] 7.5 Implement safe-area, keyboard, iOS swipe, Android Back, rotation, and tablet behavior
      Requirements: R4.AC1, R9.AC2
      Done when: native UI tests cover editor focus through keyboard resize, Back/dismiss precedence, safe-area changes, rotation, split-screen/tablet layouts, and no accidental instance exit.

- [ ] 7.6 Apply validated theme chrome and persistent origin identity outside the WebView
      Requirements: R2.AC5, R6.AC3
      Done when: the shell visibly identifies the current host, applies contrast-tested palette values, and cannot be visually hidden or spoofed by remote CSS.

## 8. Hosted mobile entry

- [ ] 8.1 Add `/mobile` as an authenticated hosted entry that reuses the normal workspace and mobile profile
      Requirements: R2.AC1-R2.AC4, R4.AC1
      Done when: the route renders the same workspace, theme, runtime manifest, plugins, IndexedDB, sync, storage, and chat flows as mobile web while exposing mobile-session policy state.

- [ ] 8.2 Add mobile-store route policy that suppresses registration, plugin/theme installation, marketplaces, purchases, credit top-ups, and license-key unlocks
      Requirements: R7.AC7, R8.AC4
      Done when: direct and in-app navigations to suppressed features return an explanatory mobile policy screen and normal browser/admin access remains unchanged.

- [ ] 8.3 Add hosted mobile session lifecycle handling
      Requirements: R5.AC4-R5.AC6, R8.AC1, R9.AC4
      Done when: expired sessions show re-pair/sign-in recovery, workspace changes reconcile plugins before display, and background-job status restores after foregrounding where supported.

- [ ] 8.4 Add WebView compatibility tests to existing mobile theme/control suites
      Requirements: R2, R4.AC1, R9.AC5
      Done when: editable controls remain at least 16 CSS pixels, touch targets retain existing mobile minimums, and core/theme/plugin fixtures pass at iPhone and Android viewport/inset combinations.

## 9. Native inbox, camera, files, and share targets

- [ ] 9.1 Implement mobile inbox create/list/consume/delete APIs with quotas and TTLs
      Requirements: R4.AC2-R4.AC4, R5.AC6, R6.AC3, R9
      Done when: APIs enforce device/user/workspace scope, MIME/size/count limits, 24-hour expiry, idempotent consumption, and no automatic model submission.

- [ ] 9.2 Add a mobile-scoped attachment upload facade over existing storage presign/commit behavior
      Requirements: R4.AC2, R6.AC2-R6.AC3
      Done when: native uploads produce the same validated storage metadata as web attachments and interrupted/cancelled uploads leave no committed orphan.

- [ ] 9.3 Implement first-party native camera and document-picker chrome on iOS and Android
      Requirements: R4.AC2-R4.AC3, R6.AC1-R6.AC2, R6.AC5
      Done when: permissions are requested only after user action, denials have fallbacks, selected files upload to inbox, temporary files are cleaned, and no remote JavaScript invokes the picker.

- [ ] 9.4 Add the hosted inbox consumer and draft/attachment adapter
      Requirements: R4.AC2-R4.AC4, R7.AC3
      Done when: pending native items appear in an explicit review UI, acceptance feeds existing attachment/plugin hooks, rejection deletes the item, and neither action auto-sends.

- [ ] 9.5 Implement the iOS Share Extension with paired-instance selection
      Requirements: R4.AC4, R6.AC3
      Done when: supported text, URL, image, PDF, and file shares create a draft/inbox item for one selected instance while protected content remains hidden until app unlock.

- [ ] 9.6 Implement Android ACTION_SEND/ACTION_SEND_MULTIPLE handling
      Requirements: R4.AC4, R6.AC3
      Done when: Android shares match iOS behavior, use scoped URI grants, release access after import, and reject unsupported/oversized data safely.

- [ ] 9.7 Implement OR3 Universal Links/App Links for pairing and allowlisted workspace routes
      Requirements: R4.AC5, R5.AC2
      Done when: verified links select an already paired matching instance or begin safe enrollment, never carry reusable credentials, and unknown routes fail in the local shell.

## 10. Extension transparency and policy gate

- [ ] 10.1 Extend V2 and legacy extension metadata with additive publisher, privacy, content-descriptor, and mobile-compatibility fields
      Requirements: R7.AC1-R7.AC2, R7.AC8
      Done when: schemas/docs/examples validate metadata without breaking existing packages and legacy plugins receive clearly unverified conservative projections.

- [ ] 10.2 Implement the authenticated `/api/mobile/software-index` projection
      Requirements: R2.AC3, R7.AC1-R7.AC2
      Done when: entries exactly match the workspace runtime manifest and include V1 host build identities, V2 digests, trust labels, status, metadata, and stable revision.

- [ ] 10.3 Implement instance-hosted `/mobile/extensions/:id` information pages and links
      Requirements: R2.AC3, R7.AC1
      Done when: every index entry has an HTTPS information page suitable for a universal link, with identity, source, trust, content, privacy, enablement, and owner-disable guidance.

- [ ] 10.4 Build the native/mobile Extensions screen
      Requirements: R2.AC3-R2.AC4, R7.AC1-R7.AC3
      Done when: users can inspect all active/blocked/failed entries and open their information pages without installing, purchasing, or granting native permissions.

- [ ] 10.5 Define, sign, fetch, verify, and locally apply the exact-origin/artifact policy bundle
      Requirements: R3.AC5, R7.AC6, R11.AC6
      Done when: invalid/expired signatures fail closed according to the grace policy, comparisons occur locally, no inventory is uploaded, and exact test denials block only the intended origin/digest.

- [ ] 10.6 Add owner-facing disable guidance and runtime reconciliation for a denied plugin
      Requirements: R2.AC4, R7.AC6
      Done when: disabling the affected plugin changes the server/runtime/index revision and allows the otherwise safe instance to reopen without removing unrelated plugins.

## 11. AI and content-safety surface

- [ ] 11.1 Add a non-removable built-in Report action to completed assistant messages and generated images
      Requirements: R7.AC4-R7.AC5
      Done when: mobile store mode always shows the action independent of theme/plugin contributions and captures a validated reason plus optional note/excerpt preview.

- [ ] 11.2 Implement self-hosted report persistence, owner review, resolution, and retention
      Requirements: R7.AC4, R7.AC6
      Done when: reports are workspace-scoped, optional excerpts are protected, owners can resolve reports and disable a model/plugin, and users can see delivery state.

- [ ] 11.3 Implement publisher safety signals plus separately consented excerpt submission
      Requirements: R6.AC3, R7.AC4, R7.AC6
      Done when: report confirmation discloses and sends a content-free reason/runtime-identity signal, optional excerpt/note transfer has a separate preview and consent, successful submission returns a receipt, and excerpt retries stop after consent withdrawal.

- [ ] 11.4 Enforce moderated-model eligibility for mobile store sessions in catalog and stream endpoint
      Requirements: R7.AC5
      Done when: unmoderated/unknown models are hidden and rejected server-side for mobile store sessions with a stable explanation while browser/PWA sessions retain current behavior.

- [ ] 11.5 Add policy tests for prohibited AI-content reporting, model metadata drift, and report abuse limits
      Requirements: R7.AC4-R7.AC6, R11.AC6
      Done when: automated tests prove report availability, rate limits, excerpt opt-in, model fail-closed behavior, and plugin/theme inability to remove the control.

## 12. Privacy, lifecycle, and store-facing UX

- [ ] 12.1 Build the local Privacy and Permissions center
      Requirements: R6.AC1-R6.AC6, R8.AC1-R8.AC2
      Done when: users can inspect publisher/instance policies, data flows, OS permissions, paired devices, push state, sign out, revoke, remove, and withdraw consent without opening admin pages.

- [ ] 12.2 Add app-level privacy policy, instance policy, terms, support, and safety-report URLs to discovery and store metadata
      Requirements: R6.AC4, R7.AC4, R11.AC4-R11.AC5
      Done when: every URL is HTTPS, public where required, non-geofenced for store policy pages, reachable in app/review, and covered by link-health tests.

- [ ] 12.3 Enforce existing-account-only behavior and document future account-deletion capability
      Requirements: R8.AC3-R8.AC4
      Done when: mobile cannot create an account, store copy says it connects to an existing self-hosted account, and discovery rejects any future registration-enabled instance that lacks in-app and external deletion paths.

- [ ] 12.4 Add iOS purpose strings, PrivacyInfo.xcprivacy, associated domains, and SDK privacy-manifest audit
      Requirements: R6, R11.AC3-R11.AC4
      Done when: Xcode privacy reports match actual camera/file/biometric/network use, required-reason entries validate, and unused permission descriptions are absent.

- [ ] 12.5 Add Android permissions, Network Security Configuration, App Links, Data Safety inventory, and API 36 target
      Requirements: R3, R6, R11.AC2, R11.AC4
      Done when: release builds deny cleartext/mixed content, request no broad storage permission, verified links pass, target API is compliant, and Data Safety answers match runtime behavior.

- [ ] 12.6 Complete and record Apple/Google age, content, AI, account, privacy, and business-model questionnaires
      Requirements: R7.AC7-R7.AC8, R8.AC4, R11.AC4
      Done when: dated answers, screenshots, policy URLs, 18+ rationale, no-commerce statement, and reviewer notes are checked into a release-compliance artifact without credentials.

## 13. Reliability, security, and qualification

- [ ] 13.1 Add native security regression tests for bridge absence, origin locks, external navigation, TLS, local-file access, cookies, screenshots, and logs
      Requirements: R3, R5, R6, R11.AC6
      Done when: iOS and Android release configurations fail CI on wildcard origins, bridge exposure, cleartext, mixed content, credential persistence, or secret-bearing logs.

- [ ] 13.2 Add cross-provider server integration tests for pairing, ticket, inbox, report, workspace switch, and revoke
      Requirements: R1, R4, R5, R7, R8, R9
      Done when: SQLite and Convex suites prove the same tenant, replay, cleanup, and error behavior through real API handlers.

- [ ] 13.3 Build public review-instance fixtures and reset automation
      Requirements: R2, R7, R11.AC5
      Done when: reviewers receive a stable Basic Auth account, QR, non-default theme, V1 UI plugin, V2 logic package, moderated model, sample report, and deterministic reset without exposing production data.

- [ ] 13.4 Add end-to-end iOS and Android journeys for the full store MVP
      Requirements: R1-R9, R11
      Done when: automated journeys cover enroll, pair, open, theme/plugin verification, stream, attach, share, report, biometric reopen, external link, switch, sign out, revoke, remove, renderer crash, and network failure.

- [ ] 13.5 Add cold/warm open performance qualification and memory-pressure runs
      Requirements: R9.AC2, R9.AC5
      Done when: 19 of 20 runs meet the defined 2-second warm and 5-second cold budgets on named reference devices and renderer recovery does not lose instance state.

- [ ] 13.6 Run a targeted mobile threat model and independent security review
      Requirements: R3, R5, R6, R7, R11.AC6
      Done when: SSRF/origin confusion, QR phishing, token theft/replay, plugin-to-native escalation, cookie leakage, report exfiltration, deep-link hijacking, and WebView compromise findings are resolved or accepted explicitly.

## 14. Build, release, and review operations

- [ ] 14.1 Add root mobile scripts for install, contract tests, shell build, native sync, native tests, and artifact checks
      Requirements: R11.AC1-R11.AC3
      Done when: documented Bun commands reproduce local and CI builds without editing generated files by hand.

- [ ] 14.2 Add CI jobs for shared/server tests, iOS build/tests, Android build/tests, policy checks, and artifact retention
      Requirements: R11.AC1-R11.AC4
      Done when: pull requests receive bounded platform checks and protected release workflows produce signed-review artifacts only from tagged commits.

- [ ] 14.3 Add mobile release runbook and live-policy verification checklist
      Requirements: R7.AC8, R11.AC2-R11.AC6
      Done when: the runbook covers Capacitor/plugin upgrades, SDK/API deadlines, privacy manifests, Data Safety/privacy labels, export compliance, age/IARC, reviewer access, screenshots, rollout, rollback, and policy-source dates.

- [ ] 14.4 Submit the store MVP to TestFlight external review and Play closed testing with the full review pack
      Requirements: R11.AC4-R11.AC5
      Done when: both platforms can execute the documented review journey against the stable instance and every reviewer question/rejection is linked to a tracked corrective task.

- [ ] 14.5 Complete production submission and staged rollout readiness review
      Requirements: R9, R11
      Done when: all Definition of Done checks pass, store metadata is approved, support/safety operations are staffed, server compatibility docs are published, and staged rollout stop conditions are documented.

## 15. Optional opaque push follow-up

- [ ] 15.1 Write and threat-model the opaque Push Router protocol and retention policy
      Requirements: R10.AC1-R10.AC5
      Done when: the protocol proves APNs/FCM/router payloads contain no hostname or user content, defines deletion/revocation, and passes privacy review before implementation.

- [ ] 15.2 Implement iOS/Android token registration and local route mapping
      Requirements: R10.AC1, R10.AC3-R10.AC5
      Done when: opt-in binds an opaque route to one local instance, notification opening resolves after unlock, and disable/remove deletes the binding.

- [ ] 15.3 Implement self-hosted push binding and event resolution endpoints
      Requirements: R10.AC1-R10.AC5
      Done when: the server can issue content-free events, resolve event content only to the authenticated device, expire events, and operate normally without push.

- [ ] 15.4 Implement the publisher-operated APNs/FCM router with zero-content logs
      Requirements: R10.AC1-R10.AC2, R10.AC5
      Done when: router storage/log tests prove opaque fields only, deletions propagate, abuse limits work, and operators cannot reconstruct hostnames or messages from records.

- [ ] 15.5 Add push E2E, denial, outage, privacy, and store-metadata tests
      Requirements: R10, R11.AC4
      Done when: both platforms pass opt-in, delivery, unlock, fetch, revoke, denied permission, relay outage, and inspected-payload cases without degrading core use.

## Traceability Matrix

| Requirement | Design component(s) | Task numbers |
|---|---|---|
| R1: Self-hosted instance enrollment | Local Capacitor Shell, Instance Registry, Mobile Discovery API, Pairing Service | 2.1-2.3, 3.1-3.4, 5.1-5.3, 6.2, 6.4, 7.1-7.3, 13.2, 13.4 |
| R2: Exact hosted experience compatibility | Remote OR3 Surface, Mobile Software Index, Native Chrome | 1.2, 3.3, 7.1-7.2, 7.6, 8.1, 8.4, 10.2-10.4, 13.3-13.4 |
| R3: Remote-surface isolation | Local Capacitor Shell, Remote OR3 Surface, Local Policy Gate | 1.1, 1.3-1.5, 2.3, 6.1, 7.1-7.4, 10.5, 12.5, 13.1, 13.6 |
| R4: Native mobile value | Native Chrome, Mobile Inbox API, Credential Vault | 1.3, 6.3-6.5, 7.5, 9.1-9.7, 13.4 |
| R5: Pairing and session security | Pairing and Session Service, Credential Vault, Remote OR3 Surface | 2.4, 4.1-4.5, 5.1-5.6, 6.3, 7.3-7.4, 13.1-13.2, 13.6 |
| R6: Privacy and permission control | Native Chrome, Credential Vault, Store Compliance Pack | 2.4, 6.3, 6.5, 7.6, 9.1-9.6, 11.3, 12.1-12.5, 13.1, 13.6 |
| R7: Store-safe extension/content governance | Mobile Software Index, Local Policy Gate, AI Safety Surface, Store Compliance Pack | 1.4-1.5, 2.1-2.2, 8.2, 10.1-10.6, 11.1-11.5, 12.2, 12.6, 13.3-13.4, 14.3 |
| R8: Account and instance lifecycle | Instance Registry, Pairing Service, Store Compliance Pack | 5.5, 6.2-6.3, 7.3, 8.2-8.3, 12.1, 12.3, 13.2, 13.4 |
| R9: Reliability and recovery | Local Capacitor Shell, Remote OR3 Surface, Mobile Inbox API | 3.4, 5.6, 6.4, 6.6, 7.1-7.5, 8.3-8.4, 9.1, 13.2, 13.4-13.5, 14.5 |
| R10: Optional push notifications | Optional Push Router | 15.1-15.5 |
| R11: Platform packaging/store operations | Store Compliance Pack, Local Capacitor Shell | 1.4-1.5, 3.1, 6.1, 10.5, 11.5, 12.2, 12.4-12.6, 13.1, 13.3-13.6, 14.1-14.5, 15.5 |

## Definition of Done

- Every acceptance criterion in `requirements.md` is implemented or explicitly deferred only where the requirement itself says post-MVP.
- The traceability matrix has no missing requirement or unowned component.
- The policy/transport spike is accepted before production implementation proceeds.
- `bun run type-check`, the existing relevant OR3 suites, shared mobile contract tests, SQLite/Convex store contract tests, and mobile web integration tests pass.
- iOS XCTest and Android unit/instrumentation suites pass against release configurations.
- Automated iOS/Android E2E journeys pass against the stable public review instance.
- Security tests prove the remote WebView has no Capacitor bridge, origin policy fails closed, device secrets stay in Keychain/Keystore, and logs contain no mobile secrets or report excerpts.
- The exact active host theme and enabled V1/V2 plugin fixtures render without a mobile binary rebuild.
- AI report and moderated-model enforcement satisfy the recorded Google Play policy tests.
- Apple privacy manifest, privacy labels, purpose strings, age rating, export answers, review notes, and Google Data Safety, IARC, target API, permission, AI, and account answers are current and dated.
- A reviewer can complete the supplied QR/account journey without private developer assistance.
- The final implementation diff is inspected, first-party package release order is followed, and no unrelated worktree changes are included.

# Requirements

## Introduction

OR3 Mobile Runtime will be one iOS and Android application that connects to a user-selected, self-hosted OR3 Chat instance while rendering that instance's exact active theme and client plugins. The application will use Capacitor for a small first-party native shell and a separately controlled remote OR3 surface, preserving self-hosted customization without granting downloaded plugin code unrestricted access to native APIs. The first store release targets adults, existing OR3 accounts, and public HTTPS instances.

## Context

OR3 Chat is a Nuxt 4/Vue 3/TypeScript application using Bun, Vitest, Playwright, Dexie local storage, a PWA shell, cookie-based SSR authentication, gateway sync/storage providers, and a server-authoritative workspace plugin runtime. V1 client plugins are included in the host's Vite build and require rebuild/restart after installation; package V2 can serve digest-addressed JavaScript after build, while trusted-host Vue UI remains gated. The repository already has QR/device-code lifecycle patterns under `server/connect`, authenticated runtime manifests, configurable sync/storage gateway base URLs, and mobile-responsive web UI, but it has no Capacitor project, mobile device session, mobile instance manifest, account-deletion surface, or AI-output reporting action. As of July 31, 2026, Apple permits HTML5/JavaScript plug-ins subject to App Review Guideline 4.7, prohibits exposing native platform APIs to that software without prior permission, requires app-like functionality beyond a repackaged website, and treats unrestricted web access as a 16+ age-rating capability. Google Play permits interpreted JavaScript in a WebView but holds the publisher responsible for runtime code and displayed content, requires meaningful mobile functionality, requires in-app reporting for generative-AI output, and will require new apps and updates to target Android API 36 starting August 31, 2026. Capacitor 8 documents production use of remote `server.url` and `allowNavigation` as unsupported, so the design uses a local shell plus purpose-built native remote-surface controllers instead.

## Assumptions

- The public app will be named **OR3 Mobile**; the internal architecture is named **OR3 Mobile Runtime**.
- The first release is free, contains no plugin/theme marketplace, purchase links, subscriptions, or digital-goods checkout, and only connects to accounts and extensions already configured on a self-hosted instance.
- The first release is submitted with an 18+ minimum audience even though unrestricted web access alone maps to Apple's 16+ capability; the conservative override accounts for arbitrary AI models and administrator-installed extensions.
- The first release does not target Apple's Kids Category or Google Play Families.
- Production pairing requires a publicly reachable origin with a valid system-trusted HTTPS certificate. Local HTTP and self-signed certificates are development-build features only.
- Every enabled web theme and plugin that works in OR3's existing mobile browser layout should load in the mobile surface without rebuilding the store app. A plugin that depends on a desktop-only browser API is allowed to report itself unavailable but is not omitted merely because it was installed after the mobile binary shipped.
- Native capabilities are first-party shell operations. Hosted OR3 pages and plugins are never given the generic Capacitor bridge or a callable camera, microphone, filesystem, notification, biometric, or credential API.
- Standard browser APIs implemented by WKWebView/Android WebView, including editable fields, file inputs, and Web Share where supported, remain available to hosted code.
- The server operator is responsible for the legality of the instance's content, but the store publisher retains a technical denial mechanism for exact known-malicious instance origins and plugin package digests because Apple and Google hold the publisher responsible for content and runtime software.
- The MVP supports existing-account pairing and sign-in, not in-app account registration. If registration is enabled in a future mobile surface, in-app and external account-deletion paths become release blockers.
- Basic Auth is the qualification auth provider. OAuth or social-login providers must use system authentication sessions with PKCE and may not authenticate inside the embedded OR3 WebView.
- Push notification delivery is a post-MVP store-quality milestone because a universal app requires publisher-controlled APNs/FCM credentials and an operational relay. The app remains fully usable when push is disabled or denied.
- Policy citations are implementation inputs, not legal advice; they must be rechecked against the live official policies immediately before each store submission.

## Out of Scope

- Rewriting the OR3 workspace in SwiftUI, Jetpack Compose, React Native, or Expo.
- Giving arbitrary hosted JavaScript direct native API access.
- Installing, purchasing, updating, or reviewing plugins/themes from inside the mobile app.
- Guaranteeing compatibility for plugins that require unavailable desktop-only browser behavior.
- Supporting arbitrary websites that are not compatible OR3 instances.
- Bypassing TLS validation, Apple App Transport Security, Android Network Security Configuration, store billing rules, device permission prompts, or OS parental controls.
- Shipping central analytics, advertising, cross-instance identity, or OR3-operated prompt/message storage.
- Cold-start offline execution of a downloaded experience capsule in the first release.
- Legal certification that any specific third-party extension, model, or self-hosted deployment is compliant in every jurisdiction.

## Requirements

### R1: Self-hosted instance enrollment

**User Story:** As an OR3 user, I want to scan a QR code or enter my instance address, so that I can open my own OR3 configuration in the mobile app.

**Acceptance Criteria:**
- R1.AC1: WHEN a user scans a valid OR3 pairing QR code THEN the app SHALL display the normalized HTTPS hostname and instance display name before pairing.
- R1.AC2: WHEN a user enters an address manually THEN the app SHALL normalize it to an origin, reject credentials, fragments, non-HTTPS production URLs, IP-literal production URLs, and paths outside the discovery contract, and fetch `/.well-known/or3-mobile.json`.
- R1.AC3: IF discovery does not return a supported schema, compatible runtime range, stable instance identifier, and required policy URLs THEN the app SHALL refuse pairing with a specific, recoverable error.
- R1.AC4: WHEN multiple instances are paired THEN the app SHALL isolate their cookies, local web data, device credentials, display metadata, and permission decisions and SHALL let the user switch instances from native chrome.
- R1.AC5: WHEN a paired instance is removed THEN the app SHALL revoke its mobile device credential when reachable and SHALL delete its local cookies, web data, cached metadata, permission decisions, and secure-store entry.

### R2: Exact hosted experience compatibility

**User Story:** As a self-hoster, I want mobile to render the same OR3 build as my browser, so that my themes, enabled plugins, workspace profile, and custom UI appear without a store-app rebuild.

**Acceptance Criteria:**
- R2.AC1: WHEN a paired instance opens THEN the remote surface SHALL load the instance's declared mobile entry URL as a top-level, first-party HTTPS page.
- R2.AC2: WHEN an enabled theme or client plugin changes on the server and the server revision becomes active THEN the next remote-surface navigation or reload SHALL use that active server build without requiring a mobile binary update.
- R2.AC3: WHEN the instance runtime manifest lists enabled plugins THEN the mobile Extensions screen SHALL list the same enabled plugin IDs, versions, trust labels, active digests/build identities, publisher metadata when available, content-rating metadata, and instance-hosted universal information links.
- R2.AC4: IF a plugin reports a mobile incompatibility or fails during activation THEN the remote OR3 surface SHALL preserve the rest of the workspace and SHALL expose the plugin's existing blocked/failure status instead of failing the whole app.
- R2.AC5: WHEN the server returns a theme chrome palette THEN the native shell SHALL apply only schema-validated colors and contrast-safe fallbacks; arbitrary theme CSS SHALL remain confined to the remote surface.

### R3: Remote-surface isolation

**User Story:** As a mobile user, I want my instance and its plugins isolated from device-level APIs, so that installing a web plugin does not silently grant it camera, filesystem, credential, or notification access.

**Acceptance Criteria:**
- R3.AC1: WHILE production code is running, the Capacitor root WebView SHALL load only the locally bundled shell and SHALL NOT configure Capacitor `server.url`, wildcard navigation, or production `allowNavigation`.
- R3.AC2: WHEN an instance is opened THEN a purpose-built native WKWebView or Android WebView controller SHALL load only the exact paired origin and SHALL not inject or expose the Capacitor plugin bridge.
- R3.AC3: WHEN remote content attempts a top-level navigation outside the paired origin THEN the remote surface SHALL cancel it and SHALL open eligible HTTP(S) links in the system browser after a user gesture.
- R3.AC4: IF remote content requests a custom URL scheme, local file URL, loopback URL, cleartext URL, mixed-content resource, camera/microphone capture API outside web-standard permission handling, or a native message handler not on the fixed allowlist THEN the remote surface SHALL deny it.
- R3.AC5: WHEN the app receives a signed policy denial list THEN it SHALL compare origins and plugin package digests locally and SHALL prevent opening an exact denied item without uploading the user's installed-plugin inventory.

### R4: Native mobile value

**User Story:** As a phone user, I want OR3 to behave like a mobile app, so that it offers meaningful capability beyond a repackaged website.

**Acceptance Criteria:**
- R4.AC1: WHEN editing text in the OR3 surface THEN the app SHALL use the platform keyboard, respect safe-area and keyboard insets, preserve the focused editor during resize, and provide platform Back/dismiss behavior.
- R4.AC2: WHEN the user selects Take Photo or Choose File from first-party native chrome THEN the shell SHALL use the platform picker/camera, request permission in context, upload the user-selected item to a short-lived mobile inbox on the paired instance, and hand a normal OR3 attachment reference to the web app.
- R4.AC3: IF camera or photo-library permission is denied THEN the app SHALL remain usable and SHALL offer the web file picker or document picker where available.
- R4.AC4: WHEN content is shared into OR3 from another app THEN the share extension/intent SHALL let the user choose a paired instance and SHALL create a draft or pending attachment without sending it to a model automatically.
- R4.AC5: WHEN a user follows an OR3 universal/app link THEN the shell SHALL select the matching paired instance and navigate to an allowlisted OR3 route without placing credentials in the URL.
- R4.AC6: WHEN biometric lock is enabled THEN the shell SHALL require successful platform authentication before revealing paired-instance metadata or opening a remote surface and SHALL offer the device passcode fallback supported by the OS.

### R5: Pairing and session security

**User Story:** As a user already signed into OR3, I want to approve my phone securely, so that QR enrollment does not expose reusable credentials.

**Acceptance Criteria:**
- R5.AC1: WHEN the desktop web app creates a mobile pairing request THEN the server SHALL issue a single-use, purpose-bound secret with a maximum lifetime of 10 minutes and SHALL store only its keyed hash.
- R5.AC2: WHEN the mobile app redeems a valid pairing request THEN it SHALL register an app-generated device public key and SHALL receive a scoped mobile refresh credential stored only in Keychain/Keystore-backed secure storage.
- R5.AC3: IF a pairing request is expired, already redeemed, denied, origin-mismatched, or rate-limited THEN the server SHALL not issue a credential and SHALL return a non-secret-bearing error code.
- R5.AC4: WHEN the remote WebView needs an authenticated browser session THEN the native shell SHALL exchange its device credential for a one-time browser session ticket with a maximum lifetime of 60 seconds; consuming the ticket SHALL set a Secure, HttpOnly, SameSite cookie and invalidate the ticket.
- R5.AC5: WHEN a mobile credential is refreshed THEN the server SHALL rotate the refresh secret and SHALL reject replay of the previous secret after a bounded 60-second retry window.
- R5.AC6: WHEN a user or administrator revokes a mobile device THEN subsequent device-token, inbox, notification-registration, and session-ticket requests SHALL return 401 and any active browser session SHALL expire within 15 minutes.
- R5.AC7: IF a configured auth flow uses OAuth or social login THEN mobile SHALL launch an OS authentication session with PKCE and a verified universal/app-link callback and SHALL NOT direct the OAuth request through WKWebView or Android WebView.

### R6: Privacy and permission control

**User Story:** As a privacy-conscious self-hoster, I want to understand and control what leaves my phone, so that native convenience does not weaken OR3's privacy model.

**Acceptance Criteria:**
- R6.AC1: WHEN camera, photo, microphone, notification, or biometric access is about to be requested for the first time THEN the shell SHALL display an in-context purpose explanation and SHALL wait for affirmative user action.
- R6.AC2: WHEN a protected resource can be selected with an OS picker or share sheet THEN the app SHALL use that scoped mechanism instead of requesting broad library or filesystem permission.
- R6.AC3: WHEN content will be transmitted THEN the app SHALL identify the selected self-hosted hostname and SHALL not send content to any OR3-operated service except an explicitly confirmed safety report or opaque push-routing operation.
- R6.AC4: WHEN the user opens Privacy THEN the app SHALL show the app-publisher privacy policy, the selected instance privacy policy, active permission states, device-revocation action, and a data-flow explanation covering the instance, enabled plugins, model providers, and optional relay services.
- R6.AC5: WHEN the user withdraws a permission THEN the shell SHALL stop using the capability, provide an OS-settings route where required, and SHALL preserve unrelated app functionality.
- R6.AC6: WHILE no telemetry setting exists THEN the mobile shell SHALL not add analytics, advertising identifiers, fingerprinting, or background host/plugin inventory uploads.

### R7: Store-safe extension and content governance

**User Story:** As the app publisher, I want hosted plugins and AI content represented and governed transparently, so that dynamic self-hosted experiences remain distributable through Apple and Google stores.

**Acceptance Criteria:**
- R7.AC1: WHEN an instance declares enabled plugins THEN the server SHALL expose an authenticated software index containing immutable identity, name, version, source, publisher when known, trust label, content descriptors, privacy URL when applicable, and universal information link for every entry.
- R7.AC2: IF a legacy plugin lacks optional policy metadata THEN the server SHALL generate conservative metadata from its installed manifest and artifact identity, label the publisher and content rating as unverified, and SHALL NOT silently describe it as reviewed by OR3.
- R7.AC3: WHILE hosted plugins execute in the remote surface THEN they SHALL not receive a native API object, native permission, device token, secure-store value, push token, or platform credential.
- R7.AC4: WHEN a user confirms an AI-generated-content report THEN the app SHALL store the report on the self-hosted instance, SHALL send a disclosed content-free signal containing the reason and immutable runtime identities to the app publisher's safety intake, and SHALL require separate explicit consent before sending any excerpt or note.
- R7.AC5: WHEN AI chat or image generation is available in a store build THEN the mobile policy SHALL enable only models/providers that declare upstream moderation support and SHALL provide an always-visible report action on completed AI output.
- R7.AC6: WHEN a report or signed policy denial is received THEN an instance owner SHALL be able to disable the plugin/model locally, and the publisher SHALL be able to deny an exact origin or artifact digest in a later signed policy list without receiving every user's inventory.
- R7.AC7: WHILE the mobile surface is active THEN plugin/theme installation, marketplaces, external purchase calls to action, license-key entry for feature unlocks, and account registration SHALL be unavailable.
- R7.AC8: WHEN preparing a store submission THEN the publisher SHALL complete current Apple age-rating and Google IARC questionnaires honestly for unrestricted web access, messaging/chat, AI-generated content, and user-installed software and SHALL repeat them when those capabilities materially change.

### R8: Account and instance lifecycle

**User Story:** As a mobile user, I want clear sign-out, unlink, and deletion paths, so that I retain control of my account and device association.

**Acceptance Criteria:**
- R8.AC1: WHEN the user signs out of an instance THEN the app SHALL clear that instance's browser session while retaining the paired device only after explaining the distinction.
- R8.AC2: WHEN the user removes an instance THEN the app SHALL execute R1.AC5 and SHALL return to the local instance picker without affecting other paired instances.
- R8.AC3: IF any mobile-compatible instance permits account creation inside the mobile surface THEN it SHALL also provide a readily discoverable in-app account-deletion request and a publicly reachable external deletion URL that deletes associated data rather than only disabling the account.
- R8.AC4: WHILE the MVP suppresses account creation THEN App Store/Play metadata and review notes SHALL state that OR3 Mobile connects to an existing account on a user-selected self-hosted service.

### R9: Reliability and recovery

**User Story:** As a mobile user, I want clear recovery when my private server is unavailable or changes, so that failures do not appear as a broken blank app.

**Acceptance Criteria:**
- R9.AC1: IF discovery, TLS, DNS, session bootstrap, or page load fails THEN the native shell SHALL show the failing hostname, categorized cause, retry action, remove-instance action, and a route to diagnostics without rendering a blank WebView.
- R9.AC2: WHEN the remote WebView renderer crashes or is terminated by the OS THEN the shell SHALL preserve the paired-instance record and SHALL offer one reload before suggesting diagnostics.
- R9.AC3: IF the server requires a newer mobile runtime THEN the app SHALL show the required version and store-update action and SHALL not attempt to execute the incompatible surface.
- R9.AC4: WHEN the app is backgrounded during a streaming response THEN foregrounding SHALL reconnect through OR3's existing background-job/status path where available or SHALL show that the foreground stream was interrupted.
- R9.AC5: WHEN qualification runs on the defined reference iPhone and Android devices over the qualification network THEN a warm instance switch SHALL show OR3 content within 2 seconds and a cold authenticated open SHALL show OR3 content within 5 seconds in at least 19 of 20 runs.

### R10: Optional push notifications

**User Story:** As a user running long jobs on my own server, I want optional notifications, so that I can return when work finishes without exposing prompt content to a relay.

**Acceptance Criteria:**
- R10.AC1: WHEN the user opts into push for an instance THEN the app SHALL register a platform push token through a publisher-operated routing service and SHALL bind an opaque routing identifier to the self-hosted device record.
- R10.AC2: WHEN an instance sends a notification THEN the payload visible to APNs, FCM, and the routing service SHALL contain no prompt, response, filename, workspace name, user email, server hostname, or plugin-provided text.
- R10.AC3: WHEN the user opens a notification THEN the app SHALL resolve its opaque event against the paired instance after local unlock and SHALL fetch display content directly from that instance.
- R10.AC4: IF push permission is denied, the relay is unavailable, or push is disabled by the instance THEN chat, sync, files, and background-job status SHALL remain functional when the user opens the app.
- R10.AC5: WHEN push is disabled for an instance or the instance is removed THEN the server and routing service SHALL delete the corresponding routing binding.

### R11: Platform packaging and store operations

**User Story:** As a maintainer, I want repeatable mobile builds and review evidence, so that releases remain compliant as store rules and SDK requirements change.

**Acceptance Criteria:**
- R11.AC1: WHEN CI builds the mobile app THEN it SHALL pin compatible Capacitor/native-plugin versions, build signed iOS and Android artifacts from reviewed native projects, and run unit, native integration, and remote-surface E2E tests.
- R11.AC2: WHEN building Android for a release on or after August 31, 2026 THEN it SHALL target API level 36 or the newer level then required by Google Play.
- R11.AC3: WHEN building iOS THEN the target SHALL include valid purpose strings, a valid `PrivacyInfo.xcprivacy`, required-reason declarations for bundled SDKs, associated-domain configuration, and the current App Store-required SDK/toolchain.
- R11.AC4: WHEN preparing an external beta or store submission THEN maintainers SHALL verify privacy labels/Data Safety answers, content/age ratings, export-compliance answers, account behavior, permission prompts, extension index, AI report flow, and current official policy text using a dated checklist.
- R11.AC5: WHEN submitting for review THEN maintainers SHALL provide a stable demo instance, active reviewer account, sample pairing QR code, enabled sample theme/plugins, full feature instructions, non-obvious business-model explanation, and contact information.
- R11.AC6: WHEN a new remote-surface or native capability is introduced THEN threat-model and store-policy tests SHALL fail closed until the origin, permission, data-flow, age-rating, and review-note impacts are recorded.

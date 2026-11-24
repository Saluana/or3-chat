# Tasks

## 1. Offline launch

- [x] 1.1 Reproduce the broken cold launch and verify the service-worker fix in a production build (R1). Complete when the installed app opens offline and a partial update preserves the working version.
- [x] 1.2 Exercise first-use assets and optional plugin failure (R1). Complete when the editor, search, local file support and bundled themes open offline and installation cost is measured.

## 2. Remember permitted access

- [x] 2.1 Wire the site configuration through the existing Cloud auth configuration and document it (R4). Complete when both values reach the device through a verified online response.
- [x] 2.2 Add account-scoped local workspace selection and invalidation (R2, R4). Complete when offline reopening honors policy, role, sign-out, account changes, and a server denial.
- [x] 2.3 Integrate the workspace bootstrap, route gate and local write capture (R2, R3). Complete when startup cannot write to a guest or previous workspace by mistake.

## 3. Reconnect and qualify

- [x] 3.1 Exercise reconnect, reauthentication, and identity changes with the existing sync queues (R2, R3). Complete when interrupted uploads and edits survive a restart and land once in the correct workspace.
- [x] 3.2 Run the installed-PWA workflow matrix (R1–R4). Complete when local data and edits survive offline cold launches, the second client receives changes, both policies pass, and the Android airplane-mode restart result is recorded.

## Traceability Matrix

| Requirement | Component | Tasks |
| --- | --- | --- |
| R1 | Service worker | 1.1, 1.2, 3.2 |
| R2 | Local workspace selection | 2.2, 2.3, 3.1, 3.2 |
| R3 | Workspace storage and sync | 2.3, 3.1, 3.2 |
| R4 | Site configuration | 2.1, 2.2, 3.2 |

## Definition of Done

Acceptance criteria pass through the ordinary app UI. The production PWA and authenticated recovery suites pass, and each requirement has recorded verification. Report physical-device and emulated results separately.

## Verification

- The installed Android 15 emulator app opened from the home screen in airplane mode and restored the edited document after the device rebooted. The local tunnel was disconnected. Physical-device verification is pending.
- The production Chromium suite passed with Cloud access enabled, with the site setting disabled, and against the generated local-only build. It covered a blank HTTP cache, drafts, document editing and search, creating a project, and uploading and reopening a local file. A separate browser received the synced document. A saved chat also reopened and appeared in search after an offline cold launch.
- A failed required asset download rejected the new service worker and left the prior installation able to open offline. Blocking the optional host Vue facade left the workspace usable.
- A returning viewer stayed read-only. Switching to another editor in the same workspace kept the original account’s pending edits separate. Simulated session expiry returned the app to its sign-in gate and preserved the edits through reauthentication and sync.
- All three Cloud recovery journeys passed. They covered a pending upload at restart, idempotent replay after a dropped acknowledgement, and recovery from failed changes. The core suite passed 7,471 tests, and type checking passed.
- The production precache has 519 assets, about 17.4 MB before compression, and zero missing files. It passed the precache limits. The separate compressed CSS limit was already exceeded on the baseline.

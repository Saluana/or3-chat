# Requirements
## Introduction
Name new chats and message-created documents without blocking their primary operation.
## Context
Nuxt/Vue, Dexie, workspace sync, OpenRouter credential resolver, and provider-owned WorkspaceSettingsStore are existing owners. Chats use deriveThreadTitle; message actions convert Markdown and open documents.
## Assumptions
Managed model configuration is workspace administrator owned. Local source mode uses the existing AI settings KV. Static builds retain useful fallback/heading titles because generation requires a backend.
## Out of Scope
Project titles, regeneration, queues, new dependencies, and historical title changes.
## Requirements
### R1: Shared inference
**User Story:** As a user I want useful titles without waiting.
**Acceptance Criteria:**
- R1.AC1: WHEN naming is needed THEN one backend request SHALL use bounded non-streaming inference, the full configured model ID, existing credentials, and a deadline.
### R2: Lifecycle safety
**User Story:** As a user I want my edits preserved.
**Acceptance Criteria:**
- R2.AC1: WHEN generation races a rename, deletion, workspace change, duplicate send, or reload THEN it SHALL preserve user data and never restart on page load.
- R2.AC2: WHEN a branch is created THEN it SHALL retain its existing naming behavior without another automatic job.
### R3: Feature triggers
**User Story:** As a user I want instant chat and document access.
**Acceptance Criteria:**
- R3.AC1: WHEN a meaningful user turn is saved THEN chat naming SHALL run without awaiting inference in the send path.
- R3.AC2: WHEN Create Document runs THEN it SHALL open before inference completes, reuse suitable headings, preserve content and coalesce concurrent duplicate actions.
### R4: Configuration and verification
**User Story:** As an administrator I want to select the naming model.
**Acceptance Criteria:**
- R4.AC1: WHEN configuration changes THEN future jobs SHALL use it and existing titles SHALL remain unchanged; the default SHALL be deepseek/deepseek-v4.1-flash:nitro.
- R4.AC2: WHEN delivered THEN focused tests, type checks, build results, request/write costs and limitations SHALL be reported in an unmerged PR.

# Requirements

## Introduction
Replace the tool count in chat settings with a master switch. Preserve individual tool choices per chat and provide an AI dashboard default.

## Context
OR3 Chat uses Nuxt/Vue, Bun, Dexie workspace KV storage and Playwright. ChatSettingsPopover currently changes the global tool registry; useAi prepares and retries requests through that registry. AI dashboard preferences already use guarded KV writes.

## Assumptions
- A first enable selects all available tools. Later enables restore the chat's saved selection.
- The dashboard default applies until a chat saves its own preference. Sending a first message captures the preference for that chat.
- Existing chats without a preference start off; existing registry preferences remain available to non-chat consumers.

## Out of Scope
Package releases, provider changes, production deployment and Document AI settings.

## Requirements

### R1: Master switch
**User Story:** As a user, I want to suspend tools without losing my selection.
**Acceptance Criteria:**
- R1.AC1: WHEN chat settings open THEN the Tools row SHALL show an accessible switch instead of its tool count and SHALL retain category navigation.
- R1.AC2: WHEN the switch is off THEN chat requests SHALL advertise no tools and tool execution SHALL reject calls.
- R1.AC3: WHEN the switch returns on THEN the saved individual selection SHALL be restored.

### R2: Dashboard default
**User Story:** As a user, I want new chats to start with all tools on or off.
**Acceptance Criteria:**
- R2.AC1: IF no default is saved THEN tools SHALL start off.
- R2.AC2: WHEN the dashboard default changes THEN it SHALL persist in workspace AI settings and SHALL NOT override saved chat preferences.

### R3: Chat persistence
**User Story:** As a user, I want each chat to remember its tools.
**Acceptance Criteria:**
- R3.AC1: WHEN a chat is reopened or reloaded THEN its master switch and individual choices SHALL be restored independently of other chats.
- R3.AC2: WHEN a draft sends its first message THEN its tool preferences SHALL be captured on the created chat.
- R3.AC3: IF storage fails THEN the UI SHALL expose a recoverable error and retain the saved setting.
- R3.AC4: WHEN the workspace changes during a write THEN that write SHALL NOT be redirected to the new workspace.

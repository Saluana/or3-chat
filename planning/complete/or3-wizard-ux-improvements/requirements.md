# OR3 Wizard UX Improvements — Requirements

## Introduction

The OR3 Cloud install wizard currently creates unnecessary friction:

- Selecting a starting template still asks users to manually pick providers.
- Choosing `limitsEnabled = false` still walks users through limits detail questions.
- Step counting and navigation can feel inconsistent when questions are effectively irrelevant.

This effort improves the wizard flow to be predictable, shorter, and context-aware while preserving current configurability and safety checks.

---

## Requirements

### 1. Template mode must control setup depth

**User Story**  
As an operator, I want template selection to meaningfully change the setup path, so that preset choices reduce manual work.

**Acceptance Criteria**

1.1 WHEN the user selects template option `1` (Default local stack), THEN the wizard SHALL auto-apply Basic Auth + SQLite + Filesystem provider defaults and SHALL skip manual provider selection prompts.

1.2 WHEN the user selects template option `2` (Clerk + Convex stack), THEN the wizard SHALL auto-apply Clerk + Convex + Convex provider defaults and SHALL skip manual provider selection prompts.

1.3 WHEN the user selects template option `3` (Custom), THEN the wizard SHALL require manual provider selection prompts.

1.4 IF a preset flow is selected, THEN the wizard SHALL still ask provider-specific detail questions only when required configuration for the selected providers is missing or invalid.

---

### 2. Conditional question visibility

**User Story**  
As an operator, I want the wizard to ask only relevant questions, so that I do not answer fields that are disabled or not applicable.

**Acceptance Criteria**

2.1 WHEN `limitsEnabled = false`, THEN the wizard SHALL hide limits detail fields (`requestsPerMinute`, `maxConversations`, `maxMessagesPerDay`, `limitsStorageProvider`).

2.2 WHEN `themeInstallMode != install-selected`, THEN the wizard SHALL hide `themesToInstall`.

2.3 WHEN `trustProxy = false`, THEN the wizard SHALL hide `forwardedForHeader`.

2.4 WHEN a provider is disabled (e.g., `syncEnabled = false`), THEN the wizard SHALL hide provider-specific detail questions for that provider.

2.5 IF a field is hidden by condition, THEN it SHALL NOT be prompted and SHALL NOT block forward navigation.

---

### 3. Predictable navigation and step progression

**User Story**  
As an operator, I want `/back` and `/next` to behave consistently with hidden fields and skipped steps, so that navigation feels reliable.

**Acceptance Criteria**

3.1 WHEN `/next` is entered, THEN the wizard SHALL move to the next visible field in the current step, or the next visible step if no visible fields remain.

3.2 WHEN `/back` is entered at the first visible field in a step, THEN the wizard SHALL move to the previous visible step.

3.3 WHEN dynamic visibility changes due to prior answers, THEN navigation SHALL recalculate against current visibility before rendering the next prompt.

3.4 IF a step has no visible fields, THEN the wizard SHALL auto-skip that step.

---

### 4. Accurate progress display

**User Story**  
As an operator, I want step/question counters to reflect what I actually need to answer, so that progress feels trustworthy.

**Acceptance Criteria**

4.1 WHEN rendering `Step X of Y`, THEN `Y` SHALL represent only visible, non-skipped steps for current answers.

4.2 WHEN rendering `Question A of B`, THEN `B` SHALL represent only visible fields in that step for current answers.

4.3 WHEN visibility changes mid-session, THEN progress counters SHALL update immediately.

---

### 5. Validation parity with visibility

**User Story**  
As an operator, I want validation errors only for relevant enabled settings, so that disabled features do not produce noise.

**Acceptance Criteria**

5.1 WHEN `limitsEnabled = false`, THEN validation SHALL NOT fail on limits numeric bounds.

5.2 WHEN provider sections are disabled (`syncEnabled`, `storageEnabled`, etc.), THEN validation SHALL NOT require provider-specific fields for disabled sections.

5.3 IF a field is hidden and optional by flow, THEN validation SHALL respect that state and SHALL only enforce global invariants that still apply.

---

### 6. Documentation and usability consistency

**User Story**  
As an operator, I want wizard copy and behavior to match, so that the interface is trustworthy.

**Acceptance Criteria**

6.1 The template step description SHALL accurately state behavior (preset = fast path, custom = manual path).

6.2 Command help (`/back`, `/next`) SHALL remain valid after conditional visibility is introduced.

6.3 Unit and integration tests SHALL cover template branching, conditional field visibility, and dynamic navigation behavior.

---

### 7. Non-functional requirements

**Acceptance Criteria**

7.1 Flow computation SHALL remain lightweight and deterministic (no network calls in visibility/step computation).

7.2 Changes SHALL preserve existing output contracts for `.env` derivation and provider module derivation unless explicitly tied to visibility gating.

7.3 New logic SHALL be type-safe and compatible with current wizard API and CLI architecture.

---

### 8. Advanced settings must be opt-in per section

**User Story**  
As an operator, I want advanced prompts to be optional by section, so that I can complete setup quickly while still having full control when needed.

**Acceptance Criteria**

8.1 WHEN entering each configurable section (OR3 base, auth provider, sync provider, storage provider, AI/limits/security), THEN the wizard SHALL offer an explicit choice to configure advanced settings for that section.

8.2 WHEN the user selects “skip advanced settings” for a section, THEN the wizard SHALL apply documented reasonable defaults for all advanced fields in that section.

8.3 WHEN the user selects “configure advanced settings” for a section, THEN the wizard SHALL show that section’s advanced fields.

8.4 IF advanced settings are skipped, THEN review output SHALL still display the effective values (including defaults) for transparency.

8.5 IF advanced settings are skipped, THEN validation SHALL NOT require user input for advanced-only fields and SHALL validate against effective defaults.

8.6 A global expert mode SHALL be available to enable all advanced sections at once.

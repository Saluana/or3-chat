---
artifact_id: a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d
---

# OR3 Cloud Wizard UX Improvements: Requirements

## Introduction
This document outlines the requirements for improving the user experience of the OR3 Cloud installation wizard. The primary focus is on introducing a Web-based UI alternative to the existing CLI, alongside nine other key enhancements designed to streamline the setup process, reduce friction, and provide immediate feedback to the user.

## Requirements

### 1. Web-based UI Alternative (Primary Focus)
**User Story:** As a user, I want a web-based setup wizard so that I can visually configure my instance, preview themes, and easily navigate steps without relying solely on a terminal interface.
**Acceptance Criteria:**
- WHEN the user runs `or3-cloud init --ui` THEN the CLI SHALL start a local web server and open the default browser to the wizard interface.
- IF the user selects a theme in the web UI THEN the UI SHALL display a live visual preview of that theme.
- WHEN the user navigates between steps THEN the UI SHALL preserve their progress and allow non-linear navigation where valid.

### 2. Auto-detect Existing Configuration
**User Story:** As a user, I want the wizard to detect my existing settings so that I don't accidentally overwrite them or have to re-enter them.
**Acceptance Criteria:**
- WHEN the wizard initializes THEN it SHALL read the target `.env` file and pre-fill the session answers with existing values.
- IF an existing configuration is detected THEN the wizard SHALL prompt the user to confirm whether they want to update the existing setup or start fresh.

### 3. Auto-generate Secure Secrets
**User Story:** As a user, I want the wizard to automatically generate secure secrets for me so that I don't have to invent 32-character strings manually.
**Acceptance Criteria:**
- WHEN a secret field (e.g., JWT secret, FS token) is presented and left blank THEN the wizard SHALL automatically generate a cryptographically secure random string.
- IF the user is in the web UI THEN the UI SHALL provide a "Generate Secure Key" button next to secret inputs.

### 4. Immediate Connection Testing
**User Story:** As a user, I want the wizard to test my external credentials immediately so that I know if they are valid before completing the entire setup.
**Acceptance Criteria:**
- WHEN the user inputs credentials for an external provider (e.g., Clerk, Convex, S3) THEN the wizard SHALL perform a preflight network check.
- IF the connection fails THEN the wizard SHALL display an inline error message and prevent advancing until the issue is resolved or explicitly bypassed.

### 5. Simplify the "Advanced Settings" Gate
**User Story:** As a user, I want a simpler way to access advanced settings so that I am not overwhelmed by multiple boolean toggles upfront.
**Acceptance Criteria:**
- WHEN the user reaches a configuration section (e.g., Auth, Sync) THEN the wizard SHALL display a single "Show advanced options" toggle for that specific section.
- IF the toggle is off THEN the wizard SHALL hide advanced fields and use sensible defaults.

### 6. One-command Quickstart
**User Story:** As a developer, I want a single command to bypass all prompts and deploy a default local stack so that I can start testing immediately.
**Acceptance Criteria:**
- WHEN the user runs `or3-cloud init --fast` THEN the wizard SHALL automatically select the recommended preset, generate necessary secrets, and execute the deployment plan without interactive prompts.

### 7. Better Validation Recovery
**User Story:** As a user, I want to easily fix validation errors at the end of the wizard so that I don't lose my progress or have to restart the process.
**Acceptance Criteria:**
- WHEN validation fails at the review step THEN the wizard SHALL identify the specific step that failed.
- IF the user chooses to fix the error THEN the wizard SHALL navigate them directly back to the problematic field.

### 8. Interactive Provider Comparison
**User Story:** As a user, I want to see the pros and cons of different providers so that I can make an informed architectural choice.
**Acceptance Criteria:**
- WHEN the user is selecting a provider (e.g., Sync Provider) THEN the wizard SHALL display a brief summary of the pros, cons, and ideal use cases for each option.

### 9. Clearer Post-install Next Steps
**User Story:** As a user, I want clear instructions after deployment so that I know exactly how to access my new instance and what to do next.
**Acceptance Criteria:**
- WHEN the deployment completes successfully THEN the wizard SHALL print a clickable URL to the local server and a short, numbered checklist of next steps (e.g., accessing the admin panel).

### 10. Contextual Help for File Paths
**User Story:** As a user, I want the wizard to validate file paths as I type them so that I don't deploy with invalid directory configurations.
**Acceptance Criteria:**
- WHEN the user inputs a directory path (e.g., `instanceDir`, `sqliteDbPath`) THEN the wizard SHALL verify if the path exists.
- IF the path does not exist THEN the wizard SHALL warn the user and offer to create it automatically.

---
artifact_id: c3d4e5f6-a7b8-6c7d-0e1f-2a3b4c5d6e7f
---

# OR3 Cloud Wizard UX Improvements: Implementation Plan

## Phase 1: Core API Enhancements

- [ ] **1.1 Auto-detect existing `.env` configuration**
  - Update `createDefaultAnswers` in `shared/cloud/wizard/catalog.ts` to read the target `.env` file using `readEnvFile`.
  - Map existing env vars to `WizardAnswers` keys.
  - Add a prompt in the CLI to confirm overwriting or updating existing settings.
  - *Requirements: 2*

- [ ] **1.2 Auto-generate secure secrets**
  - Add a `generateSecureSecret(length = 32)` utility function to `shared/cloud/wizard/api.ts` using `crypto.randomBytes`.
  - Update the CLI prompt logic in `scripts/cli/or3-cloud.ts` to offer auto-generation when a secret field is left blank.
  - *Requirements: 3*

- [ ] **1.3 Immediate connection testing**
  - Add `testProviderConnection` to `WizardApi` interface and `Or3CloudWizardApi` class.
  - Implement connection tests for Clerk (verify secret key), Convex (verify URL and admin key), and S3 (verify endpoint and credentials).
  - Update the CLI to call this method after a provider's credentials are provided.
  - *Requirements: 4*

- [ ] **1.4 Contextual help for file paths**
  - Add `validatePath(path, autoCreate)` to `WizardApi`.
  - Update the CLI prompt logic for `instanceDir` and `sqliteDbPath` to check existence and offer creation.
  - *Requirements: 10*

## Phase 2: CLI Enhancements

- [ ] **2.1 Simplify the "Advanced Settings" gate**
  - Remove the global `allAdvancedEnabled` and section-specific toggles from the initial "Advanced Settings" step in `shared/cloud/wizard/steps.ts`.
  - Add a single "Show advanced options?" prompt at the end of each relevant section (Auth, Sync, Storage).
  - *Requirements: 5*

- [ ] **2.2 One-command quickstart (`--fast` flag)**
  - Add a `--fast` flag to `scripts/cli/or3-cloud.ts`.
  - When `--fast` is present, bypass all prompts, select the `preset-local` preset, auto-generate secrets, and immediately call `api.deploy()`.
  - *Requirements: 6*

- [ ] **2.3 Better validation recovery**
  - Update the `runInit` loop in `scripts/cli/or3-cloud.ts`.
  - When `api.validate()` fails, map the error keys to their respective `WizardStep` IDs.
  - Prompt the user to jump directly to the failed step instead of exiting.
  - *Requirements: 7*

- [ ] **2.4 Interactive provider comparison**
  - Update `WizardProviderDescriptor` in `shared/cloud/wizard/catalog.ts` to include `pros`, `cons`, and `idealUseCase`.
  - Update the CLI prompt for provider selection to display this metadata.
  - *Requirements: 8*

- [ ] **2.5 Clearer post-install next steps**
  - Update `deployAnswers` in `shared/cloud/wizard/deploy.ts` to return a structured checklist of next steps.
  - Print a clickable URL (e.g., `http://localhost:3000`) and instructions for accessing the admin panel.
  - *Requirements: 9*

## Phase 3: Web UI Backend (Nitro Server)

- [ ] **3.1 Create the WebWizardServer**
  - Create a new Nitro server entry point (e.g., `server/wizard/index.ts`) that wraps `Or3CloudWizardApi`.
  - Implement REST endpoints:
    - `GET /api/wizard/session`
    - `PATCH /api/wizard/session`
    - `POST /api/wizard/test-connection`
    - `POST /api/wizard/deploy`
  - *Requirements: 1*

- [ ] **3.2 Integrate WebWizardServer with CLI**
  - Update `scripts/cli/or3-cloud.ts` to accept an `--ui` flag.
  - When `--ui` is present, spawn the Nitro server on an available port and open the default browser to `http://localhost:<port>`.
  - *Requirements: 1*

## Phase 4: Web UI Frontend (Vue/Nuxt)

- [ ] **4.1 Setup WebWizardClient**
  - Create a standalone Vue/Nuxt application (e.g., in `app/wizard/`) to serve as the UI.
  - Configure Tailwind CSS and Nuxt UI components for styling.
  - *Requirements: 1*

- [ ] **4.2 Implement Wizard State Management**
  - Create `useWizardSession` composable to manage state, API calls to the Nitro server, and step navigation.
  - *Requirements: 1*

- [ ] **4.3 Build Step Components**
  - Create Vue components for each wizard step (Target, Preset, Branding, Themes, Providers, Review).
  - Implement live visual previews for the "Themes" step.
  - *Requirements: 1*

- [ ] **4.4 Integrate Enhancements into Web UI**
  - Add "Generate Secure Key" buttons next to secret inputs.
  - Implement inline connection testing with loading states and error messages.
  - Add interactive provider comparison cards with pros/cons.
  - Implement validation recovery by highlighting invalid fields and steps.
  - *Requirements: 1, 3, 4, 7, 8*

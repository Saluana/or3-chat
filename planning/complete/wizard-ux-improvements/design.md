---
artifact_id: b2c3d4e5-f6a7-5b6c-9d0e-1f2a3b4c5d6e
---

# OR3 Cloud Wizard UX Improvements: Technical Design

## Overview
This document details the technical design for implementing the 10 UX improvements to the OR3 Cloud installation wizard, with a primary focus on the Web-based UI alternative. The web UI will be served by a lightweight local Nitro server spawned by the CLI, communicating with the existing `Or3CloudWizardApi`.

## Architecture

The system introduces a new `WebWizardServer` that wraps the existing `Or3CloudWizardApi` in REST endpoints, and a `WebWizardClient` (a Vue/Nuxt application) that provides the interactive UI.

```mermaid
graph TD
    CLI[or3-cloud CLI] -->|Spawns| Nitro[WebWizardServer (Nitro)]
    Nitro -->|Serves| WebUI[WebWizardClient (Vue/Nuxt)]
    WebUI -->|REST API| Nitro
    Nitro -->|Calls| WizardAPI[Or3CloudWizardApi]
    WizardAPI -->|Reads/Writes| EnvFile[.env]
    WizardAPI -->|Persists| SessionStore[~/.or3-cloud/]
```

## Components and Interfaces

### 1. WebWizardServer (Nitro)
A lightweight local server that exposes the wizard API to the web client.

```typescript
// shared/cloud/wizard/server/api.ts
export interface WebWizardServerConfig {
    port: number;
    instanceDir: string;
    envFile: string;
}

export interface ConnectionTestResult {
    success: boolean;
    message?: string;
    details?: any;
}

// Example Endpoint Handlers
export async function handleGetSession(req: Request): Promise<WizardSession>;
export async function handlePatchSession(req: Request, patch: Partial<WizardAnswers>): Promise<WizardSession>;
export async function handleTestConnection(req: Request, provider: string, credentials: any): Promise<ConnectionTestResult>;
```

### 2. WebWizardClient (Vue/Nuxt)
A standalone single-page application (SPA) served by the Nitro server. It will use Nuxt UI components for a consistent look and feel.

```typescript
// app/wizard/composables/useWizardSession.ts
export interface WizardSessionState {
    session: WizardSession | null;
    currentStepId: string;
    validationErrors: Record<string, string>;
    isDeploying: boolean;
}

export function useWizardSession() {
    // Manages state, API calls to the local Nitro server, and step navigation
}
```

### 3. WizardApi Extensions
The existing `Or3CloudWizardApi` will be extended to support the new features.

```typescript
// shared/cloud/wizard/api.ts
export interface WizardApi {
    // Existing methods...
    
    // New methods
    testProviderConnection(providerId: string, credentials: Record<string, string>): Promise<ConnectionTestResult>;
    generateSecureSecret(length?: number): string;
    validatePath(path: string, autoCreate?: boolean): Promise<boolean>;
}
```

## Data Models

### Connection Testing
```typescript
export type ProviderConnectionTest = 
    | { provider: 'clerk'; secretKey: string }
    | { provider: 'convex'; url: string; adminKey: string }
    | { provider: 's3'; endpoint: string; accessKey: string; secretKey: string; bucket: string };
```

### Provider Metadata Extensions
The `WizardProviderDescriptor` in `catalog.ts` will be updated to include pros, cons, and use cases for the interactive comparison.

```typescript
export interface WizardProviderDescriptor {
    // Existing fields...
    pros: string[];
    cons: string[];
    idealUseCase: string;
}
```

## Error Handling

### Validation Recovery Flow
When `api.validate()` returns errors, the CLI and Web UI will map the error keys back to their respective `WizardStep` and `WizardField`. The UI will highlight the specific step in the navigation sidebar and focus the invalid input field.

```typescript
export interface ValidationRecoveryState {
    failedStepId: string;
    failedFieldKey: string;
    errorMessage: string;
}
```

## Testing Strategy

1. **Unit Testing:**
   - Test `generateSecureSecret` for randomness and length.
   - Test `testProviderConnection` mocks for Clerk, Convex, and S3 to ensure correct success/failure mapping.
   - Test `validatePath` for directory existence and creation logic.

2. **Integration Testing:**
   - Test the Nitro server endpoints (`GET /api/session`, `PATCH /api/session`) against a temporary file system to ensure state persists correctly.

3. **End-to-End Testing:**
   - Use Playwright to launch the CLI with `--ui`, navigate through the web wizard, fill out a mock configuration, and verify the resulting `.env` file and deployment output.

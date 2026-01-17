# Authentication System

The OR3 Authentication System uses a hybrid approach: **Clerk** is used for user identity and workspace provisioning, while **OpenRouter** is used separately for LLM API access via PKCE. This separation ensures that we can manage user access and billing for the "cloud" features (Sync, Share) independently of their chosen LLM provider.

---

## Architecture Overview

### 1. Identity & Workspace Provisioning (Clerk + Convex)

When a user logs in via Clerk, we automatically provision a **Convex Workspace** for them. This creates a 1:1 mapping between the Clerk User and an OR3 Workspace.

**Flow:**
1.  **Login**: User authenticates on the client with Clerk.
2.  **Session Resolution**: The Nuxt server interceptor (`/api/auth/session`) verifies the Clerk session.
3.  **Provisioning**: The server calls the Convex mutation `api.workspaces.ensure`.
    *   If the user is new, a Workspace is created.
    *   If existing, their role and details are returned.
4.  **Context**: The `SessionContext` is returned to the client, containing the `workspaceId` needed for sync.

### 2. Client-Side Session Management

The client app uses composables to manage this state:

*   **`useSessionContext`**: Fetches the resolved session from the server (SSR-safe).
*   **`useSession`**: Provides reactive "Is Signed In" state and User ID.
*   **`convex-clerk.client.ts`**: A plugin that bridges Clerk and Convex. it watches the Clerk session and pushes the JWT to the Convex client (`convex.setAuth`), enabling RLS (Row Level Security) on the backend.

### 3. LLM Authorization (OpenRouter)

Access to LLM models is handled separately via **OAuth PKCE** with OpenRouter. This key is stored locally in IndexedDB and is **never** sent to our cloud servers.

*   **Flow**: User clicks "Connect OpenRouter" -> PKCE Handshake -> Token received.
*   **Storage**: Token is saved in local Dexie DB (`kv` table).
*   **Usage**: The token is injected directly into browser-side API calls to OpenRouter.

---

## Server-Side Implementation

The core logic resides in `server/auth/session.ts` implementation of `resolveSessionContext`.

```typescript
// Simplified logic
export async function resolveSessionContext(event) {
    // 1. Verify Clerk Session
    const providerSession = await provider.getSession(event);
    if (!providerSession) return null;

    // 2. Ensure Workspace exists in Convex
    const workspace = await convex.mutation(api.workspaces.ensure, {
        identity: providerSession.user
    });

    // 3. Return combined context
    return {
        user: providerSession.user,
        workspace: { id: workspace.id },
        authenticated: true
    };
}
```

## Sync Integration

The Sync Engine (`convex-sync`) relies on the session to authenticate its WebSocket connection.
*   It uses `useAuthTokenBroker` to request a fresh JWT from Clerk on demand.
*   This token is passed to the Sync Provider during the handshake.

---

## Configuration

Two flags control the auth system in `nuxt.config.ts`:

*   `SSR_AUTH_ENABLED`: Enables the Clerk integration and server-side session resolution.
*   `CONVEX_URL`: Points to the backend instance for workspace data.

If `SSR_AUTH_ENABLED` is false, the app runs in "Local Mode" (no sync, local storage only).

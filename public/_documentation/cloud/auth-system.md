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
*   **`or3-provider-convex` module**: Registers the Convex auth bridge plugin at build time. It watches the Clerk session and pushes the JWT to the Convex client (`convex.setAuth`), enabling RLS (Row Level Security) on the backend.

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

Two env vars control the default Clerk + Convex auth/sync setup:

*   `SSR_AUTH_ENABLED`: Enables the Clerk integration and server-side session resolution.
*   `VITE_CONVEX_URL`: Convex deployment URL (used for workspace provisioning + sync/storage).

If `SSR_AUTH_ENABLED` is false, the app runs in "Local Mode" (no sync, local storage only).

You can also disable sync/storage independently (while keeping auth enabled) via:

- `OR3_SYNC_ENABLED=false`
- `OR3_STORAGE_ENABLED=false`

---

## Implementing Custom Auth Providers

While Clerk is the default provider, you can implement custom authentication (Firebase Auth, Auth0, custom JWT, etc.) by implementing the `AuthProvider` interface.

### 1. The AuthProvider Interface

```typescript
// server/auth/types.ts
export interface AuthProvider {
    id: string;
    
    // Extract and verify session from request
    getSession(event: H3Event): Promise<ProviderSession | null>;
    
    // Optional: Handle token refresh
    refreshSession?(event: H3Event): Promise<ProviderSession | null>;
}

export interface ProviderSession {
    user: {
        id: string;
        email?: string;
        displayName?: string;
    };
    token: string;
    expiresAt?: number;
}
```

### 2. Implementation Example

```typescript
// server/auth/firebase-provider.ts
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AuthProvider, ProviderSession } from './types';

export class FirebaseAuthProvider implements AuthProvider {
    id = 'firebase';
    
    constructor() {
        // Initialize Firebase Admin if not already done
        if (getApps().length === 0) {
            initializeApp({
                credential: applicationDefault(),
            });
        }
    }
    
    async getSession(event: H3Event): Promise<ProviderSession | null> {
        const token = getHeader(event, 'authorization')?.replace('Bearer ', '');
        if (!token) return null;
        
        try {
            const decoded = await getAuth().verifyIdToken(token);
            
            return {
                user: {
                    id: decoded.uid,
                    email: decoded.email,
                    displayName: decoded.name,
                },
                token,
                expiresAt: decoded.exp * 1000,
            };
        } catch (error) {
            console.error('Firebase auth error:', error);
            return null;
        }
    }
}
```

### 3. Register the Provider

```typescript
// server/auth/providers.ts
import { FirebaseAuthProvider } from './firebase-provider';
import { registerAuthProvider } from './registry';

export function registerAuthProviders() {
    registerAuthProvider(new FirebaseAuthProvider());
}
```

### 4. Configure Environment

```bash
# .env
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=firebase
FIREBASE_PROJECT_ID=your-project
# Firebase Admin SDK credentials
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
```

### 5. Client-Side Integration

```typescript
// plugins/firebase-auth.client.ts
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig();
    
    if (config.public.authProvider !== 'firebase') return;
    
    const app = initializeApp({
        apiKey: config.public.firebaseApiKey,
        authDomain: config.public.firebaseAuthDomain,
        projectId: config.public.firebaseProjectId,
    });
    
    const auth = getAuth(app);
    
    // Watch auth state and sync to session
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const token = await user.getIdToken();
            // Send token to server
            await $fetch('/api/auth/session', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
        }
    });
});
```

### Provider Comparison

| Provider | Best For | Setup Complexity | Features |
|----------|----------|------------------|----------|
| **Clerk** | Default, modern UX | Low | Sessions, MFA, orgs |
| **Firebase** | Google ecosystem | Medium | Realtime, analytics |
| **Auth0** | Enterprise | Medium | SSO, compliance |
| **Custom JWT** | Full control | High | Maximum flexibility |

---

## Session Lifecycle

### Token Refresh

Sessions are automatically refreshed:
- Clerk: Handled by Clerk SDK
- Custom: Implement `refreshSession` in provider

### Session Expiration

```typescript
// Check session validity
const session = useSessionContext();
const isValid = computed(() => {
    if (!session.data.value?.session) return false;
    // Check expiration if available
    return true;
});
```

### Logout Flow

1. Client calls logout endpoint
2. Server clears session cookie
3. Client clears local state
4. Auth provider signs out (e.g., Clerk signOut)
5. Workspace data remains in Dexie (local-first)

---

## Troubleshooting Auth

### "Unauthorized: No identity"
- User not authenticated
- Check Clerk session
- Verify auth provider is configured

### "Workspace not found"
- Session valid but workspace provisioning failed
- Check Convex connection
- Verify `workspaces.ensure` mutation

### "Session expired"
- Token expired and refresh failed
- Check token refresh implementation
- Verify user still exists in auth provider

### CORS errors
- Check `allowedOrigins` configuration
- Verify Clerk allowed origins
- Check redirect URLs match

---

## Related

- [or3-cloud-config](./or3-cloud-config) - Configuration reference
- [Sync Layer](./sync-layer) - Sync depends on auth
- [Troubleshooting](./troubleshooting) - Common issues

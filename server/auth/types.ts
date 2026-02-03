/**
 * @module server/auth/types.ts
 *
 * Purpose:
 * Central type definitions for OR3 SSR authentication. Provides provider-agnostic
 * interfaces that allow the system to swap between different auth providers (Clerk, etc.)
 * while maintaining a stable internal session model.
 *
 * Responsibilities:
 * - Define the shape of user identities and sessions from external providers.
 * - Define the contract for auth provider implementations.
 * - Define registry types for provider discovery and instantiation.
 *
 * Non-responsibilities:
 * - Handling actual auth logic (see `AuthProvider` implementors).
 * - Component-level auth state (see `AuthWorkspaceStore`).
 * - Permission logic (see `can.ts`).
 */
import type { H3Event } from 'h3';

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Purpose:
 * Represents a normalized user identity retrieved from an external auth provider.
 *
 * Key fields:
 * - `id`: The unique identifier from the provider (e.g., Clerk user ID).
 * - `email`: Primary email address associated with the account.
 * - `displayName`: Optional human-readable name for UI display.
 */
export interface ProviderUser {
    id: string;
    email?: string;
    displayName?: string;
}

/**
 * Purpose:
 * Represents a session resolved from an external auth provider.
 * This is the raw data used to provision or resolve internal OR3 sessions.
 *
 * Key fields:
 * - `provider`: Unique ID of the provider that issued this session.
 * - `user`: The normalized user identity.
 * - `expiresAt`: When the provider's token expires.
 * - `claims`: Raw JWT claims or other metadata from the provider.
 */
export interface ProviderSession {
    provider: string;
    user: ProviderUser;
    expiresAt: Date;
    claims?: Record<string, unknown>;
}

/**
 * Purpose:
 * Interface for auth provider implementations.
 *
 * Responsibilities:
 * - Extract and validate auth signals (tokens/cookies) from H3 events.
 * - Return a normalized `ProviderSession` or `null` if unauthenticated.
 *
 * Constraints:
 * - Must be stateless; configuration should be passed at instantiation.
 * - Should handle its own error logging and instrumentation.
 */
export interface AuthProvider {
    /** Unique name/ID of the provider (e.g., 'clerk'). */
    name: string;
    /** Resolves a provider session from a request event. */
    getSession(event: H3Event): Promise<ProviderSession | null>;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Purpose:
 * Factory function for lazy instantiation of auth providers.
 */
export type AuthProviderFactory = () => AuthProvider;

/**
 * Purpose:
 * Represents an entry in the Auth Provider Registry.
 *
 * Keys:
 * - `id`: Unique identifier for the provider.
 * - `order`: Optional priority for resolution (lower runs first).
 * - `create`: Factory function to instantiate the provider.
 */
export interface AuthProviderRegistryItem {
    id: string;
    order?: number;
    create: AuthProviderFactory;
}

// ============================================================================
// Re-exports from hook-types (for server usage)
// ============================================================================

// Note: Permission, WorkspaceRole, AccessDecision, SessionContext are defined
// in app/core/hooks/hook-types.ts and should be imported from there when needed.
// We re-export the types here for convenience in server code.
export type { Permission, WorkspaceRole, AccessDecision, SessionContext } from '../../app/core/hooks/hook-types';

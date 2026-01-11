/**
 * Server-side auth types for SSR authentication.
 * Provider-agnostic interfaces for auth integration.
 */
import type { H3Event } from 'h3';

// ============================================================================
// Provider Types
// ============================================================================

/** User identity from an auth provider. */
export interface ProviderUser {
    id: string;
    email?: string;
    displayName?: string;
}

/** Session information from an auth provider. */
export interface ProviderSession {
    provider: string;
    user: ProviderUser;
    expiresAt: Date;
    claims?: Record<string, unknown>;
}

/** Auth provider interface. Implementors resolve sessions from H3 events. */
export interface AuthProvider {
    name: string;
    getSession(event: H3Event): Promise<ProviderSession | null>;
}

// ============================================================================
// Registry Types
// ============================================================================

/** Factory function to create an auth provider. */
export type AuthProviderFactory = () => AuthProvider;

/** Registry entry for an auth provider. */
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

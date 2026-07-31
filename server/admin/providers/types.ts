/**
 * @module server/admin/providers/types.ts
 *
 * Purpose:
 * Defines the contract for "Provider Admin Adapters". These adapters allow the
 * OR3 Admin Dashboard to inspect and manage the external services (Auth, Sync, Storage)
 * that power a deployment.
 *
 * Responsibilities:
 * - Define types for provider health monitoring (status, warnings).
 * - Define types for administrative actions (GC, config validation).
 * - Provide a unified interface for kind-specific adapters.
 *
 * Architecture:
 * - Each provider (e.g., Clerk, Convex) can implement a `ProviderAdminAdapter`.
 * - The dashboard uses these to show "Provider Cards" with live status and tools.
 */
import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';

/**
 * Purpose:
 * The primary categories of external providers supported by OR3.
 */
export type ProviderKind = 'auth' | 'sync' | 'storage';

/**
 * Purpose:
 * Represents a diagnostic warning or error reported by a provider adapter.
 * Displayed as alerts in the Admin Dashboard.
 */
export type AdminWarning = {
    level: 'warning' | 'error';
    message: string;
};

/**
 * Purpose:
 * Defines an executable action exposed by a provider.
 * Triggers a `runAction` call when clicked in the UI.
 */
export type ProviderAdminAction = {
    /** Unique ID for the action. */
    id: string;
    /** Human-readable button label. */
    label: string;
    /** Descriptive text explaining what the action does. */
    description?: string;
    /** If true, requires explicit confirmation in the UI. */
    danger?: boolean;
};

/**
 * Purpose:
 * Context provided to `getStatus` about the current provider configuration.
 */
export type ProviderStatusContext = {
    /** Whether this provider is currently selected as the active one. */
    enabled: boolean;
    /** The ID of the provider (e.g., 'clerk' or 'convex'). */
    provider: string;
};

/**
 * Purpose:
 * The complete status packet for a provider card.
 */
export type ProviderAdminStatus = {
    enabled: boolean;
    provider: string;
    /** Arbitrary data points to display in the card (e.g., 'Version', 'URL'). */
    details?: Record<string, unknown>;
    /** Diagnostic issues detected by the adapter. */
    warnings: AdminWarning[];
    /** Management tools exposed by the adapter. */
    actions: ProviderAdminAction[];
};

/**
 * Purpose:
 * Shorthand for return values from `getStatus`.
 */
export type ProviderAdminStatusResult = Omit<
    ProviderAdminStatus,
    'enabled' | 'provider'
>;

/**
 * Purpose:
 * Context provides to `runAction` including user session and usage flags.
 */
export type ProviderActionContext = {
    provider: string;
    enabled: boolean;
    session: SessionContext;
};

/**
 * Purpose:
 * The core interface for provider management.
 *
 * Implementors are responsible for translating internal OR3 needs into
 * provider-specific API calls or configuration checks.
 */
export interface ProviderAdminAdapter {
    /** Unique ID (e.g., 'clerk'). */
    id: string;
    /** The category of provider. */
    kind: ProviderKind;

    /**
     * Purpose:
     * Returns the current "health" and management interface for the provider.
     * Often checks environment variables or performs light network probes.
     */
    getStatus(event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult>;

    /**
     * Purpose:
     * Executes a server-side maintenance task or administrative change.
     *
     * @param actionId - The ID defined in `getStatus().actions`.
     * @param payload - User inputs from the action modal (optional).
     * @param ctx - Context about the requestor and current project state.
     */
    runAction?(
        event: H3Event,
        actionId: string,
        payload: Record<string, unknown> | undefined,
        ctx: ProviderActionContext
    ): Promise<unknown>;
}

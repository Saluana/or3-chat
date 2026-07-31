/**
 * Trust labeling and isolation enablement policy.
 * Isolated descriptors must never silently fall back to trusted-host execution.
 */

import type { PluginTrustMode } from '../runtime-descriptor';

export type IsolationTrustClass =
    | 'trusted-host'
    | 'isolated-client'
    | 'isolated-server';

export type TrustLabelKind =
    | 'trusted-in-process'
    | 'isolated-client-sandbox'
    | 'isolated-server-boundary';

export type TrustImportDecision =
    | {
          readonly allowed: true;
          readonly trust: IsolationTrustClass;
          readonly label: TrustLabelKind;
      }
    | {
          readonly allowed: false;
          readonly trust: IsolationTrustClass;
          readonly code:
              | 'isolation-disabled'
              | 'silent-fallback-prohibited'
              | 'unknown-trust';
          readonly message: string;
          readonly label: TrustLabelKind | 'unlabeled';
      };

export interface TrustPolicyInput {
    /** Startup-only flag; never toggled at runtime. */
    readonly pluginIsolationEnabled: boolean;
    readonly trust: PluginTrustMode | string;
    /**
     * If a caller attempts to rewrite isolated → trusted-host, pass the
     * proposed fallback here. Silent fallback is always rejected.
     */
    readonly proposedFallbackTrust?: PluginTrustMode | string;
}

export function isIsolatedTrust(trust: string): boolean {
    return trust === 'isolated-client' || trust === 'isolated-server';
}

export function isTrustedHostTrust(trust: string): boolean {
    return trust === 'trusted-host';
}

/**
 * Human-facing label for UI/docs. Trusted grants are never called a "sandbox".
 */
export function labelForTrust(trust: string): TrustLabelKind | 'unlabeled' {
    switch (trust) {
        case 'trusted-host':
            return 'trusted-in-process';
        case 'isolated-client':
            return 'isolated-client-sandbox';
        case 'isolated-server':
            return 'isolated-server-boundary';
        default:
            return 'unlabeled';
    }
}

/**
 * Decide whether a descriptor may proceed to import/activation under the
 * current startup isolation flag.
 */
export function evaluateTrustImport(
    input: TrustPolicyInput
): TrustImportDecision {
    const { trust, pluginIsolationEnabled, proposedFallbackTrust } = input;

    if (
        trust !== 'trusted-host' &&
        trust !== 'isolated-client' &&
        trust !== 'isolated-server'
    ) {
        return {
            allowed: false,
            trust: 'trusted-host',
            code: 'unknown-trust',
            message: `Unknown trust mode: ${trust}`,
            label: 'unlabeled',
        };
    }

    if (
        proposedFallbackTrust !== undefined &&
        isIsolatedTrust(trust) &&
        proposedFallbackTrust === 'trusted-host'
    ) {
        return {
            allowed: false,
            trust,
            code: 'silent-fallback-prohibited',
            message:
                'Silent fallback from isolated trust to trusted-host is prohibited',
            label: labelForTrust(trust),
        };
    }

    if (trust === 'trusted-host') {
        return {
            allowed: true,
            trust: 'trusted-host',
            label: 'trusted-in-process',
        };
    }

    if (!pluginIsolationEnabled) {
        return {
            allowed: false,
            trust,
            code: 'isolation-disabled',
            message:
                `Trust mode ${trust} requires pluginIsolationEnabled; ` +
                'blocked before import (no trusted-host downgrade)',
            label: labelForTrust(trust),
        };
    }

    return {
        allowed: true,
        trust,
        label: labelForTrust(trust) as Exclude<TrustLabelKind, 'trusted-in-process'>,
    };
}

/**
 * UI/docs helper: never describe trusted-host grants as a sandbox.
 */
export function describeGrantBoundary(trust: PluginTrustMode): string {
    if (trust === 'trusted-host') {
        return 'Trusted in-process mediation (not a sandbox)';
    }
    if (trust === 'isolated-client') {
        return 'Isolated client sandbox (Worker or iframe)';
    }
    return 'Isolated server process boundary';
}

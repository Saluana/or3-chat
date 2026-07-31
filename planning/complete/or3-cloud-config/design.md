# design.md

artifact_id: or3-cloud-config-design
date: 2026-01-23
updated: 2026-01-18

## Overview

The `or3-cloud-config` system introduces a typed configuration file, `config.or3cloud.ts`, located at the project root. This file serves as the single source of truth for OR3 Cloud environment settings, abstracting away the complexity of `nuxt.config.ts` and `runtimeConfig`.

## Architecture

### 1. Configuration Schema (`config.or3cloud.ts`)

The configuration will be defined using a TypeScript interface to ensure type safety.

```typescript
// types/or3-cloud-config.d.ts (Proposed)

export interface Or3CloudConfig {
  /**
   * Authentication configuration.
   * Controls SSR authentication, providers, and permissions.
   */
  auth: {
    /**
     * Enable SSR authentication.
     * When false, the app runs in local-only mode (static compatible).
     * @default false
     */
    enabled: boolean;
    /**
     * Selected authentication provider.
     * @default 'clerk'
     */
    provider: 'clerk' | 'custom';
    /**
     * Provider-specific configuration.
     */
    clerk?: {
      publishableKey?: string;
      secretKey?: string;
    };
  };

  /**
   * Data Synchronization configuration.
   * Controls real-time sync, database providers, and offline capabilities.
   */
  sync: {
    /**
     * Enable data synchronization.
     * @default false
     */
    enabled: boolean;
    /**
     * Sync provider backend.
     * @default 'convex'
     */
    provider: 'convex' | 'firebase' | 'custom';
    /**
     * Convex specific configuration.
     */
    convex?: {
      url?: string;
    };
  };

  /**
   * Storage configuration.
   * Controls file uploads, blob storage, and media handling.
   */
  storage: {
    /**
     * Enable cloud storage.
     * @default false
     */
    enabled: boolean;
    /**
     * Storage provider.
     * @default 'convex'
     */
    provider: 'convex' | 's3' | 'custom';
  };

  /**
   * Core cloud services and integrations.
   */
  services: {
    /**
     * AI/LLM integration settings.
     */
    llm?: {
      openRouter?: {
        /**
         * Instance-level API key provided by the cloud hoster.
         * Used as a fallback when users haven't configured their own key.
         * @env OPENROUTER_API_KEY
         */
        instanceApiKey?: string;
        
        /**
         * If true, users can override with their own API key in settings.
         * If false, only the instance key is used (enterprise deployments).
         * @default true
         */
        allowUserOverride?: boolean;
      };
    };
  };

  /**
   * Rate limiting and usage quotas.
   * Controls API usage limits for the instance.
   */
  limits?: {
    /**
     * Enable rate limiting.
     * @default true
     */
    enabled?: boolean;
    
    /**
     * Maximum LLM requests per user per minute.
     * @default 20
     */
    requestsPerMinute?: number;
    
    /**
     * Maximum conversations per user (0 = unlimited).
     * @default 0
     */
    maxConversations?: number;
    
    /**
     * Maximum messages per user per day (0 = unlimited).
     * @default 0
     */
    maxMessagesPerDay?: number;
  };

  /**
   * Branding and customization options.
   * Allows cloud hosters to customize the app appearance.
   */
  branding?: {
    /**
     * Custom application name.
     * @default 'OR3'
     */
    appName?: string;
    
    /**
     * URL to a custom logo image.
     */
    logoUrl?: string;
    
    /**
     * Default theme for new users.
     * @default 'system'
     */
    defaultTheme?: 'light' | 'dark' | 'system' | string;
  };

  /**
   * Legal URLs for compliance.
   * Required for public deployments.
   */
  legal?: {
    /**
     * URL to Terms of Service page.
     */
    termsUrl?: string;
    
    /**
     * URL to Privacy Policy page.
     */
    privacyUrl?: string;
  };

  /**
   * Security hardening options.
   */
  security?: {
    /**
     * Allowed origins for CORS. Empty array means all origins allowed.
     */
    allowedOrigins?: string[];
    
    /**
     * Force HTTPS redirects.
     * @default true in production
     */
    forceHttps?: boolean;
  };

  /**
   * Plugin/extension configuration namespace.
   * Allows third-party plugins to register their own config.
   * @example { myPlugin: { settingA: true } }
   */
  extensions?: Record<string, unknown>;
}

export interface Or3CloudConfigOptions {
  /**
   * If true, throws at startup if required secrets are missing.
   * @default true in production, false in development
   */
  strict?: boolean;
}

/**
 * Define the OR3 Cloud configuration.
 * @param config - The configuration object
 * @param options - Optional settings for validation behavior
 */
export function defineOr3CloudConfig(
  config: Or3CloudConfig, 
  options?: Or3CloudConfigOptions
): Or3CloudConfig;
```

### 2. Integration with `nuxt.config.ts`

`nuxt.config.ts` will import this configuration and use it to populate `runtimeConfig` and `modules`.

```typescript
// nuxt.config.ts
import { or3CloudConfig } from './config.or3cloud';

export default defineNuxtConfig({
  // Map or3CloudConfig to runtimeConfig
  runtimeConfig: {
    auth: {
      enabled: or3CloudConfig.auth.enabled,
      provider: or3CloudConfig.auth.provider,
    },
    // ... maps other secrets ...
    public: {
      ssrAuthEnabled: or3CloudConfig.auth.enabled,
      sync: {
        enabled: or3CloudConfig.sync.enabled,
        provider: or3CloudConfig.sync.provider,
        convexUrl: or3CloudConfig.sync.convex?.url,
      },
      // ... maps other public vars ...
    }
  },

  modules: [
    // Conditionally load modules based on config
    ...(or3CloudConfig.auth.enabled && or3CloudConfig.auth.provider === 'clerk'
      ? ['@clerk/nuxt']
      : []),
    ...(or3CloudConfig.sync.enabled && or3CloudConfig.sync.provider === 'convex'
      ? ['convex-nuxt']
      : []),
  ],
});
```

### 3. Usage in Application

The application code will continue to use `useRuntimeConfig()` or dedicated composables (`useAuth`, `useSync`) which are now backed by the consistent `or3CloudConfig`.

### 4. DX & Defaults

- **Defaults**: The system will provide sensible defaults (e.g., local-first, no cloud features) so the app works out-of-the-box.
- **Env Vars**: The default `config.or3cloud.ts` template will use `process.env` for keys, preserving the 12-factor app methodology while giving visibility into which env vars are used.

## Example `config.or3cloud.ts`

```typescript
import { defineOr3CloudConfig } from './utils/or3-cloud-config';

export const or3CloudConfig = defineOr3CloudConfig({
  auth: {
    enabled: process.env.SSR_AUTH_ENABLED === 'true',
    provider: 'clerk',
    clerk: {
      publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.NUXT_CLERK_SECRET_KEY,
    }
  },
  sync: {
    enabled: true,
    provider: 'convex',
    convex: {
      url: process.env.NUXT_PUBLIC_CONVEX_URL,
    }
  },
  storage: {
    enabled: true,
    provider: 'convex',
  },
  services: {
    llm: {
      openRouter: {
        instanceApiKey: process.env.OPENROUTER_API_KEY,
        allowUserOverride: true,
      }
    }
  },
  limits: {
    enabled: true,
    requestsPerMinute: 30,
  },
  branding: {
    appName: 'My OR3 Instance',
    defaultTheme: 'dark',
  },
  legal: {
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
  },
  security: {
    forceHttps: true,
  },
}, { strict: true });
```

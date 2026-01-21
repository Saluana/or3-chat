# tasks.md

artifact_id: or3-cloud-config-tasks
date: 2026-01-23
updated: 2026-01-18

## 1. Define Types and Utilities

- [x] Create `types/or3-cloud-config.d.ts` (or similar location) to define the `Or3CloudConfig` interface.
- [x] Create a utility file (e.g., `utils/or3-cloud-config.ts`) exporting `defineOr3CloudConfig` helper for type inference.

## 2. Create Config File

- [x] Create `config.or3cloud.ts` in the root directory.
- [x] Populate it with default values utilizing `process.env` to maintain backward compatibility with existing `.env` setups.
- [x] Add extensive JSDoc comments to options for developer guidance.

## 3. Refactor `nuxt.config.ts`

- [x] Import `config.or3cloud.ts` in `nuxt.config.ts`.
- [x] Replace direct `process.env` lookups in `runtimeConfig` with values from `or3CloudConfig`.
- [x] Update `modules` section to conditionally load `@clerk/nuxt` and `convex-nuxt` based on `or3CloudConfig` flags.
- [x] Ensure `alias` and other build settings are compatible.

## 4. Verification & Testing

- [x] Verify that disabling `auth.enabled` in `config.or3cloud.ts` correctly disables SSR auth features and Clerk module.
- [x] Verify that `sync.enabled` toggle works as expected.
- [x] Check if static builds (without SSR auth) still function correctly.
- [x] Verify type checking (`bun run type-check`) passes with the new config structure.

## 5. Documentation

- [x] Update main README or create a new doc explaining how to use `config.or3cloud.ts` to manage the environment.
- [x] Document all configuration options with examples for common deployment scenarios.

## 6. Shared API Key Support

- [x] Implement `services.llm.openRouter.instanceApiKey` field.
- [x] Implement `allowUserOverride` logic in the LLM request flow.
- [x] Add UI to indicate when using instance vs. user API key.

## 7. Rate Limiting & Usage Limits

- [x] Implement `limits.requestsPerMinute` enforcement.
- [x] Implement `limits.maxConversations` enforcement (if non-zero).
- [x] Implement `limits.maxMessagesPerDay` enforcement (if non-zero).
- [x] Add UI feedback when limits are reached.

## 8. Branding & Customization

- [x] Implement `branding.appName` throughout UI (title, headers, etc.).
- [x] Implement `branding.logoUrl` in sidebar/header.
- [x] Implement `branding.defaultTheme` for new users.

## 9. Legal Compliance

- [x] Implement `legal.termsUrl` display in footer.
- [x] Implement `legal.privacyUrl` display in footer.
- [x] Conditionally show legal links only when configured.

## 10. Security Hardening

- [x] Implement `security.allowedOrigins` CORS configuration.
- [x] Implement `security.forceHttps` redirect middleware.

## 11. Validation & Strict Mode

- [x] Implement `defineOr3CloudConfig` validation logic.
- [x] Implement `strict` mode startup checks.
- [x] Log clear error messages for missing required config.

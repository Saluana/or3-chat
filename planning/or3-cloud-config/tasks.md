# tasks.md

artifact_id: or3-cloud-config-tasks
date: 2026-01-23
updated: 2026-01-18

## 1. Define Types and Utilities

- [ ] Create `types/or3-cloud-config.d.ts` (or similar location) to define the `Or3CloudConfig` interface.
- [ ] Create a utility file (e.g., `utils/or3-cloud-config.ts`) exporting `defineOr3CloudConfig` helper for type inference.

## 2. Create Config File

- [ ] Create `config.or3cloud.ts` in the root directory.
- [ ] Populate it with default values utilizing `process.env` to maintain backward compatibility with existing `.env` setups.
- [ ] Add extensive JSDoc comments to options for developer guidance.

## 3. Refactor `nuxt.config.ts`

- [ ] Import `config.or3cloud.ts` in `nuxt.config.ts`.
- [ ] Replace direct `process.env` lookups in `runtimeConfig` with values from `or3CloudConfig`.
- [ ] Update `modules` section to conditionally load `@clerk/nuxt` and `convex-nuxt` based on `or3CloudConfig` flags.
- [ ] Ensure `alias` and other build settings are compatible.

## 4. Verification & Testing

- [ ] Verify that disabling `auth.enabled` in `config.or3cloud.ts` correctly disables SSR auth features and Clerk module.
- [ ] Verify that `sync.enabled` toggle works as expected.
- [ ] Check if static builds (without SSR auth) still function correctly.
- [ ] Verify type checking (`bun run type-check`) passes with the new config structure.

## 5. Documentation

- [ ] Update main README or create a new doc explaining how to use `config.or3cloud.ts` to manage the environment.
- [ ] Document all configuration options with examples for common deployment scenarios.

## 6. Shared API Key Support

- [ ] Implement `services.llm.openRouter.instanceApiKey` field.
- [ ] Implement `allowUserOverride` logic in the LLM request flow.
- [ ] Add UI to indicate when using instance vs. user API key.

## 7. Rate Limiting & Usage Limits

- [ ] Implement `limits.requestsPerMinute` enforcement.
- [ ] Implement `limits.maxConversations` enforcement (if non-zero).
- [ ] Implement `limits.maxMessagesPerDay` enforcement (if non-zero).
- [ ] Add UI feedback when limits are reached.

## 8. Branding & Customization

- [ ] Implement `branding.appName` throughout UI (title, headers, etc.).
- [ ] Implement `branding.logoUrl` in sidebar/header.
- [ ] Implement `branding.defaultTheme` for new users.

## 9. Legal Compliance

- [ ] Implement `legal.termsUrl` display in footer.
- [ ] Implement `legal.privacyUrl` display in footer.
- [ ] Conditionally show legal links only when configured.

## 10. Security Hardening

- [ ] Implement `security.allowedOrigins` CORS configuration.
- [ ] Implement `security.forceHttps` redirect middleware.

## 11. Validation & Strict Mode

- [ ] Implement `defineOr3CloudConfig` validation logic.
- [ ] Implement `strict` mode startup checks.
- [ ] Log clear error messages for missing required config.

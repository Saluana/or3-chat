---
name: retro-agent-v2
description: Retro Nuxt 4 chat app engineering standards for this repo. Use when building or reviewing features, UI, or architecture in the retro-styled Nuxt 4 app, especially with Nuxt UI, Tailwind v4, Dexie, Orama, OpenRouter auth, hooks, or theme/UX constraints.
---

# Retro Agent V2

## Overview

Apply the repo-specific retro Nuxt 4 engineering rules and UX constraints with strict simplicity, performance, and correctness.

## Operating Rules

- Answer the user's query exactly.
- Do not ask follow-up questions.
- Do not anticipate user needs.
- Take the simplest effective approach with the least code while keeping performance and security S-tier.
- Be blunt, critical, and direct. No praise or hand-holding.
- Treat any potential crash, leak, race, or correctness risk as broken.
- Prefer one clear pattern. Remove duplication and near-duplication.
- Use precise types. Do not cast to silence errors.
- Keep builds deterministic and Bun-first.
- Make code testable by design; wrap side effects and make them injectable.
- Always typecheck and lint after changes.

## Tooling And Docs

- Use Bun for all scripts, installs, builds, and execution.
- Use `bunx vitest` for tests.
- If unsure about a library or framework feature, consult Context7 MCP.
- If unsure about project specifics, consult `public/_documentation/docmap.json` first, then open referenced docs.
- Use `.llms/nuxt.txt`, `.llms/orama.txt`, and `.llms/nuxtui.txt` to navigate official docs when needed.

## Styling And Theme

- Use existing theme classes: `.light`, `.dark`, `*-high-contrast`, `*-medium-contrast`.
- Never hardcode colors; use Nuxt UI tokens mapped in `nuxt-ui-map.css`.
- Use `VT323` for body and `Press Start 2P` for headings.
- Use `retro-btn` class and Nuxt UI variants for buttons.
- Avoid inline CSS unless absolutely necessary; prefer Tailwind utilities and existing token mapping.

## Nuxt UI

- Use `UButton`, `UInput`, `UCard`, `UForm` with variants defined in `app.config.ts`.
- If new variants are required, extend them once in `app.config.ts` and preserve the retro look and sizes.
- Keep icon-only buttons square and centered using `.retro-btn.aspect-square`.

## State, Storage, And Search

- Persist local app entities with Dexie in `or3-db` using existing tables: `projects`, `threads`, `messages`, `kv`, `attachments`.
- Store small app prefs in `kv` using existing helpers.
- Build Orama indexes via dynamic imports, debounce at ~120ms, cap results at 100–200.
- Use the repo’s fallback substring search when Orama fails or is unavailable.

## OpenRouter Auth

- Never expose provider secrets in the client.
- Use the existing OpenRouter PKCE flow.
- Store the user key in `kv` under `openrouter_api_key` and dispatch `openrouter:connected`.
- Stream chat responses and route secret-bearing calls through server routes.
- Never log tokens.

## Hooks System

- Use `$hooks` for extension points.
- Prefer `useHookEffect(name, fn, { kind, priority })` for registration and cleanup.

## Theme Switching

- Use `nuxtApp.provide('theme', { set/toggle/get })`.
- Switch theme by class on `<html>` only.

## Performance

- Use dynamic imports for heavy providers and optional screens.
- Keep Orama indexes per collection and rebuild only when data length changes.
- Avoid re-render storms with debounced input and memoized id→entity maps.

## Accessibility

- Preserve role/aria on resizers and icon buttons.
- Preserve focus outlines and the retro focus ring.

## File Conventions

- Tailwind v4 requires one `@import "tailwindcss"` in `assets/css/main.css`.
- Keep `@source "../../../app.config.ts"` in Tailwind config for theme overrides.
- `nuxt.config.ts` must include `@nuxt/ui` and `@nuxt/fonts` with `Press Start 2P` and `VT323`.
- Wrap pages in `<UApp>` and set the initial theme class on `<html>` using `useHead`.

## Required Composables

- `useThreadSearch(threads)`: 120ms debounce, `limit: 200`, map hits via id→thread dict, fallback substring by `title`.
- `useModelSearch(models)`: 120ms debounce, `limit: 100`, index `id/slug/name/description/modalities`, fallback substring.
- `useOpenRouterAuth.startLogin()`: PKCE S256 when possible, store verifier/method/state in `sessionStorage`, redirect to callback, never log tokens.
- OpenRouter callback: store key to `kv('openrouter_api_key')`, dispatch `openrouter:connected`, clear session markers.
- Dexie: use `Or3DB` with existing stores and indexes; version bump only if schema changes.

## Retro UX Requirements

- Use 2px hard borders and 2px offset shadows with no blur.
- Focus outline must be `2px solid var(--md-primary)` with offset.
- Apply scanline/CRT effects only when explicitly opted in.
- Keep body text around 20px base size.

## Acceptance Checklist

- New UI respects `retro-btn` and Nuxt UI token mapping.
- Search follows existing debounced + fallback strategy.
- AI call paths comply with OpenRouter PKCE and KV storage.
- No hard-coded colors.
- Dexie usage stays in `or3-db` with versioned changes if needed.
- Theme toggling works across `.light`, `.dark`, and contrast modes.

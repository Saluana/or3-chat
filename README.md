# OR3.chat - Local-first OpenRouter Chat

A lightweight, plugin-friendly chat + documents playground that runs entirely in your browser, talks directly to **OpenRouter**, and stores your data locally with **Dexie**. No accounts. No backend. Just open the tab and go.

> **TL;DR**
>
> -   **No auth / No server.** You authenticate with OpenRouter and the API key is stored locally. &#x20;
> -   **Extensible hooks + UI actions.** Drop-in plugins can add buttons, intercept DB ops, or modify chat messages. &#x20;
> -   **OpenRouter streaming, images & “reasoning” tracks.** Handles incremental tokens, image parts, and reasoning streams. &#x20;
> -   **Local-first data model.** Threads, messages, files, and docs live in your browser (IndexedDB via Dexie).&#x20;
> -   **Tiptap editors.** Used for chat input and a full documents page; prompts & docs are saved as Tiptap JSON. &#x20;
> -   **Virtualized message list** for snappy long chats.&#x20;

---

## Features

### Chat that speaks OpenRouter natively

-   Uses a small **OpenRouter stream helper** designed for multi-part content (text, images) and “reasoning” events.&#x20;
-   Integrated **tail streaming state** for smooth token rendering in the UI. &#x20;
-   Default model is `openai/gpt-oss-120b` (you can switch).&#x20;

### Local-first persistence (Dexie)

-   IndexedDB schema includes **projects, threads, messages, posts (docs/prompts), file_meta, file_blobs, kv**.&#x20;
-   **Branching** metadata on threads supports reply-forks (`anchor_message_id`, `branch_mode`).&#x20;
-   **Document & Prompt** content saved as **Tiptap JSON** in `posts` (typed by `postType`).&#x20;

### Tiptap editors (chat + docs)

-   Chat input is a Tiptap editor (with Markdown extension).&#x20;
-   A full **Documents** page/shell + toolbar for editing titles and rich text. &#x20;

### Attachments & files

-   Files are content-addressed; **metadata + blobs** are stored locally and **referenced by hash** from messages. &#x20;
-   Per-message file count is **bounded** (default 6; configurable via a public env).&#x20;
-   Hash lists are **deduped and capped** on serialize/parse.&#x20;

### Fast, ergonomic UI

-   **Virtualized** chat list via `virtua/vue`.&#x20;
-   Uses **Nuxt UI v3** components; project is a standard Nuxt 3 app with Tailwind CSS.&#x20;

---

## How the “no auth” story works (accurately)

-   This app has **no user accounts or backend**.
-   You authenticate with **OpenRouter** directly (PKCE flow). The callback exchanges the code and **stores the resulting OpenRouter API key locally** (IndexedDB/`kv` + localStorage), which the client uses for requests. &#x20;
-   The auth URL and client ID are read from **runtime public config**.&#x20;

> ⚠️ **Security note:** because your **API key** is stored locally, anyone with access to your browser profile can use it. Treat it like other local “remembered” credentials.

---

## Modularity & Plugin System

This project exposes **two layers** of extensibility:

1. **Action/Filter Hooks** — a small, WordPress-style hook engine registered as a Nuxt plugin.

    - Add listeners with `on` and fire with `doAction`; transform data with `applyFilters`.
    - Hook names cover DB ops (messages, documents, files) and chat lifecycle stages. &#x20;

2. **UI Action Registries** — pluggable menus for the UI:

    - **Message Actions** (toolbar/buttons on messages),
    - **Document History Actions**,
    - **Project Tree Actions**.
      These are registered from client plugins and receive the active entity as context. &#x20;

### Example: add a Message Action (client plugin)

```ts
export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'demo:inspect',
        icon: 'i-lucide-eye',
        tooltip: 'Inspect message',
        showOn: 'both',
        order: 250,
        async handler({ message }) {
            console.log('message', message);
        },
    });
});
```

(See the built-in example plugins for message and document actions.) &#x20;

### Example: intercept DB writes with a filter

```ts
const hooks = useHooks();
hooks.on(
    'db.messages.files.validate:filter:hashes',
    async (hashes: string[]) => {
        // prune or reorder hashes before they’re saved
        return hashes.slice(0, 3);
    }
);
```

(Registered via the global hook engine; the message-files module calls this filter during updates.) &#x20;

---

## Data Model (quick map)

-   **threads**: title, timestamps, parent/branching, system_prompt ref.&#x20;
-   **messages**: per-thread sequence; file hashes serialized in `file_hashes`.&#x20;
-   **posts**: generic table for **documents** (`postType: 'doc'`) and **prompts** (`'prompt'`) with JSON content.&#x20;
-   **file_meta / file_blobs**: metadata + Blob by **content hash**.&#x20;
-   **kv**: simple key/value (e.g., OpenRouter key, model cache).&#x20;

---

## Streaming, images & “reasoning”

-   The **OpenRouter stream** utility reads server events and emits tokens, image parts, and optional “reasoning” content; the chat composable maintains **stream IDs, display text, reasoning text and error state** for the UI. &#x20;
-   The **TailStream** composable/components provide a small buffered renderer for incremental text. &#x20;

---

## Quickstart

```bash
pnpm install
pnpm dev
# build & preview
pnpm build && pnpm preview
# tests
pnpm test
```

(Exactly as defined in `package.json`.)&#x20;

---

## Configuration

Put these in **runtime public config** (e.g., `.env` or `nuxt.config`):

-   `public.openRouterClientId`
-   `public.openRouterRedirectUri`
-   `public.openRouterAuthUrl`

They’re read when constructing the OpenRouter auth URL and PKCE verifier. &#x20;

**Optional limits**

-   `NUXT_PUBLIC_MAX_MESSAGE_FILES` — cap per-message attachments (default **6**, min 1, max 12).&#x20;

---

## Developer Notes

-   Source lives in `/app` (Nuxt `srcDir`). Tailwind + theme CSS in `~/assets/css`.&#x20;
-   Chat input uses **Tiptap**; the **Documents** page ships with a toolbar and title editor shell. &#x20;
-   **Virtualized** message list uses `virtua/vue`.&#x20;
-   There’s a **documents store** and a **documents editor** component for CRUD and UI state.&#x20;

### Error Handling

Unified error API lives in `~/utils/errors.ts` (see `docs/error-handling.md`). Use `reportError(e,{ code:'ERR_INTERNAL', tags:{ domain:'feature', stage:'x' }, toast:true })` instead of raw `console.error`. Errors emit `error:raised`, `error:<domain>` (and legacy `ai.chat.error:action` for chat). Duplicate logs suppressed (300ms) and obvious secrets scrubbed.

---

## What this project is (and isn’t)

-   ✅ A **browser-only** Nuxt app that lets you chat with OpenRouter models, write docs, and extend behavior with plugins. (No server to deploy.) &#x20;
-   ✅ A **clean example** of local-first data with Dexie and pluggable UI/Hook surfaces. &#x20;
-   ❌ Not a multi-user SaaS; there’s **no app-level auth** or backend persistence beyond your browser storage.&#x20;

---

## License

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

---

### Appendix: Selected Files

-   `app/composables/useAi.ts` — chat orchestration, streaming state, OpenRouter calls.&#x20;
-   `app/utils/chat/openrouterStream.ts` — OpenRouter streaming helper.&#x20;
-   `app/db/client.ts` — Dexie schema/tables.&#x20;
-   `app/db/files*.ts` — file hashing, caps, and ref-counting. &#x20;
-   `app/plugins/hooks.client.ts` — registers the global hook engine.&#x20;
-   `app/plugins/examples/*` — message/doc/tree action examples.&#x20;
-   `app/pages/docs/*` — documents routes/shell.&#x20;

![OR3.chat logo](public/logos/logo-192.png)

# OR3.chat — Local-first OpenRouter Companion

OR3.chat is an open-source, privacy-first Nuxt application that turns your browser into a full OpenRouter command center. Authenticate with OpenRouter once, stream tokens in real time, manage chats and documents side-by-side, and keep everything—API keys, conversations, files—stored locally via Dexie.

![Chat workspace](public/screenshots/chat-screenshot.png)

## What You Get

-   **Fast chat workspace:** Real-time streaming, multimodal responses, reasoning tracks, and a TailStream renderer to keep long conversations smooth.
-   **Rich documents studio:** Tiptap-driven editors for prompts and docs, instant chat-to-doc conversion, slash commands, and plugin-defined toolbars.
-   **Extensible core:** WordPress-style action/filter hooks plus UI action registries so you can customize chat behavior, storage rules, or interface affordances without forking.
-   **Productive layout:** Virtualized lists, a multi-pane layout, Nuxt UI v4/Tailwind styling, and a dashboard for models, themes, images, and workspace backups.
-   **Local-first control:** Dexie-backed storage for threads, messages, posts, files, and key/value settings with optional encryption hooks to match your security model.

![Documents editor](public/screenshots/editor-screenshot.png)

## Install & Launch

```bash
git clone https://github.com/Saluana/or3-chat.git
cd or3-chat
bun install
bun run dev
```

Visit `http://localhost:3000`, connect your OpenRouter account via the built-in PKCE flow, and you’re ready to chat. Additional build, preview, and test commands live in `package.json`.

## OR3 Cloud Configuration

OR3 Cloud features are configured through `config.or3cloud.ts` at the project root. This file is the single source of truth for SSR auth, sync, storage, instance-level OpenRouter keys, branding, and limits.

## Base Configuration

Site branding, feature toggles, and client-side limits are configured in `config.or3.ts` at the project root. This allows you to customize the application appearance and capabilities without modifying the core code.

Key environment variables you can use inside `config.or3cloud.ts` and `config.or3.ts`:

-   `SSR_AUTH_ENABLED` (true/false)
-   `NUXT_PUBLIC_CONVEX_URL` / `VITE_CONVEX_URL`
-   `OPENROUTER_API_KEY`
-   `OR3_OPENROUTER_ALLOW_USER_OVERRIDE` (true/false)
-   `OR3_REQUESTS_PER_MINUTE`, `OR3_MAX_CONVERSATIONS`, `OR3_MAX_MESSAGES_PER_DAY`
-   `OR3_APP_NAME`, `OR3_LOGO_URL`, `OR3_DEFAULT_THEME`
-   `OR3_TERMS_URL`, `OR3_PRIVACY_URL`
-   `OR3_ALLOWED_ORIGINS`, `OR3_FORCE_HTTPS`
-   `OR3_WORKFLOWS_ENABLED`, `OR3_DOCUMENTS_ENABLED`, `OR3_DASHBOARD_ENABLED` (feature toggles)

Update the config files to match your deployment, then restart Nuxt for changes to take effect.

## Learn More

Deep dives, API references, and plugin guides live at [or3.chat/documentation](https://or3.chat/documentation). The docs cover advanced topics like hook surfaces, data schemas, and performance tuning.

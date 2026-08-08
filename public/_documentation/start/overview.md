## Overview

Or3.chat is an open source, fast, extendable, and privacy-focused AI chat interface that lets developers build customized chat experiences.

**Philosophy:** Or3 prioritizes being a lean, polished foundation rather than adding bloat. Users can extend it themselves, request features, or build plugins using tools like Cursor or Claude Code.

**Privacy First:** Or3 doesn't provide LLM access or tokens. In static mode, users connect their OpenRouter account via OAuth PKCE and pay for their own tokens. API keys are stored locally in IndexedDB. In cloud mode, an administrator can optionally configure a server-side OpenRouter key.

**Inspiration:** Or3 was inspired by t3.chat and WordPress, bringing modular plugin architecture, self-hosting, and community-driven extensibility to AI chat without vendor lock-in.

## Two Modes

Or3 runs in two modes:

-   **Static (default):** A pure browser app. No server, no sign-up, no account. Everything lives in IndexedDB in your browser.
-   **Cloud:** Adds user accounts, cross-device sync, file storage, and team workspaces by running OR3 on a server you control.

You start in static mode. When you need more, the managed `@or3/cloud` operator sets up the supported cloud profile. For a private local instance, run `npx @or3/cloud init --local`. For a public VPS, run `npx @or3/cloud init --public --domain chat.example.com`.

## Roadmap

-   Plugin marketplace
-   In-app theme editor (themes can already be built with the theme CLI tools)
-   Multi-provider AI integration
-   Remote OR3 Connect (currently withheld from the managed Cloud profile)

## Features

### Chat

-   Real-time streaming
-   Web search
-   Any OpenRouter model
-   Multimodal support (images, PDFs)
-   Branching and retry for any response
-   Background streaming in cloud mode (AI keeps generating when you leave the page)
-   Prompt catalog with defaults
-   Extensible input and message actions via plugins

### Documents

-   Tiptap editor for rich text and markdown
-   Convert any chat message into an editable document
-   Editor plugins support custom toolbar buttons and slash commands
-   Next-line autocomplete learns from your writing history

### Multipane

-   Up to 4 simultaneous windows (chats, documents, or custom pages)
-   Ideal for research, drafting, or debugging
-   Extendable—create plugins like synchronized multi-chat comparison

### Dashboard

Central hub for settings and mini apps:

-   **Settings**: Theme and AI preferences (system prompts, default models)
-   **Images**: Gallery for uploaded/generated images with browse, delete, copy, download
-   **Workspace Backup**: Export/import JSON backups to preserve projects across sessions or devices
-   **Custom Pages**: Developers can register plugin preference pages

### Plugins

OR3 has a WordPress-style plugin system. Plugins add dashboard tiles, message actions, sidebar sections and pages, AI tools, and custom pane apps without forking the project. The V1 plugin APIs remain supported, and the newer Plugin Runtime V2 uses digest-addressed `@or3/plugin-sdk` packages. See the [Plugin Quick Start](/documentation/start/plugin-quickstart).

### Themes

A full theme engine goes beyond colors. Themes can change fonts, borders, component styles, backgrounds, and even icons. See the [Theme Quick Start](/documentation/themes/quick-start).

### Important Notes

-   Static mode is client-side only; no server component is provided.
-   Cloud mode runs on a server you control and is managed with the `@or3/cloud` operator.
-   Or3 is not affiliated with OpenRouter but is designed to work seamlessly with their platform.
-   Users are responsible for their own OpenRouter accounts and associated costs.
-   Or3 emphasizes user privacy and security, allowing developers to implement their own measures as needed.

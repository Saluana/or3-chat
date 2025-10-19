## Overview

Or3.chat is an open source, fast, extendable, and privacy-focused AI chat interface that lets developers build customized chat experiences.

**Philosophy:** Or3 prioritizes being a lean, polished foundation rather than adding bloat. Users can extend it themselves, request features, or build plugins using tools like Cursor or Claude Code.

**Privacy First:** Or3 doesn't provide LLM access or tokens. Instead, users connect their OpenRouter account via OAuth PKCE and pay for their own tokens. API keys are stored locally in indexedDB—never on external servers. The plugin system allows optional encryption, giving developers full control over security according to their threat model.

**Inspiration:** Or3 was inspired by t3.chat and WordPress, bringing modular plugin architecture, self-hosting, and community-driven extensibility to AI chat without vendor lock-in.

## Roadmap

-   Plugin marketplace
-   Theme editor
-   Multi-provider AI integration
-   Support SSR for improved performance, SEO and security

## Features

### Chat

-   Real-time streaming
-   Web search
-   Any OpenRouter model
-   Multimodal support (images, PDFs)
-   Prompt catalog with defaults
-   Extensible input and message actions via plugins

### Documents

-   Tiptap editor for rich text and markdown
-   Convert any chat message into an editable document
-   Editor plugins support custom toolbar buttons, slash commands, and collaborative editing
-   Next-line autocomplete learns from your writing history

### Multipane

-   Up to 3 simultaneous windows (chats, documents, or custom pages)
-   Ideal for research, drafting, or debugging
-   Extendable—create plugins like synchronized multi-chat comparison

### Dashboard

Central hub for settings and mini apps:

-   **Settings**: Theme and AI preferences (system prompts, default models)
-   **Images**: Gallery for uploaded/generated images with browse, delete, copy, download
-   **Workspace Backup**: Export/import JSON backups via indexedDB to preserve projects across sessions or devices
-   **Custom Pages**: Developers can register plugin preference pages

### Important Notes

-   Or3 is client side only; no server component is provided.
-   Or3 is not affiliated with OpenRouter but is designed to work seamlessly with their platform.
-   Users are responsible for their own OpenRouter accounts and associated costs.
-   Or3 emphasizes user privacy and security, allowing developers to implement their own measures as needed.

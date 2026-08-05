<p align="center">
  <img src="public/logos/logo-192.png" alt="OR3.chat logo" width="100" />
</p>

<h1 align="center">OR3.chat</h1>

<p align="center">
  <strong>Open-source, local-first AI chat that you actually own.</strong><br/>
  Use any model on OpenRouter. Keep your data on your machine. Deploy to the cloud when you're ready.
</p>

<p align="center">
  <a href="https://or3.chat">Website</a> · <a href="https://or3.chat/documentation">Docs</a> · <a href="https://github.com/Saluana/or3-chat/issues">Issues</a> · <a href="#-quick-start">Quick Start</a>
</p>

---

## Table of Contents

- [What is OR3?](#-what-is-or3)
- [Core Features](#-core-features)
- [Quick Start](#-quick-start)
- [Static vs Cloud — Which Do I Pick?](#%EF%B8%8F-static-vs-cloud--which-do-i-pick)
- [Static Mode (Default)](#-static-mode-default)
- [Cloud Mode (Install Wizard)](#%EF%B8%8F-cloud-mode-install-wizard)
- [Plugins](#-plugins)
- [Themes](#-themes)
- [Configuration Reference](#%EF%B8%8F-configuration-reference)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🤔 What is OR3?

OR3.chat is a free, open-source AI chat app built with [Nuxt](https://nuxt.com). It connects to [OpenRouter](https://openrouter.ai) so you can talk to hundreds of AI models — GPT-4o, Claude, Gemini, Llama, Mistral, and more — all from one place.

**The big idea:** you bring your own API key, and your data stays on your device by default. No middleman. No subscriptions. No tracking. Just you and the models you choose.

OR3 runs in two modes:

1. **Static** — a pure browser app. Zero servers, zero sign-ups. Everything lives in your browser's IndexedDB.
2. **Cloud** — add authentication, cross-device sync, file storage, and team workspaces by running OR3 on a server.

You start with static. When you need more, the built-in install wizard sets up cloud for you.

![Chat workspace](public/screenshots/chat-screenshot.png)

---

## ✨ Core Features

### Chat

- **Real-time streaming** with token-by-token display
- **Multi-model access** via OpenRouter (hundreds of models)
- **Reasoning tracks** — see the model's chain-of-thought when supported
- **File attachments** — send images and documents alongside your messages
- **Branching & retry** — fork conversations or regenerate any response
- **Background streaming** — AI keeps generating even if you navigate away (cloud mode)

### Documents

- **Rich text editor** powered by TipTap with slash commands
- **System prompts** — write, save, and reuse custom instructions
- **Chat-to-doc** — turn any conversation into an editable document
- **@mentions** — reference documents or past chats inline

### Workspace

- **Multi-pane layout** — open chats and docs side-by-side (up to 4 panes)
- **Projects** — organize threads and documents into groups
- **Dashboard** — manage models, themes, backups, images, and settings
- **Full-text search** — find anything across threads, docs, and projects instantly

### Privacy & Control

- **Local-first storage** — Dexie (IndexedDB) keeps everything on your machine
- **No telemetry** — OR3 does not phone home
- **Your API key** — connect via OpenRouter OAuth (PKCE) or paste a key. It never leaves your browser in static mode
- **Open source** — GPL-3.0 licensed. Read every line, fork it, make it yours

![Documents editor](public/screenshots/editor-screenshot.png)

---

## 🚀 Quick Start

Create an editable, version-matched OR3 Chat project with npm or Bun:

```bash
npm create or3-chat@latest
```

```bash
bun create or3-chat@latest
```

The initializer asks no more than three questions: where to create the project,
whether it is personal-local or self-hosted, and whether to use the browser or
terminal wizard. Press Enter through the defaults for a running local instance.

Node.js 24 or newer is required. Bun is optional. Docker is only required for
the self-hosted path.

### Self-host with Docker

Choose **Self-host with Docker** in the initializer. The recommended stack uses
Basic Auth, SQLite, and filesystem storage, so it needs no external database,
authentication, or storage account.

```bash
npm run docker:logs
npm run docker:down
```

Private mode exposes OR3 only at `http://127.0.0.1:3000`. To serve a public
domain, pass it during creation or choose public mode in the wizard:

```bash
npm create or3-chat@latest my-chat -- --mode self-hosted --domain chat.example.com
```

The public path adds Caddy on ports 80 and 443. Point the domain's DNS at the
server before deploying; Caddy handles HTTPS automatically.

### SSH and headless servers

The terminal wizard is selected automatically under SSH. To explicitly use the
browser wizard, run `npm run setup -- --ui`; OR3 prints the exact loopback URL
and an SSH tunnel command. No setup service is exposed publicly.

### Backups and recovery

Docker data lives in a project-scoped named volume (usually
`<project-folder>_or3-data`). Back it up before an upgrade. Setup is resumable:
if an install or deployment stops, keep the generated directory and run
`npm run setup` or `bun run setup`.

For port conflicts, missing Docker, invalid domains, provider checks, and other
diagnostics, run:

```bash
npm run doctor
```

See [Installation and operations](docs/installation.md) for local, Docker,
public-server, SSH, backup, and troubleshooting details. Maintainers can follow
[Publish and deploy to a VPS](docs/publish-and-vps.md) for the first npm release
and a production server walkthrough.

---

## ⚖️ Static vs Cloud — Which Do I Pick?

OR3 ships as a **static app** by default. You can optionally turn on **cloud mode** for multi-user and multi-device features. Here's how they compare:

| Feature | Static | Cloud |
|---|:---:|:---:|
| Chat with any OpenRouter model | ✅ | ✅ |
| Documents & system prompts | ✅ | ✅ |
| Multi-pane workspace | ✅ | ✅ |
| Plugins & themes | ✅ | ✅ |
| Full-text search | ✅ | ✅ |
| Works offline | ✅ | ✅ |
| No server required | ✅ | — |
| User accounts & login | — | ✅ |
| Cross-device sync | — | ✅ |
| Cloud file storage | — | ✅ |
| Team workspaces | — | ✅ |
| Server-side API key (users don't need their own) | — | ✅ |
| Background streaming | — | ✅ |
| Admin panel | — | ✅ |
| Rate limiting & usage controls | — | ✅ |

**Start static.** If you later need accounts, sync, or shared workspaces, run the install wizard to add cloud features — your existing data stays intact.

---

## 📦 Static Mode (Default)

Static mode is the simplest way to use OR3. It generates a plain HTML/JS/CSS bundle you can host anywhere — GitHub Pages, Netlify, Vercel, Cloudflare Pages, or just open the files locally.

### Build for Production

```bash
npm run generate:static
```

This outputs a fully static site to `.output/public/`. Upload that folder to any static host.

### Preview the Static Build Locally

```bash
npm run preview:static
```

Opens a local server at **http://localhost:4173**.

### How Static Mode Works

- All data is stored in your browser using **IndexedDB** (via Dexie)
- Your OpenRouter API key is stored locally — never sent to a server
- There is no backend, no database, and no authentication
- You connect to OpenRouter using **OAuth PKCE** (secure browser-only flow) or by pasting an API key
- Conversations, documents, prompts, files, and settings all live in your browser

> **Perfect for:** personal use, trying out models, privacy-focused users, or hosting on free static platforms.

---

## ☁️ Cloud Mode (Install Wizard)

Cloud mode adds a server layer on top of OR3. It enables user accounts, database sync, file storage, and admin controls. The built-in **install wizard** walks you through the entire setup.

### Run the Wizard

```bash
npm run setup
```

By default, the wizard opens in your browser with a step-by-step UI.
Use `--cli` to force the terminal-based flow.

**Fast path** — zero questions, instantly ready:

```bash
npm run setup -- --fast --mode self-hosted --target dev --admin-email admin@example.com
```

Fast self-hosted setup writes generated credentials to a mode-`0600`
`.or3-initial-credentials` file instead of printing passwords. Move the values
to a password manager, then delete the file.

The wizard will ask you to pick providers for each layer:

| Layer | What It Does | Available Providers |
|---|---|---|
| **Auth** | User login and sessions | Clerk, Basic Auth (email/password) |
| **Sync** | Cross-device data sync | Convex, SQLite |
| **Storage** | Cloud file uploads | Convex, S3-compatible, Local filesystem |

### What the Wizard Does

1. **Asks questions** — which providers you want, your API keys, and your preferences
2. **Validates everything** — checks that your keys and URLs are correct
3. **Writes your `.env` file** — safely updates environment variables without overwriting comments or unrelated keys
4. **Generates provider config** — creates `or3.providers.generated.ts` so Nuxt loads the right modules
5. **Optionally deploys** — runs provider-specific setup commands (e.g., Convex schema push)

### After the Wizard

Start the dev server:

```bash
npm run dev
```

Or build for production:

```bash
npm run build
```

### Health Check

To verify everything is working correctly:

```bash
npm run doctor
```

Checks that provider packages are installed, database paths are writable, the port is free, and the config is valid. Runs in seconds with ✅/⚠️/❌ output per check.

### Example: Minimal Self-Hosted Setup

The fastest path to a self-hosted cloud instance with **zero external services**:

| Layer | Provider | What You Need |
|---|---|---|
| Auth | **Basic Auth** | Nothing — built in. Users sign up with email/password |
| Sync | **SQLite** | Nothing — uses a local SQLite file |
| Storage | **Filesystem** | Nothing — saves uploads to a local folder |

Just run the wizard, pick the self-hosted options, and go.

### Example: Managed Cloud Setup

For a fully managed stack with real-time sync:

| Layer | Provider | What You Need |
|---|---|---|
| Auth | **Clerk** | A free Clerk account ([clerk.com](https://clerk.com)) |
| Sync | **Convex** | A free Convex account ([convex.dev](https://convex.dev)) |
| Storage | **S3** | Any S3-compatible bucket (AWS, Cloudflare R2, MinIO, etc.) |

> **Tip:** You can mix and match. Use Clerk for auth with SQLite for sync and local filesystem for storage — whatever fits your needs.

---

## 🔌 Plugins

OR3 has a WordPress-style plugin system. You can add features without forking the project or touching core code.

### What Plugins Can Do

| Plugin Type | What It Adds | Example |
|---|---|---|
| **Dashboard tile** | Custom page in the dashboard | Settings panel, mini-app, tool |
| **Message action** | Button on chat messages | Copy, save-as-doc, translate |
| **Sidebar section** | Widget in the sidebar | Quick links, stats, status |
| **Sidebar page** | Full page in the sidebar | Custom history view, search |
| **Header action** | Button in the header bar | Toggle layout, quick action |
| **Composer action** | Button below the chat input | Insert template, attach file |
| **AI tool** | Function the AI model can call | Web search, calculator, API lookup |
| **Pane app** | Custom content in a workspace pane | Game, preview, canvas |
| **Editor extension** | TipTap node, mark, or toolbar button | Syntax highlighting, emoji picker |

### Creating a Plugin

Plugins are Nuxt client plugins. Create a file in `app/plugins/` with a `.client.ts` extension:

```typescript
// app/plugins/my-plugin.client.ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'my-plugin:hello',
        icon: 'pixelarticons:star',
        label: 'Hello World',
        description: 'My first OR3 plugin',
        order: 250,
        handler() {
            useToast().add({ title: 'Hello from my plugin!' });
        },
    });
});
```

That's it — restart the dev server and your tile appears on the dashboard.

### Hooks System

Under the hood, plugins use an **action/filter hook system** (similar to WordPress). Hooks let you:

- **Actions** — run side effects when something happens (message sent, thread created, file uploaded)
- **Filters** — transform data as it flows through the system (modify AI request before sending, change how messages render)

```typescript
// Listen for new messages
hooks.addAction('db:messages:after_create', ({ entity }) => {
    console.log('New message:', entity.content);
});

// Transform AI request before sending
hooks.addFilter('ai:request:filter:body', (body) => {
    body.temperature = 0.7;
    return body;
});
```

For full examples and API details, see the [Plugin Quick Start Guide](public/_documentation/start/plugin-quickstart.md).

---

## 🎨 Themes

OR3 has a full theme engine that goes beyond colors. Themes can change fonts, borders, component styles, backgrounds, and even icons.

### Built-in Themes

OR3 ships with several themes including a clean modern look and a retro pixel-art style. Switch themes from the dashboard at any time.

### Creating a Theme

Themes live in `app/theme/<name>/` and use `defineTheme()`:

```typescript
// app/theme/my-theme/theme.ts
import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
    name: 'my-theme',
    displayName: 'My Theme',
    description: 'A custom look for OR3',
    colors: {
        primary: '#086DB8',
        surface: '#ffffff',
        onSurface: '#022344',
        dark: {
            primary: '#2C638B',
            surface: '#0a0a0a',
            onSurface: '#e2e2e6',
        },
    },
    fonts: {
        sans: '"Inter", system-ui, sans-serif',
        heading: '"Inter", system-ui, sans-serif',
    },
});
```

### Theme CLI Tools

```bash
# Create a new theme from a template
bun run theme:create

# Validate your theme has no errors
bun run theme:validate

# Switch the active theme
bun run theme:switch
```

### What Themes Can Customize

- **Colors** — primary, secondary, surface, and dark mode variants
- **Fonts** — sans, heading, mono, and base size
- **Borders** — radius and width tokens
- **Component overrides** — change default props for any Nuxt UI component based on context (e.g., "buttons inside the chat composer should be ghost style")
- **CSS selectors** — target specific DOM elements like the TipTap editor or code blocks
- **Backgrounds** — layered background effects (gradients, patterns, images)
- **Icons** — swap the icon set used throughout the app

For the full theme API, see the [Theme Documentation](public/_documentation/themes/quick-start.md).

---

## ⚙️ Configuration Reference

OR3 uses two config files at the project root:

### `config.or3.ts` — Base Configuration

Controls branding, features, limits, and UI defaults. Works in both static and cloud mode.

| Category | Examples |
|---|---|
| **Branding** | Site name, logo, favicon, default theme |
| **Features** | Toggle workflows, documents, dashboard, backups, mentions |
| **Limits** | Max file size, max files per message, storage quota |
| **UI** | Default pane count, max panes, sidebar collapsed |
| **Legal** | Terms of service URL, privacy policy URL |

### `config.or3cloud.ts` — Cloud Configuration

Controls auth, sync, storage, rate limiting, admin, and background streaming. Only relevant when running in cloud mode.

| Category | Examples |
|---|---|
| **Auth** | Provider, guest access, registration mode |
| **Sync** | Provider, Convex URL |
| **Storage** | Provider, allowed MIME types, workspace quota |
| **LLM** | Instance OpenRouter key, allow user override |
| **Limits** | Requests per minute, max conversations, max messages/day |
| **Security** | Allowed origins, force HTTPS, proxy settings |
| **Admin** | Admin credentials, extension upload limits |
| **Background Streaming** | Enable/disable, max concurrent jobs, timeout |

All values are driven by environment variables. The install wizard writes these for you, or you can set them manually in `.env`.

---

## 📖 Documentation

Full documentation lives inside the project at [`public/_documentation/`](public/_documentation/)

### What's Covered

| Section | Topics |
|---|---|
| **Getting Started** | What is OR3, plugin quickstart, dev setup, pane app tutorial |
| **Composables** | 30+ documented composables — chat, search, sidebar, editor, multi-pane, and more |
| **Hooks** | Hook catalog, engine internals, typed hooks, adding editor extensions |
| **Database** | Table schemas, CRUD helpers, file storage, KV store, transactions |
| **Auth** | Session context, token broker, admin stores, auth UI adapters |
| **Utils** | Tool registry, server tools, streaming, HLC clock, config resolution |
| **Types** | Chat types, hook payload types, cloud config types |
| **Themes** | Architecture, quick start, API reference, CSS selectors, best practices |
| **Cloud** | Install wizard, provider system, sync protocol, storage, background jobs |

The documentation map is defined in [`public/_documentation/docmap.json`](public/_documentation/docmap.json).

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Run tests (`bun run test`)
5. Run type-check (`bun run type-check`)
6. Open a pull request

Please keep changes minimal, type-safe, and consistent with the existing code style.

---

## 📄 License

OR3.chat is licensed under [GPL-3.0](LICENSE).

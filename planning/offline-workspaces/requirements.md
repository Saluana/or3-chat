# Requirements

## Introduction

A returning user can open the installed OR3 app in airplane mode, find their work, and keep editing after a restart. Offline use happens automatically.

## Context

The deployed service worker omitted the plugin module shown in the phone screenshot. A fresh mobile Chromium profile also missed four startup chunks. OR3 already stores workspace data in Dexie and records local changes for sync. Its current Cloud startup path selects the workspace from an online session check.

## Assumptions

- Enable offline reopening by default for a previously signed-in browser. Let site owners turn it off with one environment setting.
- First-time setup needs a successful online visit and a completed app download. Offline access covers data stored on that device.
- A disconnected device learns about site policy and membership changes when it reconnects.

## Out of Scope

Cloud inference, remote-only file downloads, initial sign-in, and remote administration require connectivity. This release uses configuration for site-owner control and adds zero interface copy.

## Requirements

### R1 — Installed app opens offline

**User story** — I can close OR3 and open it again in airplane mode.

- R1.AC1 — WHEN an installed app starts offline THEN the app SHALL load its shell and bundled local features, including features previously unopened on this device.
- R1.AC2 — IF an update download stops halfway THEN an existing complete installation SHALL still launch.

### R2 — Return to the correct workspace

**User story** — I can resume work I previously opened on this device.

- R2.AC1 — WHEN a permitted returning user opens OR3 offline THEN it SHALL select the last verified account and workspace and respect its last verified editing rights.
- R2.AC2 — WHEN the user signs out, changes accounts, or the server denies access THEN OR3 SHALL end offline access for the previous identity across tabs.
- R2.AC3 — IF a browser has never signed in, or its saved scope is missing or invalid, THEN private Cloud workspaces SHALL stay locked.

### R3 — Local work survives

**User story** — I can work offline and find the same edits on my other device after reconnecting.

- R3.AC1 — WHILE offline, an authorized editor SHALL be able to browse saved chats, search, edit drafts and documents, organize projects, and work with locally stored files.
- R3.AC2 — WHEN the app or device restarts THEN durable offline edits SHALL reopen in their originating workspace.
- R3.AC3 — WHEN connectivity returns THEN sync SHALL validate the current account and workspace before uploading and SHALL apply each edit once. IF sign-in is needed THEN pending edits SHALL survive reauthentication.

### R4 — Site owner control

**User story** — I can choose whether returning users may reopen private work offline on my site.

- R4.AC1 — WHEN the owner sets `OR3_OFFLINE_WORKSPACE_ACCESS=false` and the device next verifies policy online THEN subsequent offline launches SHALL follow the existing sign-in gate. Local-only installations SHALL continue working offline.
- R4.AC2 — WHEN automatic offline access is available THEN it SHALL require zero added labels, banners, prompts, or user settings.

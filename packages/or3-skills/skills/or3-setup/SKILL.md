---
name: or3-setup
description: Configure, validate, repair, or deploy a supported OR3 Chat installation. Use when a user asks to install OR3, choose auth/sync/storage providers, connect a remote computer, change instance configuration, or diagnose setup.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for supported setup and validation commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 setup

## Purpose

Use the existing OR3 setup and validation surfaces to configure an installation
without inventing environment variables, destroying unknown configuration, or
exposing secrets.

## When to use

Use for installation, provider selection, setup repair, local-to-SSR changes,
deployment preparation, or OR3 Connect configuration.

Do not use for a new product feature, an appearance-only request, or a provider
implementation. Route those requests using the
[extension decision tree](../../shared/extension-decision-tree.md).

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md).
2. Run `bun run context --cwd <checkout>` from this package when context is
   uncertain; inspect the target configuration and current provider modules.
3. Read the docmap pages for the Cloud wizard, base configuration, selected
   providers, and deployment only as needed.
4. Preserve existing unrelated changes. Do not print `.env` values or secrets.

## Workflow

1. Identify the requested mode: local-only, recommended self-hosted, legacy
   Clerk/Convex, custom, or remote-computer setup.
2. Inspect existing configuration before proposing writes. State files,
   providers, data paths, and operations that could replace data or deploy.
3. Prefer the wizard: `bun run or3-cloud:init`. Use its `--dry-run`,
   `--instance-dir`, and `--env-file` options when they clarify scope. Let it
   make timestamped backups unless the user explicitly declines.
4. Use existing configuration APIs or the wizard for changes. Preserve unknown
   environment lines and keep provider-specific server credentials server-only.
5. Validate with the checkout's `bun run or3-cloud:validate` and, when
   appropriate, `bun run doctor`. Run start/build only when requested or needed
   to verify the changed mode.
6. If validation fails, stop before deploy or promotion. Report the failing
   field and safe recovery path.

## Safety rules

- Never hand-author a replacement `.env` when the wizard supports a
  non-destructive merge.
- Treat database paths, storage roots, deployment commands, and provider
  switches as potentially destructive. Back up and obtain explicit approval
  before replacing them.
- Never write a secret into source, generated examples, logs, or a report.
- Keep static builds static: server-only providers and credentials must not be
  imported into client paths.

## Validation

Record the exact wizard/config command, validation result, selected provider
combination, and any health/build command actually run. A completed dry run is
not an installed configuration.

## Completion output

Follow the [completion contract](../../shared/completion-contract.md). Include
the product mode, provider names, redacted configuration summary, changed or
backed-up files, start command, and restoration path.

## References to load

- [Quality gates](../../shared/quality-gates.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
- `public/_documentation/cloud/or3-cloud-wizard.md`
- `public/_documentation/cloud/or3-config.md`
- Provider page(s) selected from `public/_documentation/docmap.json`

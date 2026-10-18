# Welcome to OR3

OR3 is an extensible AI chat workspace with conversations, documents, projects, and multiple panes. Your browser keeps a local database so saved work remains available without a network connection. Generating an AI response still needs a model provider connection.

## Choose where to start

| Your goal | Start here |
| --- | --- |
| Use an existing OR3 instance | [Send your first message](/documentation/start/first-chat) |
| Run your own Cloud instance | [Set up Cloud](/documentation/cloud/setup) |
| Work on the source code | [Development setup](/documentation/start/development-setup) |
| Install an extension | [Install and manage plugins](/documentation/plugins/install-and-manage) |
| Build a portable plugin | [Build your first plugin](/documentation/plugins/first-plugin) |
| Change the appearance | [Customize your theme](/documentation/themes/customize) |

Local-first use does not require an OR3 account. A Cloud instance can require sign-in and add workspace synchronization, remote file storage, and server-side AI requests. Its available features depend on the operator's configuration. OpenRouter connection and OR3 Cloud sign-in are separate; see [Connect OpenRouter](/documentation/auth/connect).

In the Blank theme, a new chat pane offers **Start a chat**, **Start a project**, and **Create a document** above the composer. Start a chat focuses your existing draft. Creation uses the normal naming forms; a new document opens in its own tab so your unsent chat remains available. Theme authors can customize or disable this surface through [empty chat appearance](/documentation/themes/api-reference#empty-chat-panes).

## Find and organize your work

Use projects to group chats, documents for editable notes, and workspace panes to keep several items open. The [command palette](/documentation/start/command-palette) finds saved work and runs commands with Cmd+K or Ctrl+K.

Open tabs are restored separately for each workspace and layout profile. If you switch workspaces during restoration, the earlier lookup cannot replace the current panes or show an outdated failure notice.

Tab title caches also reset when the workspace changes. Tabs with the same identifiers in different workspaces use their own saved titles while fresh metadata loads; late lookups from an earlier workspace cannot replace them.

When several unsent chats are open, their tabs are numbered in creation order
so you can distinguish drafts. A restored app keeps its app identity while its
plugin loads; an unavailable app shows an explanation instead of a chat composer.

Dashboard **Back** returns one level at a time. Its breadcrumb also opens the
parent section or Dashboard directly. In **Files**, use **Trash** to view deleted
items and **Back to files** to return. Restore is available on each deleted item;
creation and upload controls belong to the active Files view.

## Keep a backup

Open **Workspace Backup** from the dashboard to export the active workspace as a JSONL backup. Keep the downloaded file somewhere safe. Import validates a backup and defaults to **Append & merge** with conflict overwrite off, preserving existing records. Choose **Replace workspace** explicitly to remove the active workspace's existing data. Export before restoring or resetting browser storage.

Local data belongs to this browser profile and site origin. Private browsing, clearing site data, and changing the host or port can make the original workspace unavailable. Cloud sync and backups serve different purposes: sync shares changes, while a saved backup gives you a recovery point.

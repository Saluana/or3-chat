# UI polish pass — before/after screenshots (2026-10-14)

Each image pairs the pre-change code (`6821c12`, left) with branch
`fix/ui-polish-audit` (right), captured with identical Playwright steps on
fresh browser profiles against local (`SSR_AUTH_ENABLED=false`) dev servers.
Assistant replies use an intercepted, deterministic OpenRouter SSE stream.

| File | Change shown |
|---|---|
| `01-welcome.png` | Local mode with a server OpenRouter key shows the key prompt instead of failing every send with "Sign in" |
| `02-reply-top.png` | Tighter message/reply gap, no reasoning char count, no gap under collapsed reasoning |
| `03-reply-markdown.png` | No literal backticks on inline code, visible quote rule, no empty last code line |
| `04-sidebar.png` | Group header doesn't wrap; project and chat names use the full row |
| `05-delete.png` | Delete confirmation names the item |
| `06-add-to-project.png` | Regular-font mode switch; actions menu closes behind the dialog |
| `07-mobile-attachments.png` | Small corner remove badge, tiles fit, spelled-out word count |
| `08-mobile-more.png` | OpenRouter row explains itself; no dead Account row in local mode |
| `09-mobile-files.png` | Files header actions in two tidy rows |

Note for `04-sidebar.png`: on the old code the project name typed into the
New Project dialog went to its Close button (initial-focus bug fixed in this
branch), so the "before" capture clicks into the field explicitly.

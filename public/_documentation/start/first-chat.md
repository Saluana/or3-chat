# Send your first message

This guide starts from an OR3 instance already open in your browser. To run one yourself, follow [Cloud setup](/documentation/cloud/setup) or [source development setup](/documentation/start/development-setup).

## 1. Connect a model provider

For local-first use, the empty chat welcome card offers **Connect with OpenRouter** and a field for pasting an API key. Complete one of those options. The sidebar also has a **Connect** control.

On a Cloud instance, sign in if requested. The operator may supply an instance key or allow your own OpenRouter key. When an instance key is provided, a personal key may be unnecessary or disallowed. See [OpenRouter connection and troubleshooting](/documentation/auth/connect).

## 2. Choose a model and send a message

Open a chat, select a model from the chat's model selector, and type a short prompt such as “Give me three ideas for a weekend project.” Send it using the chat input's send control. The assistant response appears incrementally while it streams.

Choose a model with the capabilities your request needs. For an image or file, use the attachment control and select a compatible model. A text-only model cannot be assumed to understand an image. If an attachment cannot be prepared, remove it or reattach the original file and try again.

## 3. Check that your work is saved

After the response completes, reload the page and reopen the chat from the sidebar or [command palette](/documentation/start/command-palette). Your conversation should still be there in the same browser profile and workspace.

Use the stop control to cancel an active response. Server background behavior depends on the instance's configuration; do not assume that closing the browser always stops generation.

## If something goes wrong

| Symptom | What to check |
| --- | --- |
| A key is requested | Connect OpenRouter, paste a key, or ask the Cloud operator whether instance credentials are configured. |
| Sign-in is requested | Sign in to OR3 Cloud before connecting or sending. |
| A model request fails | Read the error, check connectivity and provider account access, and try a model available to your account. |
| An attachment fails | Reattach it and check that the selected model supports its input type. |
| Saved work seems missing | Check the browser profile, site address, and active workspace before changing storage. |

Before clearing browser data, export the active workspace from **Workspace Backup**. Clearing site data can remove chats, documents, files, and your locally stored key.

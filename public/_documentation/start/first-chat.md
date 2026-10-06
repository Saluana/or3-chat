# Send your first message

This guide starts from an OR3 instance already open in your browser. To run one yourself, follow [Cloud setup](/documentation/cloud/setup) or [source development setup](/documentation/start/development-setup).

## 1. Connect a model provider

OpenRouter provides access to the AI models you chat with. Model usage may cost money, depending on the model; creating an API key does not make paid models free. Check the model's pricing in OpenRouter before chatting.

For local-first use, choose **Connect with OpenRouter** on the empty chat welcome card, or expand **Use an existing API key** to paste a key you already have. The sidebar also has a **Connect** control.

On a Cloud instance, sign in if requested. The operator may supply an instance key or allow your own OpenRouter key. When an instance key is provided, a personal key may be unnecessary or disallowed. See [OpenRouter connection and troubleshooting](/documentation/auth/connect).

## 2. Choose a model and send a message

Open a chat, open **Settings → Current model** to browse the catalog, and type a short prompt such as “Give me three ideas for a weekend project.” Favorite models also appear in the model selector. Send it using the chat input's send control. The assistant response appears incrementally while it streams.

Choose a model with the capabilities your request needs. For an image or file, use the attachment control and select a compatible model. A text-only model cannot be assumed to understand an image. If an attachment cannot be prepared, remove it or reattach the original file and try again.

## 3. Check that your work is saved

After the response completes, reload the page and reopen the chat from the sidebar or [command palette](/documentation/start/command-palette). Your conversation should still be there in the same browser profile and workspace.

Use the stop control to cancel an active response. Server background behavior depends on the instance's configuration; do not assume that closing the browser always stops generation.

A failed response keeps its error in the conversation after reload. Use **Retry message** to retry the saved turn, or continue with a new message. A stopped response keeps any accepted partial text.

## If something goes wrong

| Symptom | What to check |
| --- | --- |
| A key is requested | Connect OpenRouter, paste a key, or ask the Cloud operator whether instance credentials are configured. |
| Sign-in is requested | Sign in to OR3 Cloud before connecting or sending. |
| A model request fails | Read the error, check connectivity and provider account access, and try a model available to your account. |
| An attachment fails | Reattach it and check that the selected model supports its input type. |
| Saved work seems missing | Check the browser profile, site address, and active workspace before changing storage. |

Before clearing browser data, export the active workspace from **Workspace Backup**. Clearing site data can remove chats, documents, files, and your locally stored key.

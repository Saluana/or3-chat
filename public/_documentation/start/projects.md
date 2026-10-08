# Work in a project

Open **Projects** in the sidebar to search, pin, create, or return to a workspace. Project Home has recent activity and links to Knowledge, Memory, and Settings. Each chat has one owning project; opening another project does not change a turn already in progress.

The Home sidebar has a **Projects** navigation row below Chats and Documents. It opens the full project list. Home shows up to five recent project shortcuts; **Show more** opens the full list when there are additional projects. Projects is a Home destination and does not add an icon to the collapsed rail or mobile bottom navigation. Expanded Home shortcuts load their children on demand, and the full Projects list renders only the rows near the visible area. Explicit workspace-profile navigation restrictions still apply.

Project Home brings together the brief, links to **Knowledge** and **Memory**, and a time-grouped activity list mixing project chats and documents. The list includes OR3 documents added through Knowledge and uses the same rows, conversation families, search, and pagination as the normal sidebar. The single top back button returns to the project from a section, then to **Home** when you entered through a Home shortcut or **Projects** when you entered through the list. The settings icon opens **Settings**, including controls to move chats into the project or exclude them from memory. Use the sidebar search to filter projects. **New project** opens the shared creation modal with a title and optional description; creating from the Projects page opens the new project's home in the sidebar. Browsing a project preserves the active pane and workspace tabs; opening or creating a chat uses the chat pane as usual.

The brief appears beneath the project title as a compact two-line preview. Its pencil expands an inline editor on Project Home, prefilled with the brief or project description. **Save brief** saves and collapses the editor; **Cancel** or Escape discards the draft. **New chat** and **New document** sit together below the title. New document creates an untitled OR3 document in this project and opens its editor. The action is hidden when documents are disabled.

## Knowledge

Use **Add source** to upload a PDF, DOCX, UTF-8 text/Markdown/CSV, or image, write a note, or add an existing saved file or OR3 document. Only the selected add form opens. Notes and saved answers can be saved as OR3 documents and added here. Files uses the same catalog and original bytes as the rest of OR3. Source rows show status, context mode, and current preview; expand **History and actions** for revisions, downloads, retry, replacement, or removal.

Processing produces a plain-text preview with page or paragraph locations. **Ready** means the supported extraction finished; **Partially readable** means only part could be read; **Failed** offers retry. PDF extraction does not perform OCR. Uploads for extraction are limited to 20 MiB, PDFs to 200 pages, extracted text to 2 MiB, DOCX archive expansion to 40 MiB, and processing to 30 seconds. Images remain image inputs for vision models.

After submission, knowledge upload and extraction retry continue when you leave
the sidebar or open another project in the same workspace. Their result stays
in the original project. Changing workspaces or losing write permission still
prevents completion from writing through the old scope. Reloading the app can
interrupt extraction; abandoned Processing revisions show a retryable failure
after 45 seconds. Retry starts a fresh attempt and preserves revision history.
Image-only DOCX files fail with a readable-text explanation; DOCX files that
contain text and embedded media are Partially readable because extraction does
not include those images.

Choose a mode independently for each project:

- **Use when relevant:** OR3 selects a bounded excerpt when the question matches. Up to five knowledge excerpts are selected per turn.
- **Always include:** the complete readable source must fit. Missing bytes, partial extraction, unsupported vision, or insufficient model capacity block sending visibly.
- **Do not use:** the source is excluded from automatic context and project tool reads.

Automatic search has a fixed work budget. In larger libraries it prioritizes
matching titles and may leave additional files unsearched for that turn. Choose
Always include for essential references; those sources must still fit completely.

Replacing a source retains originals and extraction revisions. A failed replacement leaves the previous working revision current. Preview or download previous revisions from Knowledge. Changes made to an OR3 document are read from its current saved version.

Chat attachments default to **This chat**. Choose **Add to project knowledge** explicitly to make them reusable. A temporary attachment never becomes project knowledge merely because the chat belongs to a project.

Knowledge promotion waits until request preparation and any omission
confirmation succeed. Inspecting, cancelling or rejecting that preparation does
not promote attachments. Notes and their knowledge bindings save together; a
failed save retains your draft. Completing an add action preserves any newer
note or picker selection you made while it was running.

## Memory and continuity

The project brief is edited inline on Project Home. Memory shows saved memories in a clean text list. Use **Add** to save a memory explicitly; each memory’s actions menu offers edit and delete, plus **View original chat** when it came from a conversation. Editing opens its form with **Save changes** and **Cancel**. On completed messages in project chats, the bookmark icon in the message action bar offers **Remember for this project**. Its review dialog names the destination project, even when another project is visible in the sidebar. Save the text you want OR3 to remember; there are no categories to choose. Chats outside projects do not show this action. Delete or edit saved memories at any time. OR3 also captures clear, durable project information automatically after completed chat responses. It batches three completed exchanges or waits ten seconds of inactivity. A small Jev check decides whether extraction is worthwhile; Luna Latest then produces short memories backed by user messages. Questions, unchosen ideas and assistant recommendations are skipped. Automatic capture runs separately from sending, requires available OpenRouter credentials, and does not run while the browser is closed. It does not backfill old conversations. Up to twenty automatic memories are retained; explicit corrections can update automatic entries, while manual saves and edits stay user-owned. Only up to four matching automatic memories are selected for a later request, so prompt size stays bounded. Excluded chats are not captured. Saving closes the form immediately; an optional OpenRouter classification runs separately to organize internal metadata. It never changes your text. If it is unavailable or uncertain, the saved memory still works normally.

**Continue in new chat** generates a compact handoff with links to original evidence. The new chat stays in the same project. Handoff generation uses the project's brief, instructions, and saved memories as quoted reference; it does not load every knowledge file.

Relevant valid handoff summaries may be retrieved in later turns. Project search/read tools can search previous project chats when useful. Exclude a chat under **Settings → Project chats** to remove it from future retrieval. Moving or excluding evidence, deleting it, or editing its captured revision invalidates dependent handoff summaries.

## Settings and context

Chats inherit their project's saved default model until you choose a model or
routing variant explicitly. Inherited choices update when the saved default
changes or the chat moves to another project. Use **Use project default** in
the chat settings menu to clear a chat override; outside projects, the action
is **Use default model**. Restoring an unsent text draft does not create a model
override for an existing chat.

Settings groups instructions, the searchable default-model picker, and tool permissions. Pick **Use chat default** to inherit the normal chat model; explicit chat model choices take precedence. Tool categories start collapsed and show how many tools are allowed. Expand a category for compact tool rows, or search to reveal matching tools automatically. Tool descriptions appear inside the permission dropdowns. Choose **Off**, **Ask first**, or **On**. Globally disabled tools and tools that cannot enforce project scope sit under **Unavailable tools**, with an explanation. Repository restrictions expand only for tools with a repository argument; old unsupported restrictions can be cleared explicitly. **Save changes** and **Discard** remain visible while scrolling. Instructions, model, and permission edits take effect only when saved.

Server-owned tools also appear under Unavailable tools: project execution uses
the browser boundary and cannot enable them through project settings.

Expand **Project chats** to add or remove conversations or switch their inclusion in project memory. Those chat actions save immediately; save or discard other settings first. A chat moves together with its branches, and OR3 reports how many related chats moved along. A chat that older versions listed in several projects shows a banner above the composer; choose **Keep in** the project it belongs to before sending. Saved project context must fit alongside the conversation and completion allowance; OR3 does not silently truncate required instructions or memory.

Project context is recorded with each response for diagnostics, including submitted instructions, brief, memories, sources, images, and chat summaries. Available, retrieved, and included are different states; inclusion does not prove the model relied on a source. The conversation has no inline context counter or inspector. Originals remain accessible in Knowledge.

Request history distinguishes preparation, dispatch, transport acceptance and
failure. Diagnostic previews share a small aggregate budget; trimming a preview
does not remove evidence from the model request or erase its recorded identity.
Failed requests with no response keep the normal empty-response cleanup behavior.

Tool settings narrow tools already available to you. Unknown plugin tools default to disabled. Global search/open-pane tools that cannot enforce project scope are disabled. Repository restrictions require a concrete `owner`/`repo`, `repository`, or `repo` argument matching the configured allowlist; unsupported argument shapes refuse execution. External tools require approval for each action because OR3 cannot classify arbitrary plugin side effects. Sending, publishing, and destructive host actions also require approval. Project settings never grant workspace permissions.

Project turns run through the browser execution boundary. Server-owned tools, background inference, and workflow/plugin inference paths without a project context contract refuse project execution. The server checks canonical explicit and legacy project ownership; older providers without that check require an update before server-owned execution can be admitted. This limitation does not disable normal project chat in the browser.

## Persistence

Project policy and knowledge bindings reuse synchronized internal posts, workspace-scoped Files, and existing backups. Original and extraction hashes retain their references across replacements. Deleting a project removes its policy and bindings and detaches chats, preserving the underlying chats, documents, and saved files. General Trash restore of a source makes it available again without silently changing its context mode.

Workspace permissions apply to cloud copies: viewers cannot edit, and losing membership removes access. Dedicated project sharing, connected sources, scalable retrieval, and project-only export are later work with separate permission and preservation contracts.

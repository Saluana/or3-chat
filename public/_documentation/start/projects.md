# Work in a project

Open **Projects** in the sidebar to search, pin, create, or return to a workspace. Project Home has recent activity and links to Knowledge, Memory, and Settings. Each chat has one owning project; opening another project does not change a turn already in progress.

The Home sidebar has a **Projects** navigation row below Chats and Documents. It opens the full project list; the Projects rail button also opens that list. Project Home brings together the brief, links to **Knowledge** and **Memory**, and a time-grouped activity list mixing project chats and documents. The list includes OR3 documents added through Knowledge and uses the same rows, conversation families, search, and pagination as the normal sidebar. The single top back button returns to the project from a section, then to **Home** when you entered through a Home shortcut or **Projects** when you entered through the list. The settings icon opens **Settings**, including controls to move chats into the project or exclude them from memory. Use the sidebar search to filter projects and **New project** to create one. Browsing a project preserves the active pane and workspace tabs; opening or creating a chat uses the chat pane as usual.

## Knowledge

Use **Add source** to upload a PDF, DOCX, UTF-8 text/Markdown/CSV, or image, write a note, or add an existing saved file or OR3 document. Only the selected add form opens. Notes and saved answers can be saved as OR3 documents and added here. Files uses the same catalog and original bytes as the rest of OR3. Source rows show status, context mode, and current preview; expand **History and actions** for revisions, downloads, retry, replacement, or removal.

Processing produces a plain-text preview with page or paragraph locations. **Ready** means the supported extraction finished; **Partially readable** means only part could be read; **Failed** offers retry. PDF extraction does not perform OCR. Uploads for extraction are limited to 20 MiB, PDFs to 200 pages, extracted text to 2 MiB, DOCX archive expansion to 40 MiB, and processing to 30 seconds. Images remain image inputs for vision models.

Choose a mode independently for each project:

- **Use when relevant:** OR3 selects a bounded excerpt when the question matches. Up to five knowledge excerpts are selected per turn.
- **Always include:** the complete readable source must fit. Missing bytes, partial extraction, unsupported vision, or insufficient model capacity block sending visibly.
- **Do not use:** the source is excluded from automatic context and project tool reads.

Replacing a source retains originals and extraction revisions. A failed replacement leaves the previous working revision current. Preview or download previous revisions from Knowledge. Changes made to an OR3 document are read from its current saved version.

Chat attachments default to **This chat**. Choose **Add to project knowledge** explicitly to make them reusable. A temporary attachment never becomes project knowledge merely because the chat belongs to a project.

## Memory and continuity

Memory shows the project brief and saved facts or decisions as readable cards. Use the brief's edit icon or **Add**, then save explicitly; editing a saved memory opens its form with **Save changes** and **Cancel**. A message's **Remember for this project** action opens editable text before saving. Delete or edit saved memories at any time. Only explicit saves become durable memory.

**Continue in new chat** generates a compact handoff with links to original evidence. The new chat stays in the same project. Handoff generation uses the project's brief, instructions, and saved memories as quoted reference; it does not load every knowledge file. Review handoff suggestions to update the brief or add a memory. Compare proposed decisions with existing saved decisions before accepting them; rejected ideas never become decisions automatically.

Relevant valid handoff summaries may be retrieved in later turns. Project search/read tools can search previous project chats when useful. Exclude a chat under **Settings → Project chats** to remove it from future retrieval. Moving or excluding evidence, deleting it, or editing its captured revision invalidates dependent handoff suggestions.

## Settings and context

Set project instructions and a default model. Explicit chat model choices take precedence. Saved project context must fit alongside the conversation and completion allowance; OR3 does not silently truncate required instructions or memory.

The response's **Context** control lists the actual submitted instructions, brief, memories, sources, images, and chat summaries. Available, retrieved, and included are different states. The inspector retains bounded previews and per-request iteration state after reload; inclusion does not prove the model relied on a source. Originals remain accessible in Knowledge.

Tool settings narrow tools already available to you. Unknown plugin tools default to disabled. Global search/open-pane tools that cannot enforce project scope are disabled. Repository restrictions require a concrete `owner`/`repo`, `repository`, or `repo` argument matching the configured allowlist; unsupported argument shapes refuse execution. External tools require approval for each action because OR3 cannot classify arbitrary plugin side effects. Sending, publishing, and destructive host actions also require approval. Project settings never grant workspace permissions.

Project turns run through the browser execution boundary. Server-owned tools, background inference, and workflow/plugin inference paths without a project context contract refuse project execution. The server checks canonical explicit and legacy project ownership; older providers without that check require an update before server-owned execution can be admitted. This limitation does not disable normal project chat in the browser.

## Persistence

Project policy and knowledge bindings reuse synchronized internal posts, workspace-scoped Files, and existing backups. Original and extraction hashes retain their references across replacements. Deleting a project removes its policy and bindings and detaches chats, preserving the underlying chats, documents, and saved files. General Trash restore of a source makes it available again without silently changing its context mode.

Workspace permissions apply to cloud copies: viewers cannot edit, and losing membership removes access. Dedicated project sharing, connected sources, scalable retrieval, and project-only export are later work with separate permission and preservation contracts.

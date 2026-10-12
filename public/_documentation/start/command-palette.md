# Command Palette

The command palette is the fastest way to move around OR3. It searches the full
contents of your workspace — chats, documents, projects, system prompts, images,
dashboard pages, and plugin records — and it runs commands without leaving the
keyboard.

## Opening it

- Press **Cmd+K** (macOS) or **Ctrl+K** (Windows/Linux) anywhere in the
  workspace.
- Click the **⌘K** badge in the sidebar search field.
- Click the magnifier in the collapsed sidebar rail.

Pressing the shortcut while the palette is already open reselects the query
instead of stacking a second overlay. Closing the palette restores focus to
wherever you were before.

The sidebar search field is unchanged: it still filters the sidebar list only.
The palette is the global search.

## Searching

Type to search. Results are grouped by category and ordered by relevance, with
the most recently updated items winning ties. Matching text is shown as a
snippet under each row, so you can tell *why* something matched.

Changing the query immediately retires the previous results. During the search
debounce, Enter cannot execute a command belonging to the old query.

Search runs over full content, not just titles:

| Category | What is searched |
| --- | --- |
| Chats | Thread titles and message bodies |
| Documents | Titles and document text |
| Projects | Project names and descriptions |
| Prompts | Prompt titles, instruction bodies, tags, and favorite state |
| Images | File names and captions |
| Files | Saved-file names and bounded indexed text; prefix/filename coverage is disclosed |
| Dashboard | Page titles and descriptions |
| Commands | Command labels, descriptions, and keywords |

With an empty query the palette shows recent items plus available commands, so
it doubles as a launcher.

### Category filters

Click a chip, or type a prefix followed by a colon:

```
chat: astilbe
doc: roadmap
project: marketing
prompt: roleplay
image: garden
file: notes
cmd: theme
```

Removing the prefix (or clicking **All**) searches everything again.

## Keyboard reference

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move the active result (wraps at both ends) |
| `Enter` | Run the primary action for the active result |
| `Tab` or `Cmd+Enter` | Open the action tray and focus its first action |
| `Tab` / `Shift+Tab` (in tray) | Cycle through the tray's actions |
| `Esc` | Close the palette |

On desktop, hovering previews a row until you click one. The first click selects that row
and locks its preview; click the same row again (or press `Enter`) to open it.
Clicking a different row moves the lock without opening anything.

## Preview panel

On desktop, the active result is previewed on the right (below the list on tablet screens):
a snippet or description, key metadata, and a thumbnail for images. Previews are
read-only and never navigate on their own. If a preview cannot be loaded the
palette says so and still lets you open the result.

On phones, search uses the full available height for results, with compact
category filters and a **Cancel** control beside the query. Tapping a chat,
document, project, prompt, image, file, or plugin record dismisses the keyboard
and opens a preview in a bottom slideover. The preview and its actions scroll
independently. Drag the handle down or close the slideover to return to the same query and list position;
tap the result again to preview it again. Its **Open** action navigates to it.
Commands, open tabs, settings, and dashboard entries run on the first tap.
The background stays fixed while search is open. With the iOS keyboard visible,
swipes scroll the results or category filters without panning the page behind them.
Flicks continue smoothly after release and stop when you touch again or reach
the end of the scroll area.

On short desktop or tablet screens, the inline preview is hidden and secondary
actions collapse behind **More**. With very little vertical space, use **Actions**
and **Results** beside the query to switch between the two panels. The dialog
follows Safari’s visible viewport when its keyboard opens or pans the page.

## Actions

Every result has a primary action — usually *Open* — plus optional secondary
actions such as *Open in new pane*, *Reveal in sidebar*, or plugin-provided
actions. The palette closes after a successful action unless the action opts out
(for example, a toggle you may want to press twice).

Prompt results open the selected prompt directly in edit mode. The
**Open system prompts** and **New system prompt** commands open the library home
and a fresh editor respectively.

If an action fails, the palette stays open, keeps your active result, and shows
a recoverable error message so you can retry or pick something else. If you
switch workspaces while an action is pending, its later result cannot close the
current palette or display the previous workspace's failure message. This also
applies when you switch away and return before the result arrives.

Actions can be unavailable rather than hidden. A greyed row labelled
*Unavailable* explains the reason on hover, for example when the pane limit is
already reached.

## When search degrades

Each source indexes independently. If one fails, the others keep working and the
palette shows a small retry notice for the failed source only. If the full-text
index cannot be built, the palette automatically falls back to substring
matching, so you never see an empty list because of an indexing error.

## Accessibility

The palette is a combobox over a listbox: the query owns focus and announces the
active option via `aria-activedescendant`, result counts and source failures are
announced politely, and focus is trapped inside the overlay while it is open.
Icons, chips, and surfaces are all theme tokens, so retro and cyberpunk themes
restyle the palette along with the rest of the app.

## Extending it

Plugins can contribute their own searchable records and commands. See
[Command palette plugin contracts](/documentation/plugins/plugin-sdk).

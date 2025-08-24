# Multi-Window Chat Requirements

artifact_id: 5d4e2c2c-5b8f-4f5c-9a62-9c9c3c5a2d11

## 1. Introduction

Provide ability for a user to open up to three side‑by‑side "windows" (panes) each hosting an independent ChatContainer (later also document editors) inside the existing chat page shell. Default = 1 pane. User can add a pane via the existing "New window" button (currently the theme toggle placeholder) until reaching 3. User can close extra panes. Active (focused) pane is visually indicated (primary border or highlight). Selecting a chat/thread from the sidebar loads it into the currently active pane only. Behavior must be simple, minimal state, and not introduce heavy abstraction.

Non‑goals (for now): persistence of pane layout across reloads, drag‑resize between panes, multi‑document editor implementation, complex window management.

## 2. User Roles

-   End User (single role for this feature)

## 3. Functional Requirements (User Stories)

### R1: Open an additional chat window

As a user, I want to click a "New window" control to add a second (or third) chat pane so that I can view/work in multiple chats side by side.
Acceptance Criteria:

-   WHEN I have fewer than 3 panes AND click New Window THEN a new pane SHALL appear to the right of existing panes.
-   IF already 3 panes THEN clicking New Window SHALL do nothing (or show a brief tooltip/disabled state) without errors.
-   New pane SHALL become the active pane.

### R2: Close an extra chat window

As a user, I want to close an extra pane so that I can return to fewer panes and reclaim space.
Acceptance Criteria:

-   Each non-singleton pane (any pane when total > 1) SHALL display a close control (e.g., small "x" icon) on hover or always.
-   WHEN I click the close control on pane i THEN that pane SHALL be removed and remaining panes SHALL shift to fill space evenly.
-   IF the closed pane was active THEN the leftmost remaining pane SHALL become active.
-   Cannot close the last remaining pane (control hidden or disabled at 1 pane).

### R3: Visual active pane indication

As a user, I want the active pane clearly highlighted so I know which pane receives sidebar selections.
Acceptance Criteria:

-   Active pane SHALL have a primary colored border (2px) or shadow distinct from inactive panes.
-   Inactive panes SHALL have neutral border.
-   Clicking anywhere inside a pane (except on buttons that shift focus elsewhere) SHALL set it active.

### R4: Sidebar selection targets active pane

As a user, I want selecting a thread in the sidebar to load only in the active pane so that I control which pane changes.
Acceptance Criteria:

-   WHEN I pick a thread from sidebar THEN only the active pane's ChatContainer SHALL load that thread's messages.
-   Other panes SHALL remain unchanged.
-   New chat initiation from sidebar ("New Chat") SHALL clear only the active pane and set it to empty thread state.

### R5: Independent pane state

As a user, I want each pane to maintain its own message history and thread id so switching panes doesn't overwrite others.
Acceptance Criteria:

-   Each pane SHALL store its own current threadId and messageHistory.
-   Loading a thread in one pane SHALL NOT mutate other panes' state.

### R6: Basic accessibility & keyboard

As a keyboard user, I want to switch panes and identify active pane.
Acceptance Criteria:

-   Each pane container SHALL have tabindex="0" enabling focus and focus style tied to active state.
-   Pressing ArrowLeft/ArrowRight while a pane is focused with multiple panes SHALL move active to adjacent pane.

## 4. Non-Functional Requirements

-   Simplicity: Implementation SHALL avoid complex window manager classes; prefer an array of pane state objects in ChatPageShell.
-   Performance: Rendering up to 3 ChatContainers SHALL not introduce noticeable lag (re-use existing ChatContainer without changes beyond accepting independent props).
-   Maintainability: Code size minimal; no external dependencies added.
-   Safety: Guard array length (max 3) and ensure indices stable.

## 5. Constraints & Assumptions

-   Pane layout: Equal width flex children (1 to 3) using existing CSS utilities.
-   No persistence to IndexedDB needed for pane layout.
-   ChatContainer already takes threadId & message history; we can reuse load logic per pane.
-   Future document editor panes will plug into same structure (placeholder not required now).

## 6. Out of Scope

-   Drag resizing between panes.
-   Reordering panes via drag & drop.
-   Persisting active pane on reload.
-   Cross-pane synchronization beyond shared DB reads.

## 7. Open Questions (deferred / simple defaults)

-   Tooltip vs disabled state at 3 panes: Default = disable button (aria-disabled) with tooltip "Max 3 windows".
-   Close button styling specifics: Use existing UButton icon small variant.

## 8. Acceptance Test Matrix (Summary)

| Req | Scenario                                     | Expected                        |
| --- | -------------------------------------------- | ------------------------------- |
| R1  | <3 panes click New                           | Pane count +1 (<=3), new active |
| R1  | 3 panes click New                            | No change                       |
| R2  | Close active pane                            | Pane removed, leftmost active   |
| R3  | Click pane body                              | That pane active highlight      |
| R4  | Sidebar select thread                        | Active pane thread updates only |
| R5  | Switch panes after loading different threads | Each retains its messages       |
| R6  | ArrowRight from pane 1                       | Pane 2 active                   |
| R6  | ArrowLeft on leftmost                        | No change                       |

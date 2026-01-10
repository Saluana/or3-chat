# Sidebar Homepage Rework - Requirements

## Introduction

The sidebar homepage is the primary navigation interface for accessing threads, documents, and projects in or3.chat. The current implementation suffers from:
- **Visual Design Issues**: The expanded sidebar homepage looks outdated compared to the rest of the app
- **Virtual Scrolling Bugs**: The current `virtua` Virtualizer causes items to disappear/reappear randomly during scrolling
- **Performance Concerns**: All threads and documents are loaded into memory upfront

This rework aims to:
1. Replace the virtual list with `or3-scroll` for consistent behavior with chat messages
2. Redesign thread/document items with icons, model info, and time-based grouping
3. Add dedicated navigation for "Chats Only" and "Documents Only" views
4. Implement smart pagination to avoid loading all data at once

---

## Requirements

### 1. Navigation Architecture

**1.1 Homepage Navigation Tabs**
> As a user, I want quick access buttons at the top of the sidebar homepage so that I can filter my view to specific content types.

**Acceptance Criteria:**
- WHEN the sidebar homepage loads THEN it SHALL display a "Projects" section header at the top
- WHEN viewing the homepage THEN it SHALL display a "Chats" quick-access button
- WHEN viewing the homepage THEN it SHALL display a "Docs" quick-access button
- WHEN I click the "Chats" button THEN it SHALL navigate to a chats-only page
- WHEN I click the "Docs" button THEN it SHALL navigate to a documents-only page
- WHEN on a subpage THEN it SHALL display a back button to return to homepage

**1.2 Filter Button Removal**
> As a user, I want a cleaner interface without the filter popover since dedicated pages now serve that purpose.

**Acceptance Criteria:**
- WHEN the homepage is active THEN the filter button next to search SHALL be removed
- WHEN navigating between pages THEN the search input functionality SHALL be preserved

---

### 2. Unified Item List with Time-Based Grouping

**2.1 Mixed Timeline View**
> As a user, I want to see my chats and documents sorted together by last activity so that I can find recent work regardless of type.

**Acceptance Criteria:**
- WHEN on the homepage THEN threads and documents SHALL be mixed together in a single list
- WHEN displaying items THEN they SHALL be sorted by `updated_at` (or `last_message_at` for threads) descending
- WHEN an item was accessed within 24 hours THEN it SHALL appear under "Recently Opened" section
- WHEN an item was accessed today but not in last 24 hours THEN it SHALL appear under "Today" section
- WHEN an item was accessed yesterday THEN it SHALL appear under "Yesterday" section
- WHEN an item was accessed earlier this week THEN it SHALL appear under "Earlier This Week" section
- WHEN an item was accessed this month THEN it SHALL appear under "This Month" section
- WHEN an item is older THEN it SHALL appear under "Older" section

**2.2 Collapsible Section Headers**
> As a user, I want to collapse time-based sections to focus on specific items.

**Acceptance Criteria:**
- WHEN I click a section header THEN it SHALL toggle the section's collapsed state
- WHEN a section is collapsed THEN it SHALL hide all items within it
- WHEN a section is expanded THEN it SHALL show all items within it
- WHEN the page loads THEN all sections SHALL default to expanded

---

### 3. Thread Item Redesign

**3.1 Thread Item Layout**
> As a user, I want thread items to display clear visual indicators so I can quickly identify them.

**Acceptance Criteria:**
- WHEN displaying a thread item THEN it SHALL show a chat icon on the left side
- WHEN displaying a thread item THEN it SHALL show the thread title
- WHEN displaying a thread item THEN it SHALL show the last-used model name below the title
- WHEN displaying a thread item in "Today" or "Recently Opened" THEN it SHALL show the time (e.g., "2:14 PM")
- WHEN displaying a thread item in "Yesterday" THEN it SHALL show the time (e.g., "5:32 PM")
- WHEN displaying a thread item in "Earlier This Week" THEN it SHALL show the day name (e.g., "Monday")
- WHEN displaying a thread item in "This Month" or older THEN it SHALL show the date (e.g., "Jan 5")
- WHEN hovering over a thread item on desktop THEN it SHALL reveal the settings/actions button
- WHEN viewing on mobile THEN the settings button SHALL always be visible

**3.2 Thread Icon Background**
> As a user, I want visual differentiation between chat and document icons.

**Acceptance Criteria:**
- WHEN displaying a thread icon THEN it SHALL have a distinct background color (e.g., primary/blue tint)
- WHEN the icon background is rendered THEN it SHALL be subtle and not distracting

---

### 4. Document Item Redesign

**4.1 Document Item Layout**
> As a user, I want document items to be visually distinct from threads.

**Acceptance Criteria:**
- WHEN displaying a document item THEN it SHALL show a document/file icon on the left side
- WHEN displaying a document item THEN it SHALL show the document title
- WHEN displaying a document item THEN it SHALL show the document type below the title (if available)
- WHEN displaying a document item THEN it SHALL show the appropriate time/date aligned right
- WHEN hovering over a document item on desktop THEN it SHALL reveal the settings/actions button
- WHEN on mobile THEN the settings button SHALL always be visible

**4.2 Document Icon Background**
> As a user, I want documents to have their own distinct icon styling.

**Acceptance Criteria:**
- WHEN displaying a document icon THEN it SHALL have a different background color than threads
- WHEN differentiating icons THEN the styling SHALL be subtle but noticeable

---

### 5. Scroll Virtualization with Or3Scroll

**5.1 Replace Virtua with Or3Scroll**
> As a user, I want smooth, consistent scrolling behavior without items disappearing.

**Acceptance Criteria:**
- WHEN the sidebar list renders THEN it SHALL use the `or3-scroll` library instead of `virtua`
- WHEN scrolling through items THEN no items SHALL disappear or flicker unexpectedly
- WHEN scrolling rapidly THEN the list SHALL maintain stable rendering
- WHEN the list height changes THEN the scroll container SHALL adapt smoothly

**5.2 Consistent Experience**
> As a user, I want the sidebar to scroll similarly to chat messages.

**Acceptance Criteria:**
- WHEN scrolling the sidebar THEN it SHALL feel consistent with `ChatContainer` scrolling
- WHEN reaching the bottom of loaded items THEN additional items MAY be loaded (pagination)

---

### 6. Smart Search Behavior

**6.1 Context-Aware Search**
> As a user, I want search to adapt based on which page I'm viewing.

**Acceptance Criteria:**
- WHEN searching on the homepage THEN it SHALL search projects, documents, AND chats
- WHEN searching on the homepage THEN results SHALL be ordered by relevance
- WHEN searching on the "Chats" page THEN it SHALL only search chats
- WHEN searching on the "Docs" page THEN it SHALL only search documents
- WHEN clearing the search THEN it SHALL return to the normal view for that page

---

### 7. Performance Optimization

**7.1 Paginated Data Loading**
> As a user, I want the sidebar to load quickly even with many threads/documents.

**Acceptance Criteria:**
- WHEN the sidebar loads THEN it SHALL initially load only a limited batch of items (e.g., 50-100)
- WHEN scrolling near the bottom THEN it SHALL load additional items seamlessly
- WHEN loading more items THEN the experience SHALL feel seamless (no loading spinners breaking flow)
- IF all items have been loaded THEN further scroll triggers SHALL NOT request more data

**7.2 Efficient Memory Usage**
> As a developer, I want the sidebar to not consume excessive memory.

**Acceptance Criteria:**
- WHEN items are rendered THEN only lightweight metadata SHALL be kept in memory
- WHEN an item is rendered THEN heavy fields like full content SHALL NOT be loaded
- WHEN navigating away from sidebar THEN cached data MAY be retained for quick return

---

### 8. Projects Section

**8.1 Projects At Top**
> As a user, I want projects to remain prominently displayed at the top.

**Acceptance Criteria:**
- WHEN the homepage loads THEN the "Projects" section SHALL appear first (above time-grouped items)
- WHEN viewing projects THEN they SHALL display as they currently do (accordion/tree)
- WHEN a project is expanded THEN its children SHALL display inside the project container

---

## Non-Functional Requirements

### Performance
- Initial render of sidebar SHALL complete within 100ms for up to 500 items
- Scroll frame rate SHALL remain at 60fps during normal scrolling
- Memory usage SHALL not exceed double the current baseline

### Accessibility
- All interactive elements SHALL be keyboard navigable
- Screen readers SHALL be able to announce item types (thread vs document)
- Focus states SHALL be clearly visible

### Responsiveness
- Layout SHALL adapt to sidebar widths from 200px to 400px
- Touch targets SHALL be at least 44x44px on mobile

# Sidebar Homepage Rework - Implementation Tasks

## Overview

This task list covers the full implementation of the sidebar homepage rework, organized by component and feature area.

---

## Phase 1: Utility Layer & Infrastructure

### 1.1 Time Grouping Utilities
- [x] Create `app/utils/sidebar/sidebarTimeUtils.ts`
  - [x] Implement `computeTimeGroup(timestamp: number): TimeGroup` (5 groups: today, yesterday, earlierThisWeek, thisMonth, older)
  - [x] Implement `formatTimeDisplay(timestamp: number, group: TimeGroup): string`
  - [x] Implement `getTimeGroupLabel(group: TimeGroup): string`
  - [x] Add helper functions: `getStartOfDay()`, `getStartOfWeek()`, `getStartOfMonth()`
  - **Requirements: 2.1**

### 1.2 Unified Item Type
- [x] Add to `app/types/sidebar.ts`
  - [x] Define `UnifiedSidebarItem` interface (id, type, title, updatedAt, forked?, postType?)
  - [x] Define `TimeGroup` type union (5 groups, no 'recentlyOpened')
  - [x] Add `threadToUnified()` and `docToUnified()` transform functions
  - **Requirements: 2.1, 3.1, 4.1**

### 1.3 Pagination Composable (Local State)
- [x] Create `app/composables/sidebar/usePaginatedSidebarItems.ts`
  - [x] Use `shallowRef` for items array
  - [x] Implement `loadMore()` with cursor-based pagination
  - [x] Implement `reset()` for search/filter changes
  - [x] No SidebarEnvironment extension needed - purely local state
  - **Requirements: 7.1, 7.2**

---

## Phase 2: Core UI Components

### 2.1 Section Header Component
- [x] Create `app/components/sidebar/SidebarGroupHeader.vue`
  - [x] Implement collapsible header with label
  - [x] Use `useIcon()` for chevron icon (right collapsed, down expanded)
  - [x] **44px minimum height** for touch target
  - [x] Hover/active states for interactivity feedback
  - **Requirements: 2.2, UX-3**

### 2.2 Unified Item Component
- [x] Create `app/components/sidebar/SidebarUnifiedItem.vue`
  - [x] Use `useIcon()` for all icons (sidebar.chat, sidebar.note, ui.more, etc.)
  - [x] Use `useThemeOverrides()` for icon container and action buttons
  - [x] Use `usePopoverKeyboard()` for keyboard accessibility
  - [x] Integrate `useThreadHistoryActions()` / `useDocumentHistoryActions()` for plugin actions
  - [x] Show "Chat" or document type as subtitle (no model name)
  - [x] **Action button: 16px visual, 40px+ hit area** via padding
  - [x] **Mobile layout:** stacked title/time when <280px width
  - [x] **Mobile:** action button always visible (no hover-only)
  - [x] Emit: `select`, `rename`, `delete`, `add-to-project`
  - **Requirements: 3.1, 3.2, 4.1, 4.2, UX-1, UX-2**

### 2.3 Time-Grouped List Component
- [x] Create `app/components/sidebar/SidebarTimeGroupedList.vue`
  - [x] Import and use `Or3Scroll` (replaces virtua)
  - [x] Use `usePaginatedSidebarItems()` composable
  - [x] Local `collapsedGroups` Set for section collapse state
  - [x] Connect `@reachBottom` to pagination
  - [x] Render `SidebarGroupHeader` and `SidebarUnifiedItem`
  - [x] **Empty state:** show message + CTA when no items
  - [x] **Loading state:** skeleton items during pagination
  - [x] **Hide empty groups:** don't show "Today" header if no items
  - **Requirements: 2.1, 2.2, 5.1, 5.2, UX-5, UX-7**

### 2.4 Navigation Segmented Control
- [x] Create navigation component or add to SidebarHomePage
  - [x] Three segments: All / Chats / Docs
  - [x] Clear active state indication
  - [x] Compact single-row layout
  - **Requirements: 1.1, UX-4**

---

## Phase 3: Page Components

### 3.1 Homepage Redesign
- [x] Modify `app/components/sidebar/SidebarHomePage.vue`
  - [x] Add "Chats" and "Docs" navigation buttons at top
  - [x] Remove direct `SidebarVirtualList` usage
  - [x] Add `SidebarProjectSection` for projects
  - [x] Add `SidebarTimeGroupedList` for unified items
  - [x] Connect page navigation via `useSidebarPageControls()`
  - **Requirements: 1.1, 8.1**

### 3.2 Chats-Only Page
- [x] Create `app/components/sidebar/SidebarChatsPage.vue`
  - [x] Define as sidebar page with `usesDefaultHeader: true`
  - [x] Display only thread items with time grouping
  - [x] Add back button to return to homepage
  - [x] Connect search to chats-only scope
  - **Requirements: 1.1, 6.1**

### 3.3 Documents-Only Page
- [x] Create `app/components/sidebar/SidebarDocsPage.vue`
  - [x] Define as sidebar page with `usesDefaultHeader: true`
  - [x] Display only document items with time grouping
  - [x] Add back button to return to homepage
  - [x] Connect search to docs-only scope
  - **Requirements: 1.1, 6.1**

### 3.4 Page Registration
- [x] Modify `app/composables/sidebar/useSidebarPages.ts`
  - [x] Register `sidebar-chats` page definition
  - [x] Register `sidebar-docs` page definition
  - [x] Ensure proper KeepAlive handling
  - **Requirements: 1.1**

---

## Phase 4: Header & Search Updates

### 4.1 Header Simplification
- [x] Modify `app/components/sidebar/SideNavHeader.vue`
  - [x] Remove filter button and related code
  - [x] Add `activePage` prop to determine search scope
  - [x] Update search placeholder based on active page
  - [x] Clean up unused filter-related state
  - **Requirements: 1.2, 6.1**

### 4.2 Context-Aware Search
- [x] Create/modify search composable
  - [x] Implement search scope determination based on active page
  - [x] Implement relevance-based sorting for homepage search
  - [x] Add debouncing (300ms)
  - **Requirements: 6.1**

---

## Phase 5: Integration & Data Flow

### 5.1 Wire Up Homepage
- [x] Connect `SidebarHomePage` to pagination composable
- [x] Merge threads and documents into unified list
- [x] Sort by `updated_at` / `last_message_at`
- [x] Pass correct props to `SidebarTimeGroupedList`
- **Requirements: 2.1, 7.1**

### 5.2 Event Handling
- [x] Forward all item events to parent components
  - [x] `select-thread` / `select-document`
  - [x] `rename-thread` / `rename-document`
  - [x] `delete-thread` / `delete-document`
  - [x] `add-thread-to-project` / `add-document-to-project`
- [x] Ensure SideNavContent receives and handles all events
- **Requirements: 3.1, 4.1**

### 5.3 Active State Management
- [ ] Ensure `activeThreadIds` and `activeDocumentIds` are respected
- [ ] Highlight correct items when active
- [ ] Handle multi-selection if applicable
- **Requirements: 3.1, 4.1**

---

## Phase 6: Cleanup & Migration

### 6.1 Remove Old Components
- [ ] Delete `app/components/sidebar/SidebarVirtualList.vue`
- [ ] Remove virtua import from sidebar code
- [ ] Update any remaining references
- **Requirements: 5.1**

### 6.2 Update Tests
- [ ] Update `SideNavContent.test.ts` for new component structure
- [ ] Add tests for `SidebarTimeGroupedList`
- [ ] Add tests for `SidebarUnifiedItem`
- [ ] Add tests for time utilities
- [ ] Run full test suite and fix any failures

---

## Phase 7: Polish & Performance

### 7.1 Visual Polish
- [ ] Fine-tune icon background colors for threads vs documents
- [ ] Ensure consistent spacing and alignment
- [ ] Add subtle hover transitions
- [ ] Verify dark mode styling
- **Requirements: 3.2, 4.2**

### 7.2 Performance Verification
- [ ] Profile initial render with 500+ items
- [ ] Verify scroll performance at 60fps
- [ ] Check memory usage growth during scrolling
- [ ] Optimize any detected bottlenecks
- **Requirements: Non-functional (Performance)**

### 7.3 Accessibility
- [ ] Add proper ARIA labels to interactive elements
- [ ] Verify keyboard navigation works
- [ ] Test with screen reader
- **Requirements: Non-functional (Accessibility)**

---

## Phase 8: Documentation & Review

### 8.1 Code Comments
- [ ] Add JSDoc comments to new composables
- [ ] Document component props and events
- [ ] Add inline comments for complex logic

### 8.2 Final Review
- [ ] Self-review all changes
- [ ] Run linting and fix issues
- [ ] Verify no TypeScript errors
- [ ] Create PR for review

---

## Verification Checklist

After implementation, verify:

- [ ] Homepage shows Projects at top, then time-grouped items
- [ ] Chats and Docs buttons navigate to respective pages
- [ ] Items show correct icons (chat vs document)
- [ ] Time displays correctly per section
- [ ] Actions menu appears on hover (desktop)
- [ ] Actions menu always visible (mobile)
- [ ] Search works correctly on each page
- [ ] Scrolling is smooth without flickering
- [ ] Pagination loads more items on scroll
- [ ] All existing functionality (rename, delete, add to project) still works

---

## Task Metrics

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| Phase 1: Utilities | 6 | 3-4 |
| Phase 2: Components | 8 | 6-8 |
| Phase 3: Pages | 7 | 4-5 |
| Phase 4: Header/Search | 4 | 2-3 |
| Phase 5: Integration | 5 | 3-4 |
| Phase 6: Cleanup | 4 | 2 |
| Phase 7: Polish | 5 | 3-4 |
| Phase 8: Documentation | 2 | 1-2 |
| **Total** | **41** | **24-32** |

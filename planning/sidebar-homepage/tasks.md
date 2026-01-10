# Sidebar Homepage Rework - Implementation Tasks

## Overview

This task list covers the full implementation of the sidebar homepage rework, organized by component and feature area.

---

## Phase 1: Utility Layer & Infrastructure

### 1.1 Time Grouping Utilities
- [ ] Create `app/utils/sidebar/sidebarTimeUtils.ts`
  - [ ] Implement `computeTimeGroup(timestamp: number): TimeGroup`
  - [ ] Implement `formatTimeDisplay(timestamp: number, group: TimeGroup): string`
  - [ ] Implement `getTimeGroupLabel(group: TimeGroup): string`
  - [ ] Add helper functions: `getStartOfDay()`, `getStartOfWeek()`, `getStartOfMonth()`
  - [ ] Write unit tests for time utilities
  - **Requirements: 2.1**

### 1.2 Unified Item Type
- [ ] Create `app/types/sidebar.ts` additions
  - [ ] Define `UnifiedSidebarItem` interface
  - [ ] Define `TimeGroup` type union
  - [ ] Add type conversion functions `threadToUnified()`, `documentToUnified()`
  - **Requirements: 2.1, 3.1, 4.1**

### 1.3 Pagination Composable
- [ ] Create `app/composables/sidebar/usePaginatedSidebarItems.ts`
  - [ ] Implement cursor-based pagination state
  - [ ] Implement `loadMore()` function
  - [ ] Implement `reset()` function for search/filter changes
  - [ ] Add reactive `hasMore` and `loading` flags
  - [ ] Write unit tests for pagination logic
  - **Requirements: 7.1, 7.2**

---

## Phase 2: Core UI Components

### 2.1 Section Header Component
- [ ] Create `app/components/sidebar/SidebarGroupHeader.vue`
  - [ ] Implement collapsible header with label
  - [ ] Add chevron icon indicating expand/collapse state
  - [ ] Add click handler to emit toggle event
  - [ ] Style with consistent sidebar theming
  - **Requirements: 2.2**

### 2.2 Unified Item Component
- [ ] Create `app/components/sidebar/SidebarUnifiedItem.vue`
  - [ ] Implement layout with icon, title, subtitle, time, actions
  - [ ] Add computed `iconConfig` for thread vs document styling
  - [ ] Implement hover-reveal for actions menu (desktop)
  - [ ] Always show actions on mobile
  - [ ] Add theme override integration
  - [ ] Emit: `select`, `rename`, `delete`, `add-to-project`
  - **Requirements: 3.1, 3.2, 4.1, 4.2**

### 2.3 Time-Grouped List Component
- [ ] Create `app/components/sidebar/SidebarTimeGroupedList.vue`
  - [ ] Replace virtua with `or3-scroll` import
  - [ ] Implement `flattenedItems` computed that interleaves headers with items
  - [ ] Implement `collapsedGroups` Set for tracking collapsed sections
  - [ ] Connect to pagination composable
  - [ ] Handle `reachBottom` event for loading more
  - [ ] Implement item selection highlighting
  - **Requirements: 2.1, 2.2, 5.1, 5.2**

---

## Phase 3: Page Components

### 3.1 Homepage Redesign
- [ ] Modify `app/components/sidebar/SidebarHomePage.vue`
  - [ ] Add "Chats" and "Docs" navigation buttons at top
  - [ ] Remove direct `SidebarVirtualList` usage
  - [ ] Add `SidebarProjectSection` for projects
  - [ ] Add `SidebarTimeGroupedList` for unified items
  - [ ] Connect page navigation via `useSidebarPageControls()`
  - **Requirements: 1.1, 8.1**

### 3.2 Chats-Only Page
- [ ] Create `app/components/sidebar/SidebarChatsPage.vue`
  - [ ] Define as sidebar page with `usesDefaultHeader: true`
  - [ ] Display only thread items with time grouping
  - [ ] Add back button to return to homepage
  - [ ] Connect search to chats-only scope
  - **Requirements: 1.1, 6.1**

### 3.3 Documents-Only Page
- [ ] Create `app/components/sidebar/SidebarDocsPage.vue`
  - [ ] Define as sidebar page with `usesDefaultHeader: true`
  - [ ] Display only document items with time grouping
  - [ ] Add back button to return to homepage
  - [ ] Connect search to docs-only scope
  - **Requirements: 1.1, 6.1**

### 3.4 Page Registration
- [ ] Modify `app/composables/sidebar/useSidebarPages.ts`
  - [ ] Register `sidebar-chats` page definition
  - [ ] Register `sidebar-docs` page definition
  - [ ] Ensure proper KeepAlive handling
  - **Requirements: 1.1**

---

## Phase 4: Header & Search Updates

### 4.1 Header Simplification
- [ ] Modify `app/components/sidebar/SideNavHeader.vue`
  - [ ] Remove filter button and related code
  - [ ] Add `activePage` prop to determine search scope
  - [ ] Update search placeholder based on active page
  - [ ] Clean up unused filter-related state
  - **Requirements: 1.2, 6.1**

### 4.2 Context-Aware Search
- [ ] Create/modify search composable
  - [ ] Implement search scope determination based on active page
  - [ ] Implement relevance-based sorting for homepage search
  - [ ] Add debouncing (300ms)
  - **Requirements: 6.1**

---

## Phase 5: Integration & Data Flow

### 5.1 Wire Up Homepage
- [ ] Connect `SidebarHomePage` to pagination composable
- [ ] Merge threads and documents into unified list
- [ ] Sort by `updated_at` / `last_message_at`
- [ ] Pass correct props to `SidebarTimeGroupedList`
- **Requirements: 2.1, 7.1**

### 5.2 Event Handling
- [ ] Forward all item events to parent components
  - [ ] `select-thread` / `select-document`
  - [ ] `rename-thread` / `rename-document`
  - [ ] `delete-thread` / `delete-document`
  - [ ] `add-thread-to-project` / `add-document-to-project`
- [ ] Ensure SideNavContent receives and handles all events
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

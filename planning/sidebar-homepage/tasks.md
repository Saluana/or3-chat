# Sidebar Homepage Rework - Implementation Tasks

## Overview

This task list covers the full implementation of the sidebar homepage rework, organized by component and feature area.

---

## Phase 1: Utility Layer & Infrastructure

### 1.1 Time Grouping Utilities
- [ ] Create `app/utils/sidebar/sidebarTimeUtils.ts`
  - [ ] Implement `computeTimeGroup(timestamp: number): TimeGroup` (5 groups: today, yesterday, earlierThisWeek, thisMonth, older)
  - [ ] Implement `formatTimeDisplay(timestamp: number, group: TimeGroup): string`
  - [ ] Implement `getTimeGroupLabel(group: TimeGroup): string`
  - [ ] Add helper functions: `getStartOfDay()`, `getStartOfWeek()`, `getStartOfMonth()`
  - **Requirements: 2.1**

### 1.2 Unified Item Type
- [ ] Add to `app/types/sidebar.ts`
  - [ ] Define `UnifiedSidebarItem` interface (id, type, title, updatedAt, forked?, postType?)
  - [ ] Define `TimeGroup` type union (5 groups, no 'recentlyOpened')
  - [ ] Add `threadToUnified()` and `docToUnified()` transform functions
  - **Requirements: 2.1, 3.1, 4.1**

### 1.3 Pagination Composable (Local State)
- [ ] Create `app/composables/sidebar/usePaginatedSidebarItems.ts`
  - [ ] Use `shallowRef` for items array
  - [ ] Implement `loadMore()` with cursor-based pagination
  - [ ] Implement `reset()` for search/filter changes
  - [ ] No SidebarEnvironment extension needed - purely local state
  - **Requirements: 7.1, 7.2**

---

## Phase 2: Core UI Components

### 2.1 Section Header Component
- [ ] Create `app/components/sidebar/SidebarGroupHeader.vue`
  - [ ] Implement collapsible header with label
  - [ ] Use `useIcon()` for chevron icon (right collapsed, down expanded)
  - [ ] **44px minimum height** for touch target
  - [ ] Hover/active states for interactivity feedback
  - **Requirements: 2.2, UX-3**

### 2.2 Unified Item Component
- [ ] Create `app/components/sidebar/SidebarUnifiedItem.vue`
  - [ ] Use `useIcon()` for all icons (sidebar.chat, sidebar.note, ui.more, etc.)
  - [ ] Use `useThemeOverrides()` for icon container and action buttons
  - [ ] Use `usePopoverKeyboard()` for keyboard accessibility
  - [ ] Integrate `useThreadHistoryActions()` / `useDocumentHistoryActions()` for plugin actions
  - [ ] Show "Chat" or document type as subtitle (no model name)
  - [ ] **Action button: 16px visual, 40px+ hit area** via padding
  - [ ] **Mobile layout:** stacked title/time when <280px width
  - [ ] **Mobile:** action button always visible (no hover-only)
  - [ ] Emit: `select`, `rename`, `delete`, `add-to-project`
  - **Requirements: 3.1, 3.2, 4.1, 4.2, UX-1, UX-2**

### 2.3 Time-Grouped List Component
- [ ] Create `app/components/sidebar/SidebarTimeGroupedList.vue`
  - [ ] Import and use `Or3Scroll` (replaces virtua)
  - [ ] Use `usePaginatedSidebarItems()` composable
  - [ ] Local `collapsedGroups` Set for section collapse state
  - [ ] Connect `@reachBottom` to pagination
  - [ ] Render `SidebarGroupHeader` and `SidebarUnifiedItem`
  - [ ] **Empty state:** show message + CTA when no items
  - [ ] **Loading state:** skeleton items during pagination
  - [ ] **Hide empty groups:** don't show "Today" header if no items
  - **Requirements: 2.1, 2.2, 5.1, 5.2, UX-5, UX-7**

### 2.4 Navigation Segmented Control
- [ ] Create navigation component or add to SidebarHomePage
  - [ ] Three segments: All / Chats / Docs
  - [ ] Clear active state indication
  - [ ] Compact single-row layout
  - **Requirements: 1.1, UX-4**

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

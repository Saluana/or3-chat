# Sidebar Homepage Rework - Architecture

## System Overview

```mermaid
graph TB
    subgraph "Entry Points"
        SB[SideBar.vue]
    end
    
    subgraph "Container Layer"
        SNC[SideNavContent.vue]
        SNCC[SideNavContentCollapsed.vue]
    end
    
    subgraph "Page Layer"
        SHP[SidebarHomePage.vue]
        SCP[SidebarChatsPage.vue]
        SDP[SidebarDocsPage.vue]
    end
    
    subgraph "List Layer"
        STGL[SidebarTimeGroupedList.vue]
    end
    
    subgraph "Item Layer"
        SGH[SidebarGroupHeader.vue]
        SUI[SidebarUnifiedItem.vue]
    end
    
    subgraph "Virtualization"
        O3S[Or3Scroll]
    end
    
    SB --> SNC
    SB --> SNCC
    SNC --> SHP
    SNC --> SCP
    SNC --> SDP
    SHP --> STGL
    SCP --> STGL
    SDP --> STGL
    STGL --> O3S
    O3S --> SGH
    O3S --> SUI
```

---

## Data Flow

```mermaid
flowchart LR
    subgraph "Database"
        DB[(IndexedDB)]
    end
    
    subgraph "Live Queries"
        LQ1[Threads Query]
        LQ2[Posts Query]
        LQ3[Projects Query]
    end
    
    subgraph "Composables"
        PCI[usePaginatedSidebarItems]
        STU[sidebarTimeUtils]
    end
    
    subgraph "Components"
        STGL[SidebarTimeGroupedList]
        SUI[SidebarUnifiedItem]
    end
    
    DB --> LQ1 --> PCI
    DB --> LQ2 --> PCI
    DB --> LQ3 --> SHP
    PCI --> STU
    STU --> STGL
    STGL --> SUI
```

---

## Component Hierarchy

```mermaid
graph TD
    subgraph "SideBar.vue (Root)"
        M1[Modals: Rename/Delete/Create]
        M2[Live Queries: threads/posts/projects]
        M3[Height Calculation]
    end
    
    subgraph "SideNavContent.vue"
        P1[Page Router: useActiveSidebarPage]
        P2[SidebarEnvironment Provider]
        P3[Header: SideNavHeader]
        P4[Dynamic Page Component]
    end
    
    subgraph "SidebarHomePage.vue"
        H1[Navigation: Segmented Control]
        H2[Projects Section]
        H3[TimeGroupedList]
    end
    
    subgraph "SidebarTimeGroupedList.vue"
        L1[usePaginatedSidebarItems]
        L2[collapsedGroups: Set]
        L3[Or3Scroll with items]
    end
    
    subgraph "SidebarUnifiedItem.vue"
        I1[useIcon - icons]
        I2[useThemeOverrides - styling]
        I3[usePopoverKeyboard - a11y]
        I4[useThreadHistoryActions - plugins]
    end
    
    M1 & M2 & M3 --> P1 & P2 & P3 & P4
    P4 --> H1 & H2 & H3
    H3 --> L1 & L2 & L3
    L3 --> I1 & I2 & I3 & I4
```

---

## State Management

```mermaid
stateDiagram-v2
    [*] --> SidebarHome
    
    SidebarHome --> SidebarChats: Click "Chats"
    SidebarHome --> SidebarDocs: Click "Docs"
    SidebarChats --> SidebarHome: Back
    SidebarDocs --> SidebarHome: Back
    
    state SidebarHome {
        [*] --> LoadingInitial
        LoadingInitial --> ShowingItems: Data loaded
        ShowingItems --> LoadingMore: Scroll to bottom
        LoadingMore --> ShowingItems: New items loaded
        ShowingItems --> Searching: Query entered
        Searching --> ShowingItems: Query cleared
    }
```

---

## Event Flow

```mermaid
sequenceDiagram
    participant User
    participant SUI as SidebarUnifiedItem
    participant STGL as TimeGroupedList
    participant SHP as HomePage
    participant SNC as SideNavContent
    participant SB as SideBar
    
    User->>SUI: Click item
    SUI->>STGL: emit('select', item)
    STGL->>SHP: forward event
    SHP->>SNC: emit('select-thread' or 'select-document')
    SNC->>SB: forward to parent
    SB->>SB: selectChat() or selectDocument()
    
    User->>SUI: Click rename
    SUI->>STGL: emit('rename', item)
    STGL->>SHP: forward event
    SHP->>SNC: emit('rename-thread' or 'rename-document')
    SNC->>SB: emit('open-rename')
    SB->>SB: openRename() → showRenameModal
```

---

## Time Grouping Logic

```mermaid
flowchart TD
    T[timestamp] --> CHECK{Compare to now}
    
    CHECK --> |>= todayStart| TODAY[today]
    CHECK --> |>= yesterdayStart| YESTERDAY[yesterday]
    CHECK --> |>= weekStart| WEEK[earlierThisWeek]
    CHECK --> |>= monthStart| MONTH[thisMonth]
    CHECK --> |older| OLDER[older]
    
    TODAY & YESTERDAY & WEEK & MONTH & OLDER --> GROUP[Group items]
    GROUP --> FLAT[Flatten with headers]
    FLAT --> RENDER[Or3Scroll renders]
```

---

## Plugin Integration

```mermaid
flowchart LR
    subgraph "Plugin System"
        THA[useThreadHistoryActions]
        DHA[useDocumentHistoryActions]
    end
    
    subgraph "Registration"
        REG[registerThreadHistoryAction]
    end
    
    subgraph "Component"
        SUI[SidebarUnifiedItem]
        POP[Popover Menu]
    end
    
    REG --> THA
    REG --> DHA
    THA --> SUI
    DHA --> SUI
    SUI --> POP
    POP --> |"Renders"|ACTIONS[Plugin Actions]
```

---

## File Structure

```
app/
├── components/sidebar/
│   ├── SideBar.vue                    # Root, modals, queries
│   ├── SideNavContent.vue             # Page router, environment
│   ├── SideNavHeader.vue              # Search, nav buttons
│   ├── SidebarHomePage.vue            # Home with projects + list
│   ├── SidebarChatsPage.vue           # [NEW] Chats only
│   ├── SidebarDocsPage.vue            # [NEW] Docs only
│   ├── SidebarTimeGroupedList.vue     # [NEW] Or3Scroll + grouping
│   ├── SidebarGroupHeader.vue         # [NEW] Collapsible header
│   ├── SidebarUnifiedItem.vue         # [NEW] Thread/doc item
│   ├── SidebarVirtualList.vue         # [DELETE] Replaced
│   └── ...
├── composables/sidebar/
│   ├── useSidebarEnvironment.ts       # Dependency injection
│   ├── useActiveSidebarPage.ts        # Page state
│   ├── usePaginatedSidebarItems.ts    # [NEW] Pagination
│   └── ...
└── utils/sidebar/
    └── sidebarTimeUtils.ts            # [NEW] Time grouping
```

---

## Key Interfaces

```typescript
// Unified item for both threads and documents
interface UnifiedSidebarItem {
  id: string;
  type: 'thread' | 'document';
  title: string;
  updatedAt: number;
  forked?: boolean;      // thread only
  postType?: string;     // document only
}

// Time groups
type TimeGroup = 'today' | 'yesterday' | 'earlierThisWeek' | 'thisMonth' | 'older';

// Flattened list item (for virtualization)
type FlatItem = 
  | { type: 'header'; key: string; label: string; groupKey: TimeGroup }
  | (UnifiedSidebarItem & { key: string; groupKey: TimeGroup });

// Pagination state
interface PaginationState {
  items: UnifiedSidebarItem[];
  hasMore: boolean;
  loading: boolean;
  cursor: number | null;
}
```

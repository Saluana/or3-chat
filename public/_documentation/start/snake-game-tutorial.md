# Building Custom Pane Apps: A Complete Guide

Learn how to build fully-featured custom pane applications for OR3's multi-pane workspace. This tutorial walks through creating a **Snake Game** mini-app from scratch, covering data persistence, sidebar integration, and proper pane management patterns.

## Table of Contents

1. [What Are Pane Apps?](#what-are-pane-apps)
2. [Architecture Overview](#architecture-overview)
3. [Building the Snake Game](#building-the-snake-game)
4. [Data Persistence with Posts](#data-persistence-with-posts)
5. [Sidebar Integration](#sidebar-integration)
6. [Pane Management Patterns](#pane-management-patterns)
7. [Best Practices](#best-practices)
8. [Common Patterns](#common-patterns)

---

## What Are Pane Apps?

**Pane apps** are custom mini-applications that run inside OR3's multi-pane workspace alongside chats and documents. They:

-   Live in individual panes with full workspace integration
-   Can store data using custom post types
-   Add their own sidebar pages for navigation and management
-   Follow the same lifecycle as chat and document panes

**Use cases:**

-   Games and interactive experiences (our Snake Game example)
-   Task managers and productivity tools
-   Data visualization dashboards
-   Custom editors and viewers
-   Anything that benefits from workspace integration!

---

## Architecture Overview

A complete pane app has **three main components**:

```
app/plugins/my-app/
├── my-app.client.ts          # Plugin registration & initialization
├── MyAppPane.vue              # Main pane content
└── MyAppSidebar.vue           # Sidebar page
```

### The Registration Flow

```typescript
// 1. Plugin registers the pane app
defineNuxtPlugin(() => {
    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: 'my-app',
        label: 'My App',
        icon: 'pixelarticons:app',
        component: () => import('./MyAppPane.vue'),
        createInitialRecord: async ({ app }) => {
            // Create database record for this pane
            const post = await createPost({
                title: 'New Session',
                content: '',
                postType: 'my-app-data',
                meta: {
                    /* initial data */
                },
            });
            return { id: post.id };
        },
    });

    // 2. Register sidebar page
    registerSidebarPage({
        id: 'my-app-sidebar',
        label: 'My App',
        icon: 'pixelarticons:app',
        component: () => import('./MyAppSidebar.vue'),
        order: 100,
    });
});
```

**Key concepts:**

-   `registerPaneApp` makes your app available to the workspace
-   `createInitialRecord` is called when a new pane opens
-   `registerSidebarPage` adds navigation to the sidebar
-   Everything is lazy-loaded for performance

---

## Building the Snake Game

Let's build a complete snake game to demonstrate all the patterns. We'll start with the game logic, then add Vue integration, persistence, and UI.

### Step 1: Game Logic Class

Create `snake-game.ts` with the core game mechanics:

```typescript
import { reactive } from 'vue';

export type Direction = 'up' | 'down' | 'left' | 'right';

interface Position {
    x: number;
    y: number;
}

interface GameState {
    snake: Position[];
    food: Position;
    direction: Direction;
    score: number;
    highScore: number;
    gameOver: boolean;
    isPaused: boolean;
}

export class SnakeGame {
    private gridSize = 20;
    private cellSize = 20;
    private gameLoop: number | null = null;
    private baseSpeed = 150;

    // Make state reactive so Vue can track changes
    public state: GameState;

    constructor() {
        // Wrap state with reactive() for Vue reactivity
        this.state = reactive(this.getInitialState());
        this.loadHighScore();
    }

    private getInitialState(): GameState {
        return {
            snake: [{ x: 10, y: 10 }],
            food: this.generateFood([{ x: 10, y: 10 }]),
            direction: 'right',
            score: 0,
            highScore: 0,
            gameOver: false,
            isPaused: false,
        };
    }

    start() {
        // Reset by updating properties individually (preserves reactivity)
        const initial = this.getInitialState();
        this.state.snake = initial.snake;
        this.state.food = initial.food;
        this.state.direction = initial.direction;
        this.state.score = initial.score;
        this.state.gameOver = initial.gameOver;
        this.state.isPaused = initial.isPaused;

        this.stop();
        this.gameLoop = window.setInterval(() => this.update(), this.baseSpeed);
    }

    private update() {
        if (this.state.isPaused || this.state.gameOver) return;

        const head = { ...this.state.snake[0] };

        // Move head based on direction
        switch (this.state.direction) {
            case 'up':
                head.y--;
                break;
            case 'down':
                head.y++;
                break;
            case 'left':
                head.x--;
                break;
            case 'right':
                head.x++;
                break;
        }

        // Check wall collision
        if (
            head.x < 0 ||
            head.x >= this.gridSize ||
            head.y < 0 ||
            head.y >= this.gridSize
        ) {
            this.endGame();
            return;
        }

        // Check self collision
        if (this.state.snake.some((s) => s.x === head.x && s.y === head.y)) {
            this.endGame();
            return;
        }

        // Add new head
        this.state.snake.unshift(head);

        // Check food collision
        if (head.x === this.state.food.x && head.y === this.state.food.y) {
            this.state.score++;
            this.state.food = this.generateFood(this.state.snake);

            // Update high score
            if (this.state.score > this.state.highScore) {
                this.state.highScore = this.state.score;
                this.saveHighScore();
            }
        } else {
            // Remove tail if no food eaten
            this.state.snake.pop();
        }
    }

    changeDirection(newDirection: Direction) {
        // Prevent 180-degree turns
        const opposites = {
            up: 'down',
            down: 'up',
            left: 'right',
            right: 'left',
        };
        if (opposites[this.state.direction] === newDirection) return;
        this.state.direction = newDirection;
    }

    pause() {
        this.state.isPaused = !this.state.isPaused;
    }

    stop() {
        if (this.gameLoop !== null) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }

    private endGame() {
        this.state.gameOver = true;
        this.stop();
    }

    private generateFood(snake: Position[]): Position {
        let food: Position;
        do {
            food = {
                x: Math.floor(Math.random() * this.gridSize),
                y: Math.floor(Math.random() * this.gridSize),
            };
        } while (snake.some((s) => s.x === food.x && s.y === food.y));
        return food;
    }

    private loadHighScore() {
        const saved = localStorage.getItem('snake-high-score');
        if (saved) this.state.highScore = parseInt(saved, 10);
    }

    private saveHighScore() {
        localStorage.setItem(
            'snake-high-score',
            this.state.highScore.toString()
        );
    }

    getGridSize() {
        return this.gridSize;
    }
    getCellSize() {
        return this.cellSize;
    }
}
```

**Key patterns:**

-   Use `reactive()` to make class state observable by Vue
-   Update properties individually (not `this.state = {...}`) to preserve reactivity
-   Keep game logic separate from Vue components
-   Use `window.setInterval` with number type for browser compatibility

---

### Step 2: Pane Component

Create `SnakeGamePane.vue` to render the game in a pane:

```vue
<template>
    <div class="snake-game-pane">
        <div class="game-header">
            <h2>Snake Game</h2>
            <div class="game-stats">
                <div class="stat">
                    <span class="label">Score:</span>
                    <span class="value">{{ game.state.score }}</span>
                </div>
                <div class="stat">
                    <span class="label">High:</span>
                    <span class="value">{{ game.state.highScore }}</span>
                </div>
            </div>
            <button @click="closePane" class="close-btn">
                <UIcon name="pixelarticons:x" />
            </button>
        </div>

        <div class="game-container">
            <div
                class="game-board"
                :style="{ width: boardSize + 'px', height: boardSize + 'px' }"
                tabindex="0"
                @keydown="handleKeydown"
                ref="gameBoard"
            >
                <!-- Render snake segments -->
                <div
                    v-for="(segment, index) in game.state.snake"
                    :key="index"
                    class="snake-segment"
                    :class="{ head: index === 0 }"
                    :style="getSegmentStyle(segment)"
                />

                <!-- Render food -->
                <div class="food" :style="getSegmentStyle(game.state.food)" />

                <!-- Game over overlay -->
                <div v-if="game.state.gameOver" class="game-over">
                    <h3>Game Over!</h3>
                    <p>Final Score: {{ game.state.score }}</p>
                    <button @click="restartGame" class="btn">Play Again</button>
                </div>
            </div>
        </div>

        <div class="game-controls">
            <button @click="startGame" class="btn btn-primary">New Game</button>
            <button @click="game.pause" class="btn btn-secondary">
                {{ game.state.isPaused ? 'Resume' : 'Pause' }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { SnakeGame } from './snake-game';

// Props passed by PageShell to all pane apps
const props = defineProps<{
    paneId: string; // Unique pane ID
    recordId?: string | null; // Database record ID
    postApi?: any; // CRUD API for this pane's data
}>();

const gameBoard = ref<HTMLElement>();
const game = new SnakeGame();
const sessionStartTime = ref(Date.now());
const previousHighScore = ref(0);

const boardSize = computed(() => {
    return game.getGridSize() * game.getCellSize();
});

// Watch for game over to save the score
watch(
    () => game.state.gameOver,
    async (isGameOver) => {
        if (isGameOver && props.recordId && props.postApi) {
            await saveGameScore();
        }
    }
);

function getSegmentStyle(segment: { x: number; y: number }) {
    const cellSize = game.getCellSize();
    return {
        left: segment.x * cellSize + 'px',
        top: segment.y * cellSize + 'px',
        width: cellSize + 'px',
        height: cellSize + 'px',
    };
}

function handleKeydown(event: KeyboardEvent) {
    const keyMap: Record<string, () => void> = {
        ArrowUp: () => game.changeDirection('up'),
        ArrowDown: () => game.changeDirection('down'),
        ArrowLeft: () => game.changeDirection('left'),
        ArrowRight: () => game.changeDirection('right'),
        ' ': () => game.pause(),
        n: () => startGame(),
        N: () => startGame(),
    };

    const handler = keyMap[event.key];
    if (handler) {
        event.preventDefault();
        handler();
    }
}

function startGame() {
    game.start();
    sessionStartTime.value = Date.now();
    gameBoard.value?.focus();
}

function restartGame() {
    startGame();
}

function closePane() {
    game.stop();
    const multiPaneApi = (globalThis as any).__or3MultiPaneApi;
    if (!multiPaneApi) return;

    const index = multiPaneApi.panes.value.findIndex(
        (pane: any) => pane.id === props.paneId
    );
    if (index !== -1) {
        multiPaneApi.closePane(index);
    }
}

onMounted(() => {
    loadPreviousHighScore();
    gameBoard.value?.focus();
});

onUnmounted(() => {
    game.stop();
});
</script>
```

**Key patterns:**

-   Accept `paneId`, `recordId`, and `postApi` props (provided by PageShell)
-   Use `watch()` to react to game state changes
-   Access `__or3MultiPaneApi` for pane operations
-   Clean up in `onUnmounted` (stop game loops, clear intervals)

---

## Data Persistence with Posts

The `posts` table is OR3's flexible data store. Use custom `postType` values to create your own data schemas.

### Step 3: Score Persistence

Add score tracking using the `postApi`:

```typescript
// In SnakeGamePane.vue <script setup>

async function loadPreviousHighScore() {
    if (!props.postApi || !props.recordId) return;

    try {
        // Fetch this pane's record to get previous high score
        const result = await props.postApi.posts.get({
            id: props.recordId,
        });

        if (result.ok && result.post?.meta) {
            const meta = result.post.meta as any;
            if (typeof meta.score === 'number') {
                previousHighScore.value = meta.score;
            }
        }
    } catch (error) {
        console.error('Failed to load previous high score:', error);
    }
}

async function saveGameScore() {
    if (!props.postApi || !props.recordId) return;

    const currentScore = game.state.score;

    // Only save if the new score beats the previous high score
    if (currentScore <= previousHighScore.value) {
        if (import.meta.dev) {
            console.log('Score not saved - did not beat high score');
        }
        return;
    }

    const duration = Date.now() - sessionStartTime.value;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    const scoreData = {
        score: currentScore,
        startedAt: sessionStartTime.value,
        completedAt: Date.now(),
        duration,
        status: 'completed' as const,
        finalLength: game.state.snake.length,
    };

    try {
        const result = await props.postApi.update({
            id: props.recordId,
            patch: {
                title: `Score: ${currentScore}`,
                content: `Game lasted ${minutes}m ${seconds}s`,
                meta: scoreData,
            },
            source: 'snake-game-plugin',
        });

        if (result.ok) {
            // Update the previous high score to the new score
            previousHighScore.value = currentScore;
        }
    } catch (error) {
        console.error('Error saving score:', error);
    }
}
```

**Key patterns:**

-   Use `postApi.posts.get()` to load existing data
-   Use `postApi.update()` with a `patch` object to update
-   Store structured data in the `meta` field
-   Always include a `source` identifier for debugging
-   Validate before saving to prevent bad data

---

## Sidebar Integration

Sidebar pages provide navigation and management for your app's data.

### Step 4: Sidebar Page

Create `SnakeGameSidebar.vue`:

```vue
<template>
    <div class="snake-game-sidebar">
        <div class="sidebar-header">
            <h2>Snake Game</h2>
            <p>Classic arcade game - catch the food and grow!</p>
        </div>

        <div class="high-scores">
            <div class="scores-header">
                <h3>Recent Games</h3>
                <button
                    v-if="scores.length > 0"
                    @click="clearAllScores"
                    class="clear-btn"
                >
                    <UIcon name="pixelarticons:trash" />
                </button>
            </div>

            <div v-if="loading" class="loading-state">
                <p>Loading scores...</p>
            </div>

            <div v-else-if="scores.length === 0" class="empty-state">
                <p>No games played yet. Start your first game!</p>
            </div>

            <div v-else class="score-list">
                <div
                    v-for="(scoreData, index) in topScores"
                    :key="scoreData.id"
                    class="score-item"
                    :class="{ 'is-high-score': index === 0 }"
                >
                    <div class="score-rank">
                        <span class="rank">{{ index + 1 }}</span>
                        <UIcon
                            v-if="index === 0"
                            name="pixelarticons:trophy"
                            class="trophy-icon"
                        />
                    </div>
                    <div class="score-details">
                        <div class="score-value">{{ scoreData.score }}</div>
                        <div class="score-meta">
                            {{ formatTime(scoreData.completedAt) }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="actions">
            <button @click="openGame" class="btn btn-primary">
                <UIcon name="pixelarticons:play" />
                Play Game
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSidebarMultiPane, useSidebarPostsApi } from '~/composables/sidebar';
import { usePostsList } from '~/composables/posts/usePostsList';

interface SnakeGameMeta {
    score?: number;
    startedAt?: number;
    completedAt?: number;
    duration?: number;
    status?: 'in-progress' | 'completed';
    finalLength?: number;
}

const multiPane = useSidebarMultiPane();
const postsApi = useSidebarPostsApi();

// Use the posts list composable for live data
const {
    items: scores,
    loading,
    error,
    refresh,
} = usePostsList('snake-game-score', {
    limit: 100,
});

// Compute top scores sorted by score
const topScores = computed(() => {
    return scores.value
        .filter((post) => {
            const meta = post.meta as SnakeGameMeta;
            return (
                meta?.status === 'completed' && typeof meta?.score === 'number'
            );
        })
        .sort((a, b) => {
            const metaA = a.meta as SnakeGameMeta;
            const metaB = b.meta as SnakeGameMeta;
            return (metaB?.score || 0) - (metaA?.score || 0);
        })
        .slice(0, 10)
        .map((post) => {
            const meta = post.meta as SnakeGameMeta;
            return {
                id: post.id,
                score: meta?.score || 0,
                completedAt: meta?.completedAt || post.updated_at || Date.now(),
                duration: meta?.duration || 0,
            };
        });
});

function openGame() {
    // Use switchToApp to replace the current pane with the game
    multiPane.switchToApp('snake-game');
}

async function clearAllScores() {
    if (!confirm('Delete all game scores? This cannot be undone.')) {
        return;
    }

    try {
        for (const score of scores.value) {
            const result = await postsApi.posts.delete({
                id: score.id,
                source: 'snake-game-sidebar',
            });
            if (!result.ok) {
                console.error('Failed to delete score:', result.message);
            }
        }

        localStorage.removeItem('snake-high-score');
        await refresh();
    } catch (err) {
        console.error('Failed to clear scores:', err);
    }
}

function formatTime(timestamp: number) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}
</script>
```

**Key patterns:**

-   Use `usePostsList()` for live-updating data queries
-   Use `useSidebarMultiPane()` to control panes from sidebar
-   Use `useSidebarPostsApi()` for CRUD operations
-   Call `switchToApp()` to replace current pane (better than opening new)
-   Implement confirmation dialogs for destructive actions

---

## Pane Management Patterns

OR3 provides several patterns for managing panes. Understanding these is crucial for good UX.

### Pattern 1: Opening New Panes

```typescript
// Opens a new pane (if space available)
multiPane.openApp('my-app');

// Opens with existing record
multiPane.openApp('my-app', { initialRecordId: 'some-id' });
```

### Pattern 2: Switching Current Pane

```typescript
// Replaces the active pane (better UX for navigation)
multiPane.switchToApp('my-app');

// With existing record
multiPane.switchToApp('my-app', { recordId: 'some-id' });
```

**When to use each:**

-   Use `openApp` for "open in new window" actions
-   Use `switchToApp` for navigation from sidebar (mimics chat/doc behavior)

### Pattern 3: Updating Existing Panes

The multi-pane API recently added `setPaneApp()` which `switchToApp()` uses internally. This follows the same pattern as `setPaneThread()` for chats:

```typescript
// Direct pane switching (low-level)
const multiPaneApi = (globalThis as any).__or3MultiPaneApi;
await multiPaneApi.setPaneApp(paneIndex, 'my-app', { recordId: 'id' });
```

**Why this matters:**
Threads and documents don't close and reopen panes - they update the existing pane's properties. Your app should follow the same pattern for consistency:

```typescript
// ❌ Old pattern (causes flicker)
multiPane.closePane(currentIndex);
multiPane.openApp('my-app');

// ✅ New pattern (smooth transition)
multiPane.switchToApp('my-app');
```

---

### Step 5: Plugin Registration

Create `snake-game.client.ts` to wire everything together:

```typescript
export default defineNuxtPlugin(() => {
    const { registerPaneApp } = usePaneApps();

    // Register the pane app
    registerPaneApp({
        id: 'snake-game',
        label: 'Snake Game',
        icon: 'pixelarticons:gamepad',
        component: () => import('./SnakeGamePane.vue'),

        // Create a database record for each game session
        createInitialRecord: async ({ app }) => {
            try {
                const api = (globalThis as any).__or3PanePluginApi;
                if (!api?.posts?.create) {
                    console.error('[snake-game] Pane plugin API not available');
                    return { id: '' };
                }

                const result = await api.posts.create({
                    postType: 'snake-game-score',
                    title: 'New Game',
                    content: 'Game session started',
                    meta: {
                        score: 0,
                        startedAt: Date.now(),
                        status: 'in-progress',
                    },
                    source: 'snake-game-plugin',
                });

                if (!result.ok) {
                    console.error(
                        '[snake-game] Failed to create record:',
                        result.message
                    );
                    return { id: '' };
                }

                return { id: result.id };
            } catch (error) {
                console.error('[snake-game] Error creating record:', error);
                return { id: '' };
            }
        },
    });

    // Register sidebar page
    registerSidebarPage({
        id: 'snake-game-sidebar',
        label: 'Snake Game',
        icon: 'pixelarticons:gamepad',
        component: () => import('./SnakeGameSidebar.vue'),
        order: 100,
    });
});
```

**Key patterns:**

-   Use `defineNuxtPlugin` for client-side plugins
-   Always add `.client.ts` suffix for client-only plugins
-   Use lazy imports `() => import('./Component.vue')` for code splitting
-   Access global APIs via `globalThis.__or3PanePluginApi`
-   Always handle errors in `createInitialRecord`
-   Return `{ id: '' }` on error to prevent pane creation

---

## Best Practices

### 1. TypeScript Interfaces

Define strong types for your data:

```typescript
interface MyAppMeta {
    version: number;
    createdBy: string;
    customField: string;
    nestedData?: {
        foo: string;
        bar: number;
    };
}

// Use when reading
const meta = post.meta as MyAppMeta;
```

### 2. HMR-Safe Registrations

Always unregister on hot module replacement:

```typescript
export default defineNuxtPlugin(() => {
    const { registerPaneApp, unregisterPaneApp } = usePaneApps();

    const appId = 'my-app';

    // Register
    registerPaneApp({ id: appId /* ... */ });

    // Clean up on HMR
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterPaneApp(appId);
        });
    }
});
```

### 3. Error Boundaries

Wrap risky operations:

```typescript
async function riskyOperation() {
    try {
        const result = await someApiCall();
        if (!result.ok) {
            console.error('Operation failed:', result.message);
            // Show user-friendly error
            return;
        }
        // Success path
    } catch (error) {
        console.error('Unexpected error:', error);
        // Show generic error message
    }
}
```

### 4. Development Logging

Use conditional logging:

```typescript
if (import.meta.dev) {
    console.log('[my-app] Debug info:', data);
}
```

### 5. Cleanup

Always clean up resources:

```typescript
onUnmounted(() => {
    // Stop timers
    if (timerId) clearInterval(timerId);

    // Cancel pending requests
    abortController?.abort();

    // Release resources
    game.stop();
});
```

---

## Common Patterns

### Pattern: Live Query with Refresh

```typescript
const {
    items: myData,
    loading,
    error,
    refresh,
} = usePostsList('my-custom-type', {
    limit: 50,
});

// Manually refresh when needed
async function onDataChanged() {
    await refresh();
}
```

### Pattern: Filtered Computed Data

```typescript
const activeItems = computed(() => {
    return myData.value
        .filter((item) => {
            const meta = item.meta as MyMeta;
            return meta?.active === true;
        })
        .sort((a, b) => b.updated_at - a.updated_at);
});
```

### Pattern: Conditional Rendering

```typescript
<template>
  <div v-if="loading">Loading...</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <div v-else-if="items.length === 0">No items yet</div>
  <div v-else>
    <!-- Render items -->
  </div>
</template>
```

### Pattern: Keyboard Shortcuts

```typescript
function handleKeydown(event: KeyboardEvent) {
    const shortcuts: Record<string, () => void> = {
        Escape: () => closePane(),
        s: () => save(),
        n: () => createNew(),
    };

    // Check for modifiers
    if (event.ctrlKey || event.metaKey) {
        const handler = shortcuts[event.key];
        if (handler) {
            event.preventDefault();
            handler();
        }
    }
}
```

### Pattern: Debounced Input

```typescript
import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';

const searchQuery = ref('');
const debouncedSearch = useDebounceFn((query: string) => {
    performSearch(query);
}, 300);

watch(searchQuery, (newQuery) => {
    debouncedSearch(newQuery);
});
```

---

## Testing Your Pane App

### Manual Testing Checklist

-   [ ] App opens without errors
-   [ ] Data persists between sessions
-   [ ] Sidebar shows correct information
-   [ ] Pane closes cleanly
-   [ ] Multiple instances work correctly
-   [ ] HMR doesn't cause duplicates
-   [ ] Keyboard shortcuts work
-   [ ] Mobile/responsive layout works

### Development Tips

```typescript
// Add debug buttons in dev mode
const isDev = import.meta.dev;

<button v-if="isDev" @click="debugState">
  Debug State
</button>

function debugState() {
  console.log('App State:', {
    paneId: props.paneId,
    recordId: props.recordId,
    data: myData.value,
  });
}
```

---

## Next Steps

You now have a complete understanding of building custom pane apps! Here's what to explore next:

1. **Add more features** to your snake game:

    - Difficulty levels
    - Power-ups
    - Multiplayer via shared posts
    - Statistics and achievements

2. **Build something new**:

    - Todo list with priorities
    - Timer/Pomodoro app
    - Drawing canvas
    - Data visualizations
    - Custom calculators

3. **Advanced patterns**:

    - Real-time collaboration
    - File attachments
    - Export/import functionality
    - Integration with external APIs

4. **Study existing apps**:
    - Look at other plugins in `app/plugins/`
    - Check how documents work in `useDocumentsStore`
    - See how threads integrate with the workspace

---

## Complete Example Files

The complete snake game source code is available in:

-   `app/plugins/snake/snake-game.client.ts` - Registration
-   `app/plugins/snake/snake-game.ts` - Game logic
-   `app/plugins/snake/SnakeGamePane.vue` - Pane component
-   `app/plugins/snake/SnakeGameSidebar.vue` - Sidebar page

Study these files to see how everything fits together in a real application.

---

## Resources

-   [Plugin Quickstart Guide](/documentation/start/plugin-quickstart) - Basic plugin patterns
-   [useMultiPane Documentation](/documentation/composables/useMultiPane) - Pane management API
-   [Posts Database Documentation](/documentation/database/posts) - Data persistence
-   [Sidebar Pages Guide](/documentation/composables/useSidebarPages) - Sidebar integration
-   [Hooks System](/documentation/hooks/hooks) - Event system and extensibility

Happy building! 🎮

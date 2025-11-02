<!-- app/plugins/snake-game/SnakeGameSidebar.vue -->
<template>
    <div class="snake-game-sidebar max-h-[calc(100dvh-48px)] overflow-y-scroll">
        <div class="sidebar-header">
            <h2>Snake Game</h2>
            <p>Classic arcade game - catch the food and grow!</p>
        </div>

        <div class="game-preview">
            <div class="mini-game-board">
                <!-- Mini snake representation -->
                <div class="mini-snake">
                    <div class="snake-head"></div>
                    <div class="snake-body"></div>
                    <div class="snake-body"></div>
                </div>
                <div class="mini-food"></div>
            </div>
        </div>

        <div class="high-scores">
            <div class="scores-header">
                <h3>Recent Games</h3>
                <button
                    v-if="scores.length > 0"
                    @click="clearAllScores"
                    class="clear-btn"
                    title="Clear all scores"
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

        <div class="game-info">
            <h3>How to Play</h3>
            <ul class="instructions">
                <li>Use arrow keys to control the snake</li>
                <li>Eat the red food to grow</li>
                <li>Avoid hitting walls and yourself</li>
                <li>Game speeds up as you score more</li>
            </ul>
        </div>

        <div class="actions">
            <button @click="openGame" class="btn btn-primary">
                <UIcon name="pixelarticons:play" />
                Play Game
            </button>
            <button v-if="isDev" @click="debugScores" class="btn btn-secondary">
                <UIcon name="pixelarticons:bug" />
                Debug Scores
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useSidebarMultiPane, useSidebarPostsApi } from '~/composables/sidebar/useSidebarEnvironment';
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

// Development mode flag
const isDev = import.meta.dev;

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
    if (isDev) {
        console.log('[SnakeGameSidebar] Computing scores', {
            totalScores: scores.value.length,
            scores: scores.value.map((s) => ({
                id: s.id,
                title: s.title,
                meta: s.meta,
            })),
        });
    }

    return scores.value
        .filter((post) => {
            const meta = post.meta as SnakeGameMeta;
            const isCompleted = meta?.status === 'completed';
            const hasScore = typeof meta?.score === 'number';

            if (isDev && !isCompleted) {
                console.log(
                    '[SnakeGameSidebar] Filtering out incomplete game:',
                    {
                        id: post.id,
                        status: meta?.status,
                        hasScore,
                    }
                );
            }

            return isCompleted && hasScore;
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
    if (
        !confirm(
            'Are you sure you want to delete all game scores? This cannot be undone.'
        )
    ) {
        return;
    }

    try {
        // Delete all snake game score posts
        for (const score of scores.value) {
            const result = await postsApi.posts.delete({
                id: score.id,
                source: 'snake-game-sidebar',
            });
            if (!result.ok) {
                console.error('[SnakeGameSidebar] Failed to delete score:', {
                    id: score.id,
                    error: result.message,
                });
            }
        }

        // Also clear localStorage high score
        localStorage.removeItem('snake-high-score');

        // Refresh the list
        await refresh();
    } catch (err) {
        console.error('[SnakeGameSidebar] Failed to clear scores:', err);
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

function debugScores() {
    console.log('[SnakeGameSidebar] Debug Info', {
        totalPosts: scores.value.length,
        loading: loading.value,
        error: error.value,
        topScores: topScores.value,
        allScores: scores.value.map((s) => ({
            id: s.id,
            title: s.title,
            postType: s.postType,
            meta: s.meta,
            created: s.created_at,
            updated: s.updated_at,
        })),
    });
    alert('Check console for debug info');
}

onMounted(() => {
    // Initial load is handled by usePostsList
});
</script>

<style scoped>
.snake-game-sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
}

.sidebar-header h2 {
    margin: 0 0 0.5rem 0;
    color: var(--md-primary);
}

.sidebar-header p {
    margin: 0;
    opacity: 0.7;
    font-size: 0.875rem;
}

.game-preview {
    display: flex;
    justify-content: center;
}

.mini-game-board {
    position: relative;
    width: 120px;
    height: 120px;
    background: var(--md-surface-container);
    border: 2px solid var(--md-outline);
    border-radius: 8px;
}

.mini-snake {
    position: absolute;
    top: 50%;
    left: 30%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
}

.snake-head {
    width: 8px;
    height: 8px;
    background: var(--md-primary);
    border-radius: 2px;
}

.snake-body {
    width: 8px;
    height: 8px;
    background: var(--md-primary-container);
    border-radius: 2px;
    margin-left: 2px;
}

.mini-food {
    position: absolute;
    top: 30%;
    right: 25%;
    width: 8px;
    height: 8px;
    background: var(--md-error);
    border-radius: 50%;
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.2);
    }
}

.high-scores h3,
.game-info h3 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    color: var(--md-on-surface);
}

.scores-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
}

.scores-header h3 {
    margin: 0;
}

.clear-btn {
    background: none;
    border: none;
    color: var(--md-on-surface-variant);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    transition: all 0.2s;
}

.clear-btn:hover {
    background: var(--md-surface-variant);
    color: var(--md-error);
}

.loading-state,
.empty-state {
    padding: 2rem 1rem;
    text-align: center;
    opacity: 0.6;
    font-size: 0.875rem;
}

.score-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
}

.score-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--md-surface-container);
    border-radius: 6px;
    transition: all 0.2s;
}

.score-item.is-high-score {
    background: var(--md-primary-container);
    border: 2px solid var(--md-primary);
}

.score-rank {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.rank {
    font-weight: 600;
    color: var(--md-primary);
    min-width: 20px;
    font-size: 1rem;
}

.trophy-icon {
    color: var(--md-primary);
    font-size: 1rem;
}

.score-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
}

.score-value {
    font-weight: 600;
    font-size: 1.125rem;
    color: var(--md-on-surface);
}

.score-meta {
    font-size: 0.75rem;
    opacity: 0.6;
}

.instructions {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.875rem;
    line-height: 1.5;
    opacity: 0.8;
}

.instructions li {
    margin-bottom: 0.25rem;
}

.actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: auto;
}

.btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-primary {
    background: var(--md-primary);
    color: var(--md-on-primary);
}

.btn-primary:hover {
    background: var(--md-primary-container);
}

.btn-secondary {
    background: var(--md-surface-variant);
    color: var(--md-on-surface-variant);
}

.btn-secondary:hover {
    background: var(--md-surface-container-high);
}
</style>

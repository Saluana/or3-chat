<!-- app/plugins/snake-game/SnakeGamePane.vue -->
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
                :style="{
                    width: boardSize + 'px',
                    height: boardSize + 'px',
                }"
                tabindex="0"
                @keydown="handleKeydown"
                ref="gameBoard"
            >
                <!-- Snake -->
                <div
                    v-for="(segment, index) in game.state.snake"
                    :key="index"
                    class="snake-segment"
                    :class="{ head: index === 0 }"
                    :style="getSegmentStyle(segment)"
                />

                <!-- Food -->
                <div class="food" :style="getSegmentStyle(game.state.food)" />

                <!-- Game Over Overlay -->
                <div v-if="game.state.gameOver" class="game-over">
                    <h3>Game Over!</h3>
                    <p>Final Score: {{ game.state.score }}</p>
                    <button @click="restartGame" class="btn">Play Again</button>
                </div>

                <!-- Paused Overlay -->
                <div
                    v-if="game.state.isPaused && !game.state.gameOver"
                    class="paused"
                >
                    <h3>Paused</h3>
                    <p>Press Space to continue</p>
                </div>
            </div>
        </div>

        <div class="game-controls">
            <div class="control-row">
                <button @click="startGame" class="btn btn-primary">
                    New Game
                </button>
                <button @click="game.pause" class="btn btn-secondary">
                    {{ game.state.isPaused ? 'Resume' : 'Pause' }}
                </button>
            </div>

            <div class="instructions">
                <p><strong>Controls:</strong></p>
                <p>Arrow Keys: Move snake</p>
                <p>Space: Pause/Resume</p>
                <p>N: New game</p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { SnakeGame } from './snake-game';

const props = defineProps<{
    paneId: string;
    recordId?: string | null;
    postApi?: any;
}>();

const gameBoard = ref<HTMLElement>();
const game = new SnakeGame();
const sessionStartTime = ref(Date.now());
const previousHighScore = ref(0);

const boardSize = computed(() => {
    const gridSize = game.getGridSize();
    const cellSize = game.getCellSize();
    return gridSize * cellSize;
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

async function saveGameScore() {
    if (!props.postApi || !props.recordId) return;

    const currentScore = game.state.score;

    // Only save if the new score beats the previous high score
    if (currentScore <= previousHighScore.value) {
        if (import.meta.dev) {
            console.log(
                '[SnakeGamePane] Score not saved - did not beat previous high score:',
                {
                    currentScore,
                    previousHighScore: previousHighScore.value,
                }
            );
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

    if (import.meta.dev) {
        console.log('[SnakeGamePane] Saving new high score:', {
            recordId: props.recordId,
            scoreData,
            previousHighScore: previousHighScore.value,
        });
    }

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

        if (!result.ok) {
            console.error(
                '[SnakeGamePane] Failed to save score:',
                result.message
            );
        } else {
            // Update the previous high score to the new score
            previousHighScore.value = currentScore;

            if (import.meta.dev) {
                console.log('[SnakeGamePane] Score saved successfully', {
                    score: currentScore,
                    recordId: props.recordId,
                });
            }
        }
    } catch (error) {
        console.error('[SnakeGamePane] Error saving score:', error);
    }
}

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
    switch (event.key) {
        case 'ArrowUp':
            event.preventDefault();
            game.changeDirection('up');
            break;
        case 'ArrowDown':
            event.preventDefault();
            game.changeDirection('down');
            break;
        case 'ArrowLeft':
            event.preventDefault();
            game.changeDirection('left');
            break;
        case 'ArrowRight':
            event.preventDefault();
            game.changeDirection('right');
            break;
        case ' ':
            event.preventDefault();
            game.pause();
            break;
        case 'n':
        case 'N':
            event.preventDefault();
            startGame();
            break;
    }
}

function startGame() {
    game.start();
    sessionStartTime.value = Date.now();
    gameBoard.value?.focus();
}

function restartGame() {
    game.start();
    sessionStartTime.value = Date.now();
    gameBoard.value?.focus();
}

function closePane() {
    game.stop();
    const multiPaneApi = (globalThis as any).__or3MultiPaneApi;
    if (!multiPaneApi) {
        console.warn('[SnakeGamePane] Multi-pane API not available');
        return;
    }
    const index = multiPaneApi.panes.value.findIndex(
        (pane: any) => pane.id === props.paneId
    );
    if (index !== -1) {
        multiPaneApi.closePane(index);
    }
}

async function loadPreviousHighScore() {
    if (!props.postApi || !props.recordId) return;

    try {
        // Fetch the specific post to get the previous high score
        const result = await props.postApi.posts.get({
            id: props.recordId,
        });

        if (result.ok && result.post?.meta) {
            const meta = result.post.meta as any;
            if (typeof meta.score === 'number') {
                previousHighScore.value = meta.score;
                if (import.meta.dev) {
                    console.log('[SnakeGamePane] Loaded previous high score:', {
                        score: previousHighScore.value,
                        recordId: props.recordId,
                    });
                }
            }
        }
    } catch (error) {
        console.error(
            '[SnakeGamePane] Error loading previous high score:',
            error
        );
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

<style scoped>
.snake-game-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--md-surface);
    color: var(--md-on-surface);
}

.game-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--md-outline-variant);
}

.game-header h2 {
    margin: 0;
    color: var(--md-primary);
}

.game-stats {
    display: flex;
    gap: 1rem;
}

.stat {
    display: flex;
    gap: 0.25rem;
    font-size: 0.875rem;
}

.stat .label {
    opacity: 0.7;
}

.stat .value {
    font-weight: 600;
    color: var(--md-primary);
}

.close-btn {
    background: none;
    border: none;
    color: var(--md-on-surface-variant);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    transition: background-color 0.2s;
}

.close-btn:hover {
    background: var(--md-surface-variant);
}

.game-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1rem;
}

.game-board {
    position: relative;
    background: var(--md-surface-container);
    border: 2px solid var(--md-outline);
    border-radius: 8px;
    outline: none;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.snake-segment {
    position: absolute;
    background: var(--md-primary);
    border-radius: 2px;
    transition: all 0.1s ease-out;
}

.snake-segment.head {
    background: var(--md-primary-container);
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
}

.food {
    position: absolute;
    background: var(--md-error);
    border-radius: 50%;
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.1);
    }
}

.game-over,
.paused {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    border-radius: 6px;
}

.game-over h3,
.paused h3 {
    margin: 0 0 1rem 0;
    font-size: 1.5rem;
}

.game-over p,
.paused p {
    margin: 0 0 1.5rem 0;
    opacity: 0.9;
}

.game-controls {
    padding: 1rem;
    border-top: 1px solid var(--md-outline-variant);
}

.control-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
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

.instructions {
    font-size: 0.875rem;
    opacity: 0.7;
    line-height: 1.4;
}

.instructions strong {
    color: var(--md-on-surface);
}
</style>

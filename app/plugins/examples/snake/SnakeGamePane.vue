<!-- app/plugins/snake-game/SnakeGamePane.vue -->
<template>
    <div class="snake-game-pane" ref="paneRef">
        <div class="game-header">
            <div class="header-content">
                <div class="title-section">
                    <div class="icon-box">
                        <UIcon name="pixelarticons:gamepad" />
                    </div>
                    <h2>Snake</h2>
                </div>
                
                <div class="score-board">
                    <div class="score-badge">
                        <span class="label">SCORE</span>
                        <span class="value">{{ game.state.score }}</span>
                    </div>
                    <div class="score-divider"></div>
                    <div class="score-badge high-score">
                        <span class="label">BEST</span>
                        <span class="value">{{ game.state.highScore }}</span>
                    </div>
                </div>
            </div>

            <button @click="closePane" class="close-btn" title="Close Game">
                <UIcon name="pixelarticons:close" />
            </button>
        </div>

        <div class="game-area">
            <div
                class="game-board-container"
                ref="boardContainer"
                tabindex="0"
                @keydown="handleKeydown"
            >
                <div class="game-board" :style="boardStyle">
                    <!-- Grid Background -->
                    <div class="grid-background"></div>

                    <!-- Snake -->
                    <div
                        v-for="(segment, index) in game.state.snake"
                        :key="index"
                        class="snake-segment"
                        :class="{ head: index === 0 }"
                        :style="getSegmentStyle(segment, index)"
                    >
                        <div v-if="index === 0" class="snake-eyes" :class="game.state.direction">
                            <div class="eye left"></div>
                            <div class="eye right"></div>
                        </div>
                    </div>

                    <!-- Food -->
                    <div 
                        class="food" 
                        :key="`${game.state.food.x}-${game.state.food.y}`"
                        :style="getSegmentStyle(game.state.food)"
                    >
                        <div class="food-glow"></div>
                    </div>

                    <!-- Start Screen -->
                    <div v-if="!gameStarted && !game.state.gameOver" class="overlay start-screen">
                        <div class="overlay-content">
                            <UIcon name="pixelarticons:gamepad" class="game-icon" />
                            <h3>Ready to Play?</h3>
                            <p>Use arrow keys to move</p>
                            <button @click="startGame" class="btn btn-primary btn-lg">
                                <UIcon name="pixelarticons:play" />
                                Start Game
                            </button>
                        </div>
                    </div>

                    <!-- Game Over Overlay -->
                    <div v-if="game.state.gameOver" class="overlay game-over">
                        <div class="overlay-content">
                            <div class="game-over-icon">
                                <UIcon name="pixelarticons:mood-sad" />
                            </div>
                            <h3>Game Over!</h3>
                            <div class="final-score">
                                <span class="label">Final Score</span>
                                <span class="value">{{ game.state.score }}</span>
                            </div>
                            <div class="actions">
                                <button @click="restartGame" class="btn btn-primary btn-lg">
                                    <UIcon name="pixelarticons:reload" />
                                    Play Again
                                </button>
                                <button @click="closePane" class="btn btn-secondary">
                                    Exit
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Paused Overlay -->
                    <div
                        v-if="game.state.isPaused && !game.state.gameOver && gameStarted"
                        class="overlay paused"
                    >
                        <div class="overlay-content">
                            <UIcon name="pixelarticons:pause" class="pause-icon" />
                            <h3>Paused</h3>
                            <button @click="game.pause()" class="btn btn-primary">
                                Resume
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="game-controls-hint">
            <div class="hint-item">
                <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> Move
            </div>
            <div class="hint-item">
                <kbd>Space</kbd> Pause
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { SnakeGame } from './snake-game';
import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';

const props = defineProps<{
    paneId: string;
    recordId?: string | null;
    postApi?: any;
}>();

const boardContainer = ref<HTMLElement>();
const paneRef = ref<HTMLElement>();
const game = new SnakeGame();
const gameStarted = ref(false);
const sessionStartTime = ref(Date.now());
const previousHighScore = ref(0);

// Calculate segment size as percentage
const segmentSize = computed(() => 100 / game.getGridSize());

const boardStyle = computed(() => ({
    '--grid-size': game.getGridSize(),
}));

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
            previousHighScore.value = currentScore;
        }
    } catch (error) {
        console.error('[SnakeGamePane] Error saving score:', error);
    }
}

function getSegmentStyle(segment: { x: number; y: number }, index?: number) {
    const size = segmentSize.value;
    return {
        left: `${segment.x * size}%`,
        top: `${segment.y * size}%`,
        width: `${size}%`,
        height: `${size}%`,
        zIndex: index === 0 ? 2 : 1, // Head on top
        transitionDuration: `${game.state.speed}ms`,
    };
}

function handleKeydown(event: KeyboardEvent) {
    // Prevent default scrolling for game keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
        event.preventDefault();
    }

    if (!gameStarted.value) {
        if (event.key === 'Enter' || event.key === ' ') {
            startGame();
        }
        return;
    }

    switch (event.key) {
        case 'ArrowUp':
            game.changeDirection('up');
            break;
        case 'ArrowDown':
            game.changeDirection('down');
            break;
        case 'ArrowLeft':
            game.changeDirection('left');
            break;
        case 'ArrowRight':
            game.changeDirection('right');
            break;
        case ' ':
            game.pause();
            break;
    }
}

function startGame() {
    gameStarted.value = true;
    game.start();
    sessionStartTime.value = Date.now();
    boardContainer.value?.focus();
}

function restartGame() {
    game.start();
    sessionStartTime.value = Date.now();
    boardContainer.value?.focus();
}

function closePane() {
    game.stop();
    const multiPaneApi = getGlobalMultiPaneApi();
    if (multiPaneApi) {
        const index = multiPaneApi.panes.value.findIndex(
            (pane) => pane.id === props.paneId
        );
        if (index !== -1) {
            multiPaneApi.closePane(index);
        }
    }
}

async function loadPreviousHighScore() {
    if (!props.postApi || !props.recordId) return;

    try {
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
        console.error('[SnakeGamePane] Error loading previous high score:', error);
    }
}

onMounted(() => {
    loadPreviousHighScore();
    // Focus the board so keys work immediately if clicked
    boardContainer.value?.focus();
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
    overflow: hidden;
    font-family: 'Inter', sans-serif;
}

.game-header {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem 2rem;
    background: var(--md-surface-container);
    border-bottom: 1px solid var(--md-outline-variant);
    min-height: 80px;
}

.header-content {
    display: flex;
    align-items: center;
    gap: 3rem;
}

.title-section {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-radius: 12px;
    font-size: 1.5rem;
}

.game-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--md-on-surface);
    letter-spacing: -0.025em;
}

.score-board {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    background: var(--md-surface);
    padding: 0.5rem 1.5rem;
    border-radius: 100px;
    border: 1px solid var(--md-outline-variant);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.score-divider {
    width: 1px;
    height: 24px;
    background: var(--md-outline-variant);
}

.score-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 60px;
}

.score-badge .label {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--md-on-surface-variant);
    font-weight: 700;
    margin-bottom: 2px;
}

.score-badge .value {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1;
    color: var(--md-primary);
    font-feature-settings: "tnum";
}

.score-badge.high-score .value {
    color: var(--md-warning);
}

.close-btn {
    position: absolute;
    right: 1.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--md-on-surface-variant);
    cursor: pointer;
    padding: 0.75rem;
    border-radius: 50%;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
}

.close-btn:hover {
    background: var(--md-surface-container-highest);
    color: var(--md-error);
    transform: translateY(-50%) rotate(90deg);
}

.game-area {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    background: var(--md-surface-container-low);
    overflow: hidden;
}

.game-board-container {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 600px; /* Limit max size for playability */
    max-height: 600px;
    aspect-ratio: 1/1;
    outline: none;
}

.game-board {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--md-surface);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    border: 4px solid var(--md-surface-container-highest);
}

.grid-background {
    position: absolute;
    inset: 0;
    background-image: 
        linear-gradient(var(--md-surface-container-highest) 1px, transparent 1px),
        linear-gradient(90deg, var(--md-surface-container-highest) 1px, transparent 1px);
    background-size: calc(100% / var(--grid-size)) calc(100% / var(--grid-size));
    opacity: 0.1;
}

.snake-segment {
    position: absolute;
    background: var(--md-primary);
    border-radius: 25%;
    transition: left linear, top linear;
    box-shadow: 0 0 10px rgba(var(--md-primary-rgb), 0.3);
    transform: scale(0.92); /* Slight gap between segments */
}

.snake-segment.head {
    background: var(--md-primary-container);
    border-radius: 35%;
    z-index: 10;
    box-shadow: 0 0 15px var(--md-primary);
}

.snake-eyes {
    position: absolute;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: flex-start; /* Eyes at the front (top) */
    padding: 15%;
    box-sizing: border-box;
}

.eye {
    width: 30%;
    height: 30%;
    background: var(--md-on-primary-container);
    border-radius: 50%;
    box-shadow: 0 0 2px rgba(0,0,0,0.5);
}

/* Eye positioning based on direction */
.snake-eyes.up { transform: rotate(0deg); }
.snake-eyes.right { transform: rotate(90deg); }
.snake-eyes.down { transform: rotate(180deg); }
.snake-eyes.left { transform: rotate(270deg); }

.food {
    position: absolute;
    background: var(--md-tertiary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 15px var(--md-tertiary);
    /* Combine animations: spawn (once) and float (loop) */
    animation: spawn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), float 2s ease-in-out infinite;
    transition: none !important; /* Ensure no sliding */
}

.food-glow {
    width: 40%;
    height: 40%;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    filter: blur(2px);
}

@keyframes spawn {
    0% {
        transform: scale(0);
        opacity: 0;
    }
    100% {
        transform: scale(0.8); /* Match the float scale start */
        opacity: 1;
    }
}

@keyframes float {
    0%, 100% { transform: scale(0.8); }
    50% { transform: scale(0.9); }
}

.overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
    animation: fadeIn 0.3s ease-out;
}

.overlay-content {
    background: var(--md-surface);
    padding: 2rem;
    border-radius: 16px;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    border: 1px solid var(--md-outline-variant);
    max-width: 80%;
    width: 320px;
}

.game-icon {
    font-size: 3rem;
    color: var(--md-primary);
    margin-bottom: 1rem;
}

.game-over-icon {
    font-size: 3rem;
    color: var(--md-error);
    margin-bottom: 1rem;
    animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
}

@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}

.overlay h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    color: var(--md-on-surface);
}

.overlay p {
    color: var(--md-on-surface-variant);
    margin-bottom: 1.5rem;
}

.final-score {
    margin: 1.5rem 0;
    padding: 1rem;
    background: var(--md-surface-container);
    border-radius: 8px;
}

.final-score .label {
    display: block;
    font-size: 0.875rem;
    color: var(--md-on-surface-variant);
    margin-bottom: 0.25rem;
}

.final-score .value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--md-primary);
}

.actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
}

.btn-lg {
    padding: 0.875rem 2rem;
    font-size: 1.125rem;
}

.btn-primary {
    background: var(--md-primary);
    color: var(--md-on-primary);
}

.btn-primary:hover {
    background: var(--md-primary-container);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(var(--md-primary-rgb), 0.3);
}

.btn-secondary {
    background: transparent;
    color: var(--md-on-surface-variant);
    border: 1px solid var(--md-outline);
}

.btn-secondary:hover {
    background: var(--md-surface-container-high);
    color: var(--md-on-surface);
}

.game-controls-hint {
    display: flex;
    justify-content: center;
    gap: 2rem;
    padding: 1rem;
    background: var(--md-surface-container);
    border-top: 1px solid var(--md-outline-variant);
}

.hint-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--md-on-surface-variant);
}

kbd {
    background: var(--md-surface-container-highest);
    border: 1px solid var(--md-outline-variant);
    border-radius: 4px;
    padding: 0.125rem 0.375rem;
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--md-on-surface);
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
</style>

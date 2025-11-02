// app/plugins/snake-game/game/SnakeGame.ts
import { reactive } from 'vue';

export interface Position {
    x: number;
    y: number;
}

export interface GameState {
    snake: Position[];
    food: Position;
    direction: 'up' | 'down' | 'left' | 'right';
    gameOver: boolean;
    score: number;
    highScore: number;
    isPaused: boolean;
    speed: number;
}

export class SnakeGame {
    private readonly GRID_SIZE = 20;
    private readonly CELL_SIZE = 20;

    public state: GameState;
    private gameLoop: number | null = null;
    private lastUpdate: number = 0;

    constructor() {
        this.state = reactive(this.getInitialState()) as GameState;
    }

    private getInitialState(): GameState {
        return {
            snake: [
                { x: 10, y: 10 },
                { x: 9, y: 10 },
                { x: 8, y: 10 },
            ],
            food: this.generateFood(),
            direction: 'right',
            gameOver: false,
            score: 0,
            highScore: parseInt(
                localStorage.getItem('snake-high-score') || '0'
            ),
            isPaused: false,
            speed: 100,
        };
    }

    private generateFood(): Position {
        let food: Position;
        const currentSnake = this.state?.snake || [];
        do {
            food = {
                x: Math.floor(Math.random() * this.GRID_SIZE),
                y: Math.floor(Math.random() * this.GRID_SIZE),
            };
        } while (
            currentSnake.some(
                (segment) => segment.x === food.x && segment.y === food.y
            )
        );
        return food;
    }

    public start(): void {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
        }

        const newState = this.getInitialState();
        // Update state properties instead of replacing the whole object
        this.state.snake = newState.snake;
        this.state.food = newState.food;
        this.state.direction = newState.direction;
        this.state.gameOver = newState.gameOver;
        this.state.score = newState.score;
        this.state.highScore = Math.max(
            this.state.highScore,
            newState.highScore
        );
        this.state.isPaused = newState.isPaused;
        this.state.speed = newState.speed;

        this.gameLoop = setInterval(
            () => this.update(),
            this.state.speed
        ) as any;
    }

    public pause(): void {
        this.state.isPaused = !this.state.isPaused;
    }

    public stop(): void {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }

    public changeDirection(
        newDirection: 'up' | 'down' | 'left' | 'right'
    ): void {
        if (this.state.gameOver || this.state.isPaused) return;

        const opposites: Record<string, string> = {
            up: 'down',
            down: 'up',
            left: 'right',
            right: 'left',
        };

        if (opposites[newDirection] !== this.state.direction) {
            this.state.direction = newDirection;
        }
    }

    private update(): void {
        if (this.state.gameOver || this.state.isPaused) return;

        if (this.state.snake.length === 0) return;

        const head: Position = {
            x: this.state.snake[0]!.x,
            y: this.state.snake[0]!.y,
        };

        switch (this.state.direction) {
            case 'up':
                head.y -= 1;
                break;
            case 'down':
                head.y += 1;
                break;
            case 'left':
                head.x -= 1;
                break;
            case 'right':
                head.x += 1;
                break;
        }

        // Check wall collision
        if (
            head.x < 0 ||
            head.x >= this.GRID_SIZE ||
            head.y < 0 ||
            head.y >= this.GRID_SIZE
        ) {
            this.gameOver();
            return;
        }

        // Check self collision
        if (
            this.state.snake.some(
                (segment) => segment.x === head.x && segment.y === head.y
            )
        ) {
            this.gameOver();
            return;
        }

        this.state.snake.unshift(head);

        // Check food collision
        if (head.x === this.state.food.x && head.y === this.state.food.y) {
            this.state.score += 10;
            this.state.food = this.generateFood();

            // Increase speed every 50 points
            if (this.state.score % 50 === 0 && this.state.speed > 50) {
                this.state.speed -= 10;
                this.stop();
                this.gameLoop = setInterval(
                    () => this.update(),
                    this.state.speed
                ) as any;
            }
        } else {
            this.state.snake.pop();
        }
    }

    private gameOver(): void {
        this.state.gameOver = true;
        if (this.state.score > this.state.highScore) {
            this.state.highScore = this.state.score;
            localStorage.setItem(
                'snake-high-score',
                this.state.highScore.toString()
            );
        }
        this.stop();
    }

    public getGridSize(): number {
        return this.GRID_SIZE;
    }

    public getCellSize(): number {
        return this.CELL_SIZE;
    }
}

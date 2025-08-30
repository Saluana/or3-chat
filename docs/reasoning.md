# Reasoning Tokens Support

This document describes the reasoning tokens feature that captures and displays AI model reasoning content in assistant messages.

## Overview

The reasoning feature allows users to view the internal reasoning process of compatible AI models (like DeepSeek R1, OpenAI o3, etc.) both during live streaming and after message completion.

## How It Works

### Capture

-   During streaming, reasoning tokens are accumulated in a throttled buffer
-   Final reasoning is extracted and stored in `Message.data.reasoning_content`
-   Supports both `reasoning` string and `reasoning_details` array formats

### Display

-   Uses a collapsible `ReasoningAccordion` component
-   Shows "Thinking…" placeholder for streaming messages from compatible models
-   Displays raw reasoning text in a monospace, scrollable area
-   Maintains consistent styling with the retro theme

### Integration

-   Automatically detects reasoning-capable models
-   Zero layout shift during streaming
-   Accessible with proper ARIA attributes
-   Memory-safe with truncation for extremely long content

## Usage

The feature works automatically for supported models. Users can:

1. See reasoning appear live during message generation
2. Click "Show reasoning" to expand the reasoning section
3. View the complete reasoning process above the final answer
4. Collapse reasoning to reduce clutter

## Technical Details

-   **Components**: `ReasoningAccordion.vue`
-   **Utilities**: `extractReasoning()`, `modelSupportsReasoning()` in `utils/models-service.ts`
-   **Streaming**: Throttled updates (80-120ms) to prevent performance issues
-   **Storage**: Persisted in `Message.data` without schema changes
-   **Styling**: Retro theme with pixel borders and VT323 font

## Requirements Met

-   R1: Capture & persist reasoning content
-   R2: Display collapsible reasoning UI
-   R3: Safe fallback when absent
-   R4: Live streaming display
-   R5: Reusable component architecture

All non-functional requirements for performance, accessibility, and minimal footprint are satisfied.

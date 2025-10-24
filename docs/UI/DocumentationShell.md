# DocumentationShell Component

A retro-styled documentation layout component with integrated search, navigation, table of contents, and markdown rendering using StreamMarkdown.

## Overview

`DocumentationShell` provides a complete VueUse-style documentation interface with:

-   **Three-column layout**: Sidebar navigation, main content area, and table of contents
-   **Integrated search**: Orama-powered search with debouncing (only loaded on `/documentation` routes)
-   **Markdown rendering**: StreamMarkdown with syntax highlighting, math support, and retro styling
-   **Theme support**: Integrates with your existing theme plugin
-   **Responsive design**: TOC hidden on smaller screens, scrollable sections

## Installation

The component is already available in your project. StreamMarkdown and its dependencies are pre-installed:

```bash
# Already installed
streamdown-vue
katex
@orama/orama
```

## Basic Usage

### Simple Page

```vue
<template>
    <DocumentationShell :content="markdown" />
</template>

<script setup lang="ts">
const markdown = ref(`
# Welcome to Documentation

This is a **simple** example with _markdown_ support.

\`\`\`typescript
const example = 'code highlighting works!';
\`\`\`
`);
</script>
```

### With Custom Navigation

```vue
<template>
    <DocumentationShell
        :content="markdown"
        :navigation="customNav"
        :show-toc="true"
        :toc="tableOfContents"
    />
</template>

<script setup lang="ts">
const customNav = [
    {
        label: 'Getting Started',
        items: [
            { label: 'Introduction', path: '/documentation' },
            { label: 'Installation', path: '/documentation/installation' },
        ],
    },
    {
        label: 'API',
        items: [
            { label: 'Components', path: '/documentation/components' },
            { label: 'Composables', path: '/documentation/composables' },
        ],
    },
];

const tableOfContents = [
    { id: 'overview', text: 'Overview', level: 2 },
    { id: 'features', text: 'Features', level: 2 },
    { id: 'advanced', text: 'Advanced Usage', level: 3 },
];

const markdown = ref('# Your documentation content...');
</script>
```

## Props

| Prop         | Type            | Default               | Description                             |
| ------------ | --------------- | --------------------- | --------------------------------------- |
| `content`    | `string`        | `undefined`           | Markdown content to render              |
| `navigation` | `NavCategory[]` | Default nav structure | Sidebar navigation items                |
| `showToc`    | `boolean`       | `true`                | Show table of contents in right sidebar |
| `toc`        | `TocItem[]`     | `[]`                  | Table of contents entries               |

### Type Definitions

```typescript
interface NavItem {
    label: string;
    path: string;
}

interface NavCategory {
    label: string;
    items: NavItem[];
}

interface TocItem {
    id: string; // Anchor ID (without #)
    text: string; // Display text
    level: number; // Heading level (2, 3, 4)
}
```

## Features

### 1. Markdown Rendering

Powered by `streamdown-vue` with full support for:

-   **GitHub Flavored Markdown**: Tables, task lists, strikethrough
-   **Syntax Highlighting**: Shiki with retro-styled code blocks
-   **Math**: KaTeX for LaTeX expressions (display and inline)
-   **Mermaid**: Diagram support
-   **Security**: URL hardening for links and images

#### Math Examples

```markdown
Display math:

$$
e^{i\pi} + 1 = 0
$$

Inline math: \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)
```

#### Code Blocks

````markdown
```typescript
const greet = (name: string) => {
    console.log(`Hello, ${name}!`);
};
```
````

Includes:

-   Language badge
-   Copy button
-   Download button
-   Retro-styled borders and shadows

### 2. Search Functionality

Search is **automatically initialized** only when on `/documentation` routes:

-   **Debounced**: 120ms delay
-   **Orama-powered**: Fast, client-side search
-   **Result highlighting**: Shows title and excerpt
-   **Click to navigate**: Clears search and navigates to result

#### Adding Searchable Content

Modify the `initializeSearch()` function in your implementation:

```typescript
async function initializeSearch() {
    const { create, insert } = await import('@orama/orama');

    searchIndex.value = await create({
        schema: {
            title: 'string',
            content: 'string',
            path: 'string',
            category: 'string',
        },
    });

    // Add your documentation pages
    const docs = [
        {
            title: 'Getting Started',
            content: 'Full markdown content here...',
            path: '/documentation/getting-started',
            category: 'Tutorial',
        },
        // ... more docs
    ];

    for (const doc of docs) {
        await insert(searchIndex.value, doc);
    }
}
```

### 3. Navigation Sidebar

Left sidebar with categorized navigation:

-   **Active state**: Automatically highlights current route
-   **Retro styling**: Uses theme colors and shadows
-   **Scrollable**: Handles long navigation lists

Default navigation structure (used if none provided):

```typescript
[
    {
        label: 'Getting Started',
        items: [
            { label: 'Introduction', path: '/documentation' },
            { label: 'Installation', path: '/documentation/installation' },
            { label: 'Quick Start', path: '/documentation/quick-start' },
        ],
    },
    {
        label: 'Core Concepts',
        items: [
            { label: 'Architecture', path: '/documentation/architecture' },
            { label: 'Hooks System', path: '/documentation/hooks' },
            { label: 'State Management', path: '/documentation/state' },
        ],
    },
];
```

### 4. Table of Contents

Right sidebar (hidden on screens < 1280px):

-   **Auto-linking**: Anchor links to heading IDs
-   **Indentation**: Levels 2, 3, 4 with visual hierarchy
-   **Sticky positioning**: Stays visible while scrolling

Generate TOC from your markdown:

```typescript
// Example: Parse markdown headings
const toc = computed(() => {
    const headings: TocItem[] = [];
    const lines = markdown.value.split('\n');

    lines.forEach((line, index) => {
        const match = line.match(/^(#{2,4})\s+(.+)$/);
        if (match) {
            const level = match[1].length;
            const text = match[2];
            const id = text
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^\w-]/g, '');
            headings.push({ id, text, level });
        }
    });

    return headings;
});
```

### 5. Theme Integration

Uses your existing theme system:

```typescript
// Toggle theme button is included in header
const toggleTheme = () => {
    const nuxtApp = useNuxtApp();
    const theme = nuxtApp.$theme as { toggle?: () => void };
    theme?.toggle?.();
};
```

## Styling

The component uses retro-styled classes that respect your theme tokens:

### Custom Styling Override

```vue
<template>
    <DocumentationShell :content="markdown" class="custom-docs" />
</template>

<style scoped>
.custom-docs :deep(.prose-retro h1) {
    color: var(--md-tertiary);
    font-size: 2.5rem;
}

.custom-docs :deep([data-streamdown='code-block']) {
    border-width: 3px;
    box-shadow: 4px 4px 0 var(--md-inverse-surface);
}
</style>
```

### Available Data Attributes

All StreamMarkdown elements include `data-streamdown` attributes for precise targeting:

-   `[data-streamdown="code-block"]` - Code block container
-   `[data-streamdown="code-block-header"]` - Header bar
-   `[data-streamdown="code-lang"]` - Language badge
-   `[data-streamdown="code-body"]` - Code content area
-   `[data-streamdown="copy-button"]` - Copy button
-   `[data-streamdown="table-wrapper"]` - Table scroll container
-   And more... (see streamdown-vue docs)

## Advanced Usage

### Dynamic Content Loading

```vue
<template>
    <DocumentationShell
        :content="currentDoc"
        :navigation="navigation"
        :toc="currentToc"
        show-toc
    />
</template>

<script setup lang="ts">
const route = useRoute();
const currentDoc = ref('');
const currentToc = ref<TocItem[]>([]);

// Load documentation based on route
watchEffect(async () => {
    const docPath = route.path.replace('/documentation/', '');
    const response = await fetch(`/api/docs/${docPath}`);
    const data = await response.json();

    currentDoc.value = data.content;
    currentToc.value = data.toc;
});
</script>
```

### Streaming Content

For AI-generated docs or real-time updates:

```typescript
import { parseIncompleteMarkdown } from 'streamdown-vue';

const streamedContent = ref('');
let buffer = '';

async function streamDocumentation() {
    const response = await fetch('/api/generate-docs');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Repair incomplete markdown tokens
        streamedContent.value = parseIncompleteMarkdown(buffer);
    }
}
```

### Custom Search Integration

Replace default search with your own:

```vue
<template>
    <DocumentationShell :content="markdown">
        <!-- Override search in header via custom implementation -->
    </DocumentationShell>
</template>
```

## Security

### Link & Image Hardening

By default, StreamMarkdown enforces security:

```typescript
// Allowed prefixes (configured in component)
allowedLinkPrefixes: ['https://', 'http://', '/'];
allowedImagePrefixes: ['https://', 'http://', '/'];
```

-   `javascript:` URLs are blocked
-   Only whitelisted prefixes allowed
-   Relative URLs (starting with `/`) are allowed

To customize, modify the component or wrap it.

## Performance Tips

1. **Lazy load search**: Search is only initialized on `/documentation` routes
2. **Debounce updates**: Search queries are debounced to 120ms
3. **Limit search results**: Default limit is 10 results
4. **Code block optimization**: Shiki highlighting is cached
5. **Responsive TOC**: Hidden on small screens to reduce DOM size

## Keyboard Shortcuts

-   `⌘K` (Mac) / `Ctrl+K` (Windows): Focus search input

## Browser Support

-   Modern browsers with ES2020+ support
-   Requires support for:
    -   CSS custom properties
    -   ES modules
    -   Async/await
    -   Fetch API

## Troubleshooting

### Search not working

-   Ensure you're on a `/documentation` route
-   Check console for Orama import errors
-   Verify search index is populated with documents

### Math not rendering

-   Confirm KaTeX CSS is imported: `import 'katex/dist/katex.min.css'`
-   Check for LaTeX syntax errors in your markdown

### Code blocks not highlighted

-   Shiki loads dynamically; check network tab
-   Verify language name is supported by Shiki
-   Use lowercase language names (e.g., `typescript` not `TypeScript`)

### Theme toggle not working

-   Ensure theme plugin is properly configured
-   Check that `nuxtApp.$theme` is available
-   Verify theme classes are applied to `<html>`

## Examples

### Complete Documentation Page

```vue
<template>
    <DocumentationShell
        :content="doc.content"
        :navigation="navigation"
        :toc="doc.toc"
        show-toc
    />
</template>

<script setup lang="ts">
definePageMeta({
    layout: false, // Use shell's built-in layout
});

const doc = {
    content: `
# API Reference

## Components

### Button

A retro-styled button component.

\`\`\`vue
<template>
    <UButton variant="basic">Click me</UButton>
</template>
\`\`\`

**Props:**
- \`variant\`: Button style variant
- \`size\`: Button size (sm, md, lg)

## Functions

### useTheme()

Access theme utilities.

\`\`\`typescript
const { toggle, current } = useTheme();
\`\`\`
`,
    toc: [
        { id: 'components', text: 'Components', level: 2 },
        { id: 'button', text: 'Button', level: 3 },
        { id: 'functions', text: 'Functions', level: 2 },
        { id: 'usetheme', text: 'useTheme()', level: 3 },
    ],
};

const navigation = [
    {
        label: 'Documentation',
        items: [
            { label: 'Overview', path: '/documentation' },
            { label: 'API Reference', path: '/documentation/api' },
        ],
    },
];
</script>
```

## Related

-   [StreamMarkdown Documentation](https://github.com/vercel/streamdown)
-   [Orama Search](https://docs.oramasearch.com/)
-   [Shiki Syntax Highlighter](https://shiki.matsu.io/)
-   [KaTeX Math Rendering](https://katex.org/)

## Contributing

To enhance the DocumentationShell:

1. Keep retro styling consistent with theme tokens
2. Test with various markdown content
3. Ensure search performance with large doc sets
4. Maintain accessibility (focus states, ARIA labels)
5. Update this documentation when adding features

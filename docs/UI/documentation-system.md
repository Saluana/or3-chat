# Documentation System

The OR3 documentation system uses a dynamic routing approach with the `DocumentationShell` component to display markdown documentation files.

## Architecture

### Routes
- `/documentation` - Main documentation index (welcome page)
- `/documentation/[...slug]` - Catch-all route for all documentation pages

### File Structure
```
public/_documentation/
  ├── docmap.json          # Navigation map and file registry
  ├── composables/
  │   ├── useActivePrompt.md
  │   └── useChat.md
  ├── hooks/
  └── database/
```

### How It Works

1. **Navigation Building**
   - `DocumentationShell` loads `docmap.json` on mount
   - Sections are sorted alphabetically by title
   - Files within sections are sorted alphabetically by name
   - Navigation is rendered in the left sidebar

2. **Content Loading**
   - Route path is matched against `docmap.json` entries
   - Markdown file is fetched from `/_documentation/{section}/{filename}`
   - Content is rendered using `StreamMarkdown` component

3. **Search**
   - Orama search index is built from all documentation files
   - Indexes first 5000 characters of each file
   - Debounced search with 120ms delay
   - Results show title, excerpt, and link to full document

## Adding New Documentation

### 1. Create the markdown file
Place your `.md` file in the appropriate section folder:
```bash
public/_documentation/composables/myNewComposable.md
```

### 2. Update docmap.json
Add entry to the relevant section:
```json
{
  "title": "Composables",
  "path": "/composables",
  "files": [
    {
      "name": "myNewComposable.md",
      "path": "/composables/myNewComposable",
      "category": "Chat"
    }
  ]
}
```

### 3. Access the documentation
Navigate to: `/documentation/composables/myNewComposable`

## Docmap Schema

```typescript
interface Docmap {
  title: string;        // Site title
  description: string;  // Site description
  version: string;      // Documentation version
  sections: Section[];  // Navigation sections
}

interface Section {
  title: string;   // Section name (e.g., "Composables")
  path: string;    // Section path (e.g., "/composables")
  files: File[];   // Files in this section
}

interface File {
  name: string;     // Filename (e.g., "useChat.md")
  path: string;     // Route path (e.g., "/composables/useChat")
  category: string; // Category tag (e.g., "Chat")
}
```

## Features

- ✅ Dynamic route-based content loading
- ✅ Alphabetically sorted navigation
- ✅ Full-text search with Orama
- ✅ Retro-styled markdown rendering
- ✅ Theme toggle support
- ✅ Responsive layout with sidebar and TOC
- ✅ 404 handling for missing pages

## Styling

The documentation uses the retro theme system with:
- Material Design CSS variables
- `VT323` for body text
- `Press Start 2P` for headings
- Hard shadows and pixel-perfect borders
- Code blocks with syntax highlighting

## Search Implementation

Search is powered by Orama and includes:
- Title search
- Full-text content search
- Category filtering
- Result excerpts
- Click-to-navigate results

The search index is built asynchronously when the documentation route is accessed.

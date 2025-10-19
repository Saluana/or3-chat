# OR3 Documentation

This folder contains all the markdown documentation files for the OR3 project.

## Structure

```
_documentation/
├── README.md           # This file
├── docmap.json        # Navigation configuration
├── composables/       # Composable documentation
├── hooks/            # Hooks system documentation
└── database/         # Database documentation
```

## Adding Documentation

1. Create your markdown file in the appropriate folder
2. Update `docmap.json` with the file entry
3. The documentation will automatically appear in the sidebar

## Navigation Order

- Sections are sorted alphabetically by title
- Files within sections are sorted alphabetically by name
- File names are automatically formatted (e.g., `useActivePrompt` → `use Active Prompt`)

## Routes

All documentation is accessible at:
- `/documentation` - Documentation home
- `/documentation/{section}/{file}` - Specific document

Example: `/documentation/composables/useChat`

## Search

The documentation includes full-text search powered by Orama. Search is available via the search bar in the header.

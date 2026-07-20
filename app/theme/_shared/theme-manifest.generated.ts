/** Auto-generated metadata-only theme manifest. Do not edit manually. */
export interface GeneratedThemeMetadata {
    name: string;
    dirName: string;
    displayName?: string;
    description?: string;
    isDefault: boolean;
    stylesheets: readonly string[];
    hasCssSelectorStyles: boolean;
}

export const GENERATED_THEME_METADATA: readonly GeneratedThemeMetadata[] = [
    {
        "name": "blank",
        "dirName": "blank",
        "displayName": "Blank theme",
        "description": "ChatGPT-inspired clean minimal theme",
        "isDefault": false,
        "stylesheets": [
            "~/theme/blank/styles.css"
        ],
        "hasCssSelectorStyles": true
    },
    {
        "name": "cyberpunk",
        "dirName": "cyberpunk",
        "displayName": "Cyberpunk",
        "description": "Neon-drenched dark theme with electric cyan, hot red accents, and angular UI inspired by cyberpunk game interfaces",
        "isDefault": false,
        "stylesheets": [
            "./styles.css"
        ],
        "hasCssSelectorStyles": true
    },
    {
        "name": "retro",
        "dirName": "retro",
        "displayName": "Retro theme",
        "description": "Classic retro aesthetic with pixel-perfect styling and nostalgic vibes",
        "isDefault": false,
        "stylesheets": [
            "~/theme/retro/styles.css"
        ],
        "hasCssSelectorStyles": true
    }
] as const;

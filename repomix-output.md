This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
app/
  assets/
    css/
      dark-hc.css
      dark-mc.css
      dark.css
      light-hc.css
      light-mc.css
      light.css
      main.css
      nuxt-ui-map.css
      theme.css
  components/
    chat/
      ChatContainer.vue
      ChatInput.vue
      ChatInputDropper.vue
      ChatMessage.vue
    modal/
      SettingsModal.vue
    sidebar/
      ResizeHandle.vue
      SidebarHeader.vue
      SideBottomNav.vue
      SideNavContent.vue
    ResizableSidebarLayout.vue
    RetroGlassBtn.vue
  composables/
    useAi.ts
    useHookEffect.ts
    useHooks.ts
    useModelSearch.ts
    useModelStore.ts
    useOpenrouter.ts
    useThreadSearch.ts
    useUserApiKey.ts
  db/
    attachments.ts
    client.ts
    index.ts
    kv.ts
    messages.ts
    projects.ts
    schema.ts
    threads.ts
    util.ts
  pages/
    _test.vue
    chat.vue
    home.vue
    homepage.vue
    openrouter-callback.vue
  plugins/
    hooks.client.ts
    hooks.server.ts
    theme.client.ts
  state/
    global.ts
  utils/
    hooks.ts
    models-service.ts
  app.config.ts
  app.vue
docs/
  hooks.md
public/
  robots.txt
types/
  nuxt.d.ts
  orama.d.ts
.gitignore
app.config.ts
nuxt.config.ts
package.json
README.md
task.md
tsconfig.json
```

# Files

## File: app/assets/css/dark-hc.css
````css
.dark-high-contrast {
  --md-primary: rgb(230 241 255);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 0 0);
  --md-primary-container: rgb(149 200 245);
  --md-on-primary-container: rgb(0 12 24);
  --md-secondary: rgb(230 241 255);
  --md-on-secondary: rgb(0 0 0);
  --md-secondary-container: rgb(180 196 214);
  --md-on-secondary-container: rgb(0 12 24);
  --md-tertiary: rgb(247 236 255);
  --md-on-tertiary: rgb(0 0 0);
  --md-tertiary-container: rgb(205 187 227);
  --md-on-tertiary-container: rgb(17 5 34);
  --md-error: rgb(255 236 233);
  --md-on-error: rgb(0 0 0);
  --md-error-container: rgb(255 174 164);
  --md-on-error-container: rgb(34 0 1);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(255 255 255);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(255 255 255);
  --md-outline: rgb(235 240 248);
  --md-outline-variant: rgb(190 195 203);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(224 226 232);
  --md-inverse-on-surface: rgb(0 0 0);
  --md-inverse-primary: rgb(10 76 115);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 0 0);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(0 19 33);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(0 0 0);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(3 18 31);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(0 0 0);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(23 10 41);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(77 80 85);
  --md-surface-container-lowest: rgb(0 0 0);
  --md-surface-container-low: rgb(28 32 36);
  --md-surface-container: rgb(45 49 53);
  --md-surface-container-high: rgb(56 60 64);
  --md-surface-container-highest: rgb(67 71 76);
  --md-extended-color-success-color: rgb(184 255 222);
  --md-extended-color-success-on-color: rgb(0 0 0);
  --md-extended-color-success-color-container: rgb(136 209 176);
  --md-extended-color-success-on-color-container: rgb(0 14 8);
  --md-extended-color-warning-color: rgb(255 236 228);
  --md-extended-color-warning-on-color: rgb(0 0 0);
  --md-extended-color-warning-color-container: rgb(255 177 133);
  --md-extended-color-warning-on-color-container: rgb(25 6 0);
}
````

## File: app/assets/css/dark-mc.css
````css
.dark-medium-contrast {
  --md-primary: rgb(192 224 255);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 40 65);
  --md-primary-container: rgb(99 150 193);
  --md-on-primary-container: rgb(0 0 0);
  --md-secondary: rgb(206 222 240);
  --md-on-secondary: rgb(24 39 52);
  --md-secondary-container: rgb(131 146 163);
  --md-on-secondary-container: rgb(0 0 0);
  --md-tertiary: rgb(232 213 254);
  --md-on-tertiary: rgb(44 32 62);
  --md-tertiary-container: rgb(154 138 175);
  --md-on-tertiary-container: rgb(0 0 0);
  --md-error: rgb(255 210 204);
  --md-on-error: rgb(84 0 3);
  --md-error-container: rgb(255 84 73);
  --md-on-error-container: rgb(0 0 0);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(255 255 255);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(216 221 228);
  --md-outline: rgb(173 178 186);
  --md-outline-variant: rgb(139 145 152);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(224 226 232);
  --md-inverse-on-surface: rgb(39 42 46);
  --md-inverse-primary: rgb(10 76 115);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 19 33);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(0 57 90);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(3 18 31);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(41 56 69);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(23 10 41);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(61 48 80);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(65 69 73);
  --md-surface-container-lowest: rgb(5 8 11);
  --md-surface-container-low: rgb(26 30 34);
  --md-surface-container: rgb(36 40 44);
  --md-surface-container-high: rgb(47 51 55);
  --md-surface-container-highest: rgb(58 62 66);
  --md-extended-color-success-color: rgb(161 236 201);
  --md-extended-color-success-on-color: rgb(0 44 30);
  --md-extended-color-success-color-container: rgb(86 158 128);
  --md-extended-color-success-on-color-container: rgb(0 0 0);
  --md-extended-color-warning-color: rgb(255 211 189);
  --md-extended-color-warning-on-color: rgb(67 25 0);
  --md-extended-color-warning-color-container: rgb(200 127 85);
  --md-extended-color-warning-on-color-container: rgb(0 0 0);
}
````

## File: app/assets/css/dark.css
````css
.dark {
  --md-primary: rgb(153 204 249);
  --md-surface-tint: rgb(153 204 249);
  --md-on-primary: rgb(0 51 81);
  --md-primary-container: rgb(7 75 114);
  --md-on-primary-container: rgb(204 229 255);
  --md-secondary: rgb(184 200 218);
  --md-on-secondary: rgb(35 50 63);
  --md-secondary-container: rgb(57 72 87);
  --md-on-secondary-container: rgb(212 228 246);
  --md-tertiary: rgb(209 191 231);
  --md-on-tertiary: rgb(55 42 74);
  --md-tertiary-container: rgb(78 65 97);
  --md-on-tertiary-container: rgb(237 220 255);
  --md-error: rgb(255 180 171);
  --md-on-error: rgb(105 0 5);
  --md-error-container: rgb(147 0 10);
  --md-on-error-container: rgb(255 218 214);
  --md-background: rgb(16 20 24);
  --md-on-background: rgb(224 226 232);
  --md-surface: rgb(16 20 24);
  --md-on-surface: rgb(224 226 232);
  --md-surface-variant: rgb(66 71 78);
  --md-on-surface-variant: rgb(194 199 206);
  --md-outline: rgb(140 145 152);
  --md-outline-variant: rgb(66 71 78);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(224 226 232);
  --md-inverse-on-surface: rgb(45 49 53);
  --md-inverse-primary: rgb(44 99 139);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 29 49);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(7 75 114);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(13 29 42);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(57 72 87);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(34 21 52);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(78 65 97);
  --md-surface-dim: rgb(16 20 24);
  --md-surface-bright: rgb(54 57 62);
  --md-surface-container-lowest: rgb(11 15 18);
  --md-surface-container-low: rgb(24 28 32);
  --md-surface-container: rgb(28 32 36);
  --md-surface-container-high: rgb(39 42 46);
  --md-surface-container-highest: rgb(49 53 57);
  --md-extended-color-success-color: rgb(140 213 180);
  --md-extended-color-success-on-color: rgb(0 56 39);
  --md-extended-color-success-color-container: rgb(0 81 58);
  --md-extended-color-success-on-color-container: rgb(167 242 207);
  --md-extended-color-warning-color: rgb(255 182 142);
  --md-extended-color-warning-on-color: rgb(83 34 1);
  --md-extended-color-warning-color-container: rgb(111 56 19);
  --md-extended-color-warning-on-color-container: rgb(255 219 202);
}
````

## File: app/assets/css/light-hc.css
````css
.light-high-contrast {
  --md-primary: rgb(0 47 75);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(12 77 116);
  --md-on-primary-container: rgb(255 255 255);
  --md-secondary: rgb(30 46 59);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(60 75 89);
  --md-on-secondary-container: rgb(255 255 255);
  --md-tertiary: rgb(51 38 69);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(81 67 100);
  --md-on-tertiary-container: rgb(255 255 255);
  --md-error: rgb(96 0 4);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(152 0 10);
  --md-on-error-container: rgb(255 255 255);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(0 0 0);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(0 0 0);
  --md-outline: rgb(39 45 51);
  --md-outline-variant: rgb(68 74 80);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(255 255 255);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(12 77 116);
  --md-on-primary-fixed: rgb(255 255 255);
  --md-primary-fixed-dim: rgb(0 54 84);
  --md-on-primary-fixed-variant: rgb(255 255 255);
  --md-secondary-fixed: rgb(60 75 89);
  --md-on-secondary-fixed: rgb(255 255 255);
  --md-secondary-fixed-dim: rgb(37 52 66);
  --md-on-secondary-fixed-variant: rgb(255 255 255);
  --md-tertiary-fixed: rgb(81 67 100);
  --md-on-tertiary-fixed: rgb(255 255 255);
  --md-tertiary-fixed-dim: rgb(58 45 76);
  --md-on-tertiary-fixed-variant: rgb(255 255 255);
  --md-surface-dim: rgb(182 185 190);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(238 241 246);
  --md-surface-container: rgb(224 226 232);
  --md-surface-container-high: rgb(210 212 218);
  --md-surface-container-highest: rgb(196 199 204);
  --md-extended-color-success-color: rgb(0 51 35);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(0 84 60);
  --md-extended-color-success-on-color-container: rgb(255 255 255);
  --md-extended-color-warning-color: rgb(77 30 0);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(114 58 22);
  --md-extended-color-warning-on-color-container: rgb(255 255 255);
}
````

## File: app/assets/css/light-mc.css
````css
.light-medium-contrast {
  --md-primary: rgb(0 57 90);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(61 114 155);
  --md-on-primary-container: rgb(255 255 255);
  --md-secondary: rgb(41 56 69);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(95 111 126);
  --md-on-secondary-container: rgb(255 255 255);
  --md-tertiary: rgb(61 48 80);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(118 103 138);
  --md-on-tertiary-container: rgb(255 255 255);
  --md-error: rgb(116 0 6);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(207 44 39);
  --md-on-error-container: rgb(255 255 255);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(14 18 21);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(49 55 61);
  --md-outline: rgb(77 83 89);
  --md-outline-variant: rgb(104 110 116);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(238 241 246);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(61 114 155);
  --md-on-primary-fixed: rgb(255 255 255);
  --md-primary-fixed-dim: rgb(31 89 129);
  --md-on-primary-fixed-variant: rgb(255 255 255);
  --md-secondary-fixed: rgb(95 111 126);
  --md-on-secondary-fixed: rgb(255 255 255);
  --md-secondary-fixed-dim: rgb(71 86 101);
  --md-on-secondary-fixed-variant: rgb(255 255 255);
  --md-tertiary-fixed: rgb(118 103 138);
  --md-on-tertiary-fixed: rgb(255 255 255);
  --md-tertiary-fixed-dim: rgb(93 78 112);
  --md-on-tertiary-fixed-variant: rgb(255 255 255);
  --md-surface-dim: rgb(196 199 204);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(241 244 249);
  --md-surface-container: rgb(230 232 238);
  --md-surface-container-high: rgb(218 221 226);
  --md-surface-container-highest: rgb(207 210 215);
  --md-extended-color-success-color: rgb(0 63 44);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(48 122 94);
  --md-extended-color-success-on-color-container: rgb(255 255 255);
  --md-extended-color-warning-color: rgb(91 40 4);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(158 93 54);
  --md-extended-color-warning-on-color-container: rgb(255 255 255);
}
````

## File: app/assets/css/light.css
````css
.light {
  --md-primary: rgb(44 99 139);
  --md-surface-tint: rgb(44 99 139);
  --md-on-primary: rgb(255 255 255);
  --md-primary-container: rgb(204 229 255);
  --md-on-primary-container: rgb(7 75 114);
  --md-secondary: rgb(81 96 111);
  --md-on-secondary: rgb(255 255 255);
  --md-secondary-container: rgb(212 228 246);
  --md-on-secondary-container: rgb(57 72 87);
  --md-tertiary: rgb(103 88 122);
  --md-on-tertiary: rgb(255 255 255);
  --md-tertiary-container: rgb(237 220 255);
  --md-on-tertiary-container: rgb(78 65 97);
  --md-error: rgb(186 26 26);
  --md-on-error: rgb(255 255 255);
  --md-error-container: rgb(255 218 214);
  --md-on-error-container: rgb(147 0 10);
  --md-background: rgb(247 249 255);
  --md-on-background: rgb(24 28 32);
  --md-surface: rgb(247 249 255);
  --md-on-surface: rgb(24 28 32);
  --md-surface-variant: rgb(222 227 235);
  --md-on-surface-variant: rgb(66 71 78);
  --md-outline: rgb(114 120 126);
  --md-outline-variant: rgb(194 199 206);
  --md-shadow: rgb(0 0 0);
  --md-scrim: rgb(0 0 0);
  --md-inverse-surface: rgb(45 49 53);
  --md-inverse-on-surface: rgb(238 241 246);
  --md-inverse-primary: rgb(153 204 249);
  --md-primary-fixed: rgb(204 229 255);
  --md-on-primary-fixed: rgb(0 29 49);
  --md-primary-fixed-dim: rgb(153 204 249);
  --md-on-primary-fixed-variant: rgb(7 75 114);
  --md-secondary-fixed: rgb(212 228 246);
  --md-on-secondary-fixed: rgb(13 29 42);
  --md-secondary-fixed-dim: rgb(184 200 218);
  --md-on-secondary-fixed-variant: rgb(57 72 87);
  --md-tertiary-fixed: rgb(237 220 255);
  --md-on-tertiary-fixed: rgb(34 21 52);
  --md-tertiary-fixed-dim: rgb(209 191 231);
  --md-on-tertiary-fixed-variant: rgb(78 65 97);
  --md-surface-dim: rgb(215 218 223);
  --md-surface-bright: rgb(247 249 255);
  --md-surface-container-lowest: rgb(255 255 255);
  --md-surface-container-low: rgb(241 244 249);
  --md-surface-container: rgb(235 238 243);
  --md-surface-container-high: rgb(230 232 238);
  --md-surface-container-highest: rgb(224 226 232);
  --md-extended-color-success-color: rgb(29 107 79);
  --md-extended-color-success-on-color: rgb(255 255 255);
  --md-extended-color-success-color-container: rgb(167 242 207);
  --md-extended-color-success-on-color-container: rgb(0 81 58);
  --md-extended-color-warning-color: rgb(140 78 41);
  --md-extended-color-warning-on-color: rgb(255 255 255);
  --md-extended-color-warning-color-container: rgb(255 219 202);
  --md-extended-color-warning-on-color-container: rgb(111 56 19);
}
````

## File: app/assets/css/nuxt-ui-map.css
````css
/* Map Material Design variables to Nuxt UI CSS tokens.
   We scope per theme class so switching themes updates Nuxt UI instantly. */

/* Light */
.light {
  /* primary scale + base */
  --ui-primary: var(--md-primary);
  --ui-color-primary-500: var(--md-primary);
  --ui-color-primary-600: var(--md-primary);

  /* secondary -> use your secondary container as the accent */
  --ui-secondary: var(--md-secondary);
  --ui-color-secondary-500: var(--md-secondary);

  /* success/info/warning/error from extended colors */
  --ui-success: var(--md-extended-color-success-color);
  --ui-color-success-500: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-color-info-500: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-color-warning-500: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-color-error-500: var(--md-error);

  /* text + background + borders */
  --ui-text: var(--md-on-surface);
  --ui-text-inverted: var(--md-on-primary);
  --ui-text-muted: color-mix(in oklab, var(--md-on-surface), transparent 35%);
  --ui-text-dimmed: color-mix(in oklab, var(--md-on-surface), transparent 55%);
  --ui-bg: var(--md-surface);
  --ui-bg-muted: var(--md-surface-container);
  --ui-bg-elevated: var(--md-surface-container-high);
  --ui-bg-accented: var(--md-primary-container);
  --ui-bg-inverted: var(--md-inverse-surface);
  --ui-border: var(--md-outline);
  --ui-border-muted: var(--md-outline-variant);
  --ui-border-accented: var(--md-primary);
  --ui-border-inverted: var(--md-inverse-primary);

  /* optional radii scale base */
  --ui-radius: 0.5rem;
}

/* Dark */
.dark {
  --ui-primary: var(--md-primary);
  --ui-color-primary-500: var(--md-primary);
  --ui-color-primary-600: var(--md-primary);

  --ui-secondary: var(--md-secondary);
  --ui-color-secondary-500: var(--md-secondary);

  --ui-success: var(--md-extended-color-success-color);
  --ui-color-success-500: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-color-info-500: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-color-warning-500: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-color-error-500: var(--md-error);

  --ui-text: var(--md-on-surface);
  --ui-text-inverted: var(--md-on-primary);
  --ui-text-muted: color-mix(in oklab, var(--md-on-surface), transparent 35%);
  --ui-text-dimmed: color-mix(in oklab, var(--md-on-surface), transparent 55%);
  --ui-bg: var(--md-surface);
  --ui-bg-muted: var(--md-surface-container);
  --ui-bg-elevated: var(--md-surface-container-high);
  --ui-bg-accented: var(--md-primary-container);
  --ui-bg-inverted: var(--md-inverse-surface);
  --ui-border: var(--md-outline);
  --ui-border-muted: var(--md-outline-variant);
  --ui-border-accented: var(--md-primary);
  --ui-border-inverted: var(--md-inverse-primary);

  --ui-radius: 0.5rem;
}

/* High/Medium contrast variants inherit the same mapping */
.light-high-contrast,
.light-medium-contrast,
.dark-high-contrast,
.dark-medium-contrast {
  --ui-primary: var(--md-primary);
  --ui-secondary: var(--md-secondary);
  --ui-success: var(--md-extended-color-success-color);
  --ui-info: var(--md-primary-container);
  --ui-warning: var(--md-extended-color-warning-color);
  --ui-error: var(--md-error);
  --ui-text: var(--md-on-surface);
  --ui-bg: var(--md-surface);
  --ui-border: var(--md-outline);
}
````

## File: app/assets/css/theme.css
````css
/* Global theme imports: each file defines CSS variables scoped by a class (.light, .dark, etc.) */
@import "./light.css";
@import "./light-hc.css";
@import "./light-mc.css";
@import "./dark.css";
@import "./dark-hc.css";
@import "./dark-mc.css";
````

## File: app/components/chat/ChatInput.vue
````vue
<template></template>
<script setup lang="ts"></script>
<style scoped></style>
````

## File: app/components/sidebar/ResizeHandle.vue
````vue
<template>
    <div
        v-if="isDesktop && !collapsed"
        class="resize-handle-layer hidden md:block absolute top-0 bottom-0 w-3 cursor-col-resize select-none group z-20"
        :class="side === 'right' ? 'left-0' : 'right-0'"
        @pointerdown="onPointerDown"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="minWidth"
        :aria-valuemax="maxWidth"
        :aria-valuenow="computedWidth"
        aria-label="Resize sidebar"
        tabindex="0"
        @keydown="onHandleKeydown"
    >
        <div
            class="absolute inset-y-0 my-auto h-24 w-1.5 rounded-full bg-[var(--md-outline-variant)]/70 group-hover:bg-[var(--md-primary)]/70 transition-colors"
            :class="side === 'right' ? 'left-0' : 'right-0'"
        ></div>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
    isDesktop: { type: Boolean, required: true },
    collapsed: { type: Boolean, required: true },
    side: { type: String as () => 'left' | 'right', required: true },
    minWidth: { type: Number, required: true },
    maxWidth: { type: Number, required: true },
    computedWidth: { type: Number, required: true },
});

const emit = defineEmits<{
    (e: 'resize-start', ev: PointerEvent): void;
    (e: 'resize-keydown', ev: KeyboardEvent): void;
}>();

function onPointerDown(e: PointerEvent) {
    // emit a clear custom event name so parent receives original event payload
    emit('resize-start', e);
}

function onHandleKeydown(e: KeyboardEvent) {
    emit('resize-keydown', e);
}
</script>

<style scoped>
/* visual handled by parent styles */
</style>
````

## File: app/components/sidebar/SidebarHeader.vue
````vue
<template>
    <div
        :class="{
            'px-0 justify-center': collapsed,
            'px-3 justify-between': !collapsed,
        }"
        class="flex items-center header-pattern py-2 border-b-2 border-black"
    >
        <div v-show="!collapsed">
            <slot name="sidebar-header">
                <h1 class="text-[14px] font-medium uppercase tracking-wide">
                    Chat app
                </h1>
            </slot>
        </div>

        <slot name="sidebar-toggle" :collapsed="collapsed" :toggle="onToggle">
            <UButton
                size="xs"
                :square="true"
                color="neutral"
                variant="ghost"
                :class="'retro-btn'"
                @click="onToggle"
                :ui="{ base: 'retro-btn' }"
                :aria-label="toggleAria"
                :title="toggleAria"
            >
                <UIcon :name="toggleIcon" class="w-5 h-5" />
            </UButton>
        </slot>
    </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
    collapsed: { type: Boolean, required: true },
    toggleIcon: { type: String, required: true },
    toggleAria: { type: String, required: true },
});
const emit = defineEmits(['toggle']);

function onToggle() {
    emit('toggle');
}
</script>

<style scoped>
/* keep styling minimal; visual rules come from parent stylesheet */
</style>
````

## File: app/components/RetroGlassBtn.vue
````vue
<template>
    <UButton
        v-bind="$attrs"
        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
        ><slot></slot
    ></UButton>
</template>

<script setup></script>
````

## File: app/composables/useHookEffect.ts
````typescript
import { onBeforeUnmount } from 'vue';
import { useHooks } from './useHooks';
import type { HookKind } from '../utils/hooks';

interface Options {
    kind?: HookKind;
    priority?: number;
}

/**
 * Register a callback to a hook name and clean up on unmount and HMR.
 * Returns a disposer you can call manually as well.
 */
export function useHookEffect(
    name: string,
    fn: (...args: any[]) => any,
    opts?: Options
) {
    const hooks = useHooks();
    const disposer = hooks.on(name, fn, opts);

    // Component lifecycle cleanup
    onBeforeUnmount(() => hooks.off(disposer));

    // HMR cleanup for the importing module
    if (import.meta.hot) {
        import.meta.hot.dispose(() => hooks.off(disposer));
    }

    return disposer;
}
````

## File: app/composables/useHooks.ts
````typescript
import { useNuxtApp } from '#app';
import type { HookEngine } from '../utils/hooks';

export function useHooks(): HookEngine {
    return useNuxtApp().$hooks as HookEngine;
}
````

## File: app/composables/useModelSearch.ts
````typescript
import { ref, watch, type Ref } from 'vue';
import type { OpenRouterModel } from '~/utils/models-service';

// Simple Orama-based search composable for the model catalog.
// Builds an index client-side and performs search across id, slug, name, description, modalities.
// Debounced query for responsiveness.

interface ModelDoc {
    id: string;
    slug: string;
    name: string;
    description: string;
    ctx: number;
    modalities: string;
}

type OramaInstance = any; // avoid type import complexity here
let currentDb: OramaInstance | null = null;
let lastQueryToken = 0;

async function importOrama() {
    try {
        return await import('@orama/orama');
    } catch {
        throw new Error('Failed to import Orama');
    }
}

async function createDb() {
    // dynamic import keeps bundle smaller when modal unused
    const { create } = await importOrama();
    return create({
        schema: {
            id: 'string',
            slug: 'string',
            name: 'string',
            description: 'string',
            ctx: 'number',
            modalities: 'string',
        },
    });
}

async function buildIndex(models: OpenRouterModel[]) {
    const { insertMultiple } = await importOrama();
    currentDb = await createDb();
    if (!currentDb) return null;
    const docs: ModelDoc[] = models.map((m) => ({
        id: m.id,
        slug: m.canonical_slug || m.id,
        name: m.name || '',
        description: m.description || '',
        ctx: m.top_provider?.context_length ?? m.context_length ?? 0,
        modalities: [
            ...(m.architecture?.input_modalities || []),
            ...(m.architecture?.output_modalities || []),
        ].join(' '),
    }));
    await insertMultiple(currentDb, docs);
    return currentDb;
}

export function useModelSearch(models: Ref<OpenRouterModel[]>) {
    const query = ref('');
    const results = ref<OpenRouterModel[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedCount = ref(0);
    const idToModel = ref<Record<string, OpenRouterModel>>({});

    async function ensureIndex() {
        if (!process.client) return;
        if (busy.value) return;
        if (models.value.length === lastIndexedCount.value && currentDb) return;
        busy.value = true;
        try {
            idToModel.value = Object.fromEntries(
                models.value.map((m) => [m.id, m])
            );
            await buildIndex(models.value);
            lastIndexedCount.value = models.value.length;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        if (!currentDb) await ensureIndex();
        if (!currentDb) return;
        const raw = query.value.trim();
        if (!raw) {
            results.value = models.value;
            return;
        }
        const token = ++lastQueryToken; // race guard
        try {
            const { search } = await importOrama();
            const r = await search(currentDb, {
                term: raw,
                limit: 100,
            });
            if (token !== lastQueryToken) return; // stale response
            const hits = Array.isArray(r?.hits) ? r.hits : [];
            const mapped = hits
                .map((h: any) => {
                    const doc = h.document || h; // support differing shapes
                    return idToModel.value[doc?.id];
                })
                .filter(
                    (m: OpenRouterModel | undefined): m is OpenRouterModel =>
                        !!m
                );
            if (!mapped.length) {
                // Fallback basic substring search (ensures non-blank results if index returns nothing)
                const ql = raw.toLowerCase();
                results.value = models.value.filter((m) => {
                    const hay = `${m.id}\n${m.canonical_slug || ''}\n${
                        m.name || ''
                    }\n${m.description || ''}`.toLowerCase();
                    return hay.includes(ql);
                });
            } else {
                results.value = mapped;
            }
        } catch (err) {
            const ql = raw.toLowerCase();
            results.value = models.value.filter((m) => {
                const hay = `${m.id}\n${m.canonical_slug || ''}\n${
                    m.name || ''
                }\n${m.description || ''}`.toLowerCase();
                return hay.includes(ql);
            });
            // eslint-disable-next-line no-console
            console.warn(
                '[useModelSearch] Fallback substring search used:',
                err
            );
        }
    }

    watch(models, async () => {
        await ensureIndex();
        await runSearch();
    });

    let t: any;
    watch(query, () => {
        clearTimeout(t);
        t = setTimeout(runSearch, 120);
    });

    return { query, results, ready, busy, rebuild: ensureIndex };
}

export default useModelSearch;
````

## File: app/composables/useOpenrouter.ts
````typescript
import { ref } from 'vue';
import { kv } from '~/db';

function base64urlencode(str: ArrayBuffer) {
    return btoa(String.fromCharCode(...new Uint8Array(str)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sha256(plain: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return await crypto.subtle.digest('SHA-256', data);
}

export function useOpenRouterAuth() {
    const isLoggingIn = ref(false);

    const startLogin = async () => {
        if (isLoggingIn.value) return;
        isLoggingIn.value = true;
        const codeVerifier = Array.from(
            crypto.getRandomValues(new Uint8Array(64))
        )
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        // Compute PKCE code_challenge. Prefer S256, but fall back to "plain"
        // when SubtleCrypto is unavailable (e.g., iOS Safari on non-HTTPS).
        let codeChallenge = codeVerifier;
        let codeChallengeMethod: 'S256' | 'plain' = 'plain';
        try {
            if (
                typeof crypto !== 'undefined' &&
                typeof crypto.subtle?.digest === 'function'
            ) {
                const challengeBuffer = await sha256(codeVerifier);
                codeChallenge = base64urlencode(challengeBuffer);
                codeChallengeMethod = 'S256';
            }
        } catch {
            // Keep plain fallback
            codeChallenge = codeVerifier;
            codeChallengeMethod = 'plain';
        }

        // store verifier in session storage
        sessionStorage.setItem('openrouter_code_verifier', codeVerifier);
        // store the method so the callback knows how to exchange
        try {
            sessionStorage.setItem(
                'openrouter_code_method',
                codeChallengeMethod
            );
        } catch {}
        // store a random state to protect against CSRF
        const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => ('0' + b.toString(16)).slice(-2))
            .join('');
        sessionStorage.setItem('openrouter_state', state);

        const rc = useRuntimeConfig();
        // default callback to current origin + known path when not provided
        const callbackUrl =
            String(rc.public.openRouterRedirectUri || '') ||
            `${window.location.origin}/openrouter-callback`;

        const params = new URLSearchParams();
        // Per docs, only callback_url, code_challenge(+method), and optional state are required
        // OpenRouter expects a 'callback_url' parameter
        params.append('callback_url', callbackUrl);
        params.append('state', state);
        params.append('code_challenge', codeChallenge);
        params.append('code_challenge_method', codeChallengeMethod);
        // If you have a registered app on OpenRouter, including client_id helps avoid
        // app auto-creation based on referrer (which can be flaky on mobile).
        const clientId = rc.public.openRouterClientId as string | undefined;
        if (clientId) params.append('client_id', String(clientId));

        const authUrl = String(
            rc.public.openRouterAuthUrl || 'https://openrouter.ai/auth'
        );
        const url = `${authUrl}?${params.toString()}`;

        // Warn if callback URL is not HTTPS or localhost (common iOS issue)
        try {
            const u = new URL(callbackUrl);
            const isLocalhost = ['localhost', '127.0.0.1'].includes(u.hostname);
            const isHttps = u.protocol === 'https:';
            if (!isHttps && !isLocalhost) {
                console.warn(
                    'OpenRouter PKCE: non-HTTPS, non-localhost callback_url detected. On mobile, use a public HTTPS tunnel and set OPENROUTER_REDIRECT_URI.',
                    callbackUrl
                );
            }
        } catch {}

        // Debug: log the final URL so devs can confirm params/authUrl are correct
        // This helps when runtime config is missing or incorrect.
        // eslint-disable-next-line no-console
        console.debug('OpenRouter PKCE redirect URL:', url);

        // Use assign to ensure history behaves consistently across mobile browsers
        window.location.assign(url);
    };

    const logoutOpenRouter = async () => {
        try {
            // Remove local copy immediately for UX
            if (typeof window !== 'undefined') {
                localStorage.removeItem('openrouter_api_key');
            }
            // Best-effort: clear synced KV by setting empty
            try {
                await kv.delete('openrouter_api_key');
            } catch {}
            // Notify UI listeners (Sidebar, etc.) to recompute state
            try {
                window.dispatchEvent(new CustomEvent('openrouter:connected'));
            } catch {}
        } catch (e) {
            console.error('OpenRouter logout failed', e);
        }
    };

    return { startLogin, logoutOpenRouter, isLoggingIn };
}
````

## File: app/composables/useThreadSearch.ts
````typescript
import { ref, watch, type Ref } from 'vue';
import type { Thread } from '~/db';

interface ThreadDoc {
    id: string;
    title: string;
    updated_at: number;
}

type OramaInstance = any;
let dbInstance: OramaInstance | null = null;
let lastQueryToken = 0;

async function importOrama() {
    try {
        return await import('@orama/orama');
    } catch {
        throw new Error('Failed to load Orama');
    }
}

async function createDb() {
    const { create } = await importOrama();
    return create({
        schema: {
            id: 'string',
            title: 'string',
            updated_at: 'number',
        },
    });
}

async function buildIndex(threads: Thread[]) {
    const { insertMultiple } = await importOrama();
    dbInstance = await createDb();
    if (!dbInstance) return null;
    const docs: ThreadDoc[] = threads.map((t) => ({
        id: t.id,
        title: t.title || 'Untitled Thread',
        updated_at: t.updated_at,
    }));
    await insertMultiple(dbInstance, docs);
    return dbInstance;
}

export function useThreadSearch(threads: Ref<Thread[]>) {
    const query = ref('');
    const results = ref<Thread[]>([]);
    const ready = ref(false);
    const busy = ref(false);
    const lastIndexedCount = ref(0);
    const idToThread = ref<Record<string, Thread>>({});

    async function ensureIndex() {
        if (busy.value) return;
        if (threads.value.length === lastIndexedCount.value && dbInstance)
            return;
        busy.value = true;
        try {
            idToThread.value = Object.fromEntries(
                threads.value.map((t) => [t.id, t])
            );
            await buildIndex(threads.value);
            lastIndexedCount.value = threads.value.length;
            ready.value = true;
        } finally {
            busy.value = false;
        }
    }

    async function runSearch() {
        if (!dbInstance) await ensureIndex();
        if (!dbInstance) return;
        const raw = query.value.trim();
        if (!raw) {
            results.value = threads.value;
            return;
        }
        const token = ++lastQueryToken;
        try {
            const { search } = await importOrama();
            const r = await search(dbInstance, { term: raw, limit: 200 });
            if (token !== lastQueryToken) return;
            const hits = Array.isArray(r?.hits) ? r.hits : [];
            const mapped = hits
                .map((h: any) => {
                    const doc = h.document || h;
                    return idToThread.value[doc?.id];
                })
                .filter((t: Thread | undefined): t is Thread => !!t);
            if (!mapped.length) {
                const ql = raw.toLowerCase();
                results.value = threads.value.filter((t) =>
                    (t.title || '').toLowerCase().includes(ql)
                );
            } else {
                results.value = mapped;
            }
        } catch (e) {
            const ql = raw.toLowerCase();
            results.value = threads.value.filter((t) =>
                (t.title || '').toLowerCase().includes(ql)
            );
            // eslint-disable-next-line no-console
            console.warn('[useThreadSearch] fallback substring search used', e);
        }
    }

    watch(threads, async () => {
        await ensureIndex();
        await runSearch();
    });

    let debounceTimer: any;
    watch(query, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 120);
    });

    return { query, results, ready, busy, rebuild: ensureIndex, runSearch };
}

export default useThreadSearch;
````

## File: app/db/client.ts
````typescript
import Dexie, { type Table } from 'dexie';
import type { Attachment, Kv, Message, Project, Thread } from './schema';

// Dexie database versioning & schema
export class Or3DB extends Dexie {
    projects!: Table<Project, string>;
    threads!: Table<Thread, string>;
    messages!: Table<Message, string>;
    kv!: Table<Kv, string>;
    attachments!: Table<Attachment, string>;

    constructor() {
        super('or3-db');

        this.version(1).stores({
            // Primary key & indexes
            projects: 'id, name, clock, created_at, updated_at',
            threads:
                'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
            messages:
                'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at',
            kv: 'id, &name, clock, created_at, updated_at',
            attachments: 'id, type, name, clock, created_at, updated_at',
        });
    }
}

export const db = new Or3DB();
````

## File: app/pages/home.vue
````vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
````

## File: app/pages/homepage.vue
````vue
<template><div>hello</div></template>
<script lang="ts" setup></script>
````

## File: app/pages/openrouter-callback.vue
````vue
<template>
    <div class="min-h-screen flex items-center justify-center p-6">
        <div
            class="w-full max-w-md rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/70 dark:bg-neutral-900/70 backdrop-blur p-5 text-center"
        >
            <p class="text-base font-medium mb-2">
                {{ title }}
            </p>
            <p class="text-sm text-neutral-500 mb-4">
                {{ subtitle }}
            </p>
            <div class="flex items-center justify-center gap-3">
                <div
                    v-if="loading"
                    class="w-5 h-5 rounded-full border-2 border-neutral-300 border-t-neutral-700 dark:border-neutral-700 dark:border-t-white animate-spin"
                />
                <button
                    v-if="ready"
                    class="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-500"
                    @click="goHome"
                >
                    Continue
                </button>
                <button
                    v-if="errorMessage"
                    class="px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-500"
                    @click="goHome"
                >
                    Go Home
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { kv } from '~/db';

const route = useRoute();
const router = useRouter();
const rc = useRuntimeConfig();

const loading = ref(true);
const ready = ref(false);
const redirecting = ref(false);
const errorMessage = ref('');
const title = computed(() =>
    errorMessage.value
        ? 'Login completed with warnings'
        : ready.value
        ? 'Login complete'
        : 'Completing login…'
);
const subtitle = computed(() => {
    if (errorMessage.value) return errorMessage.value;
    if (ready.value && !redirecting.value)
        return 'If this page doesn’t redirect automatically, tap Continue.';
    return 'Please wait while we finish setup.';
});

function log(...args) {
    try {
        // eslint-disable-next-line no-console
        console.log('[openrouter-callback]', ...args);
    } catch {}
}

async function setKVNonBlocking(key, value, timeoutMs = 300) {
    try {
        if (!kv?.set) return;
        log(`syncing key to KV via kvByName.set (timeout ${timeoutMs}ms)`);
        const result = await Promise.race([
            kv.set(key, value),
            new Promise((res) => setTimeout(() => res('timeout'), timeoutMs)),
        ]);
        if (result === 'timeout') log('setKV timed out; continuing');
        else log('setKV resolved');
    } catch (e) {
        log('setKV failed', e?.message || e);
    }
}

async function goHome() {
    redirecting.value = true;
    log("goHome() invoked. Trying router.replace('/').");
    try {
        await router.replace('/');
        log("router.replace('/') resolved");
    } catch (e) {
        log("router.replace('/') failed:", e?.message || e);
    }
    try {
        // Fallback to full document navigation
        log("Attempting window.location.replace('/')");
        window.location.replace('/');
    } catch (e) {
        log("window.location.replace('/') failed:", e?.message || e);
    }
    // Last-chance fallback on browsers that ignore replace
    setTimeout(() => {
        try {
            log("Attempting final window.location.assign('/')");
            window.location.assign('/');
        } catch (e) {
            log("window.location.assign('/') failed:", e?.message || e);
        }
    }, 150);
}

onMounted(async () => {
    log('mounted at', window.location.href, 'referrer:', document.referrer);
    const code = route.query.code;
    const state = route.query.state;
    const verifier = sessionStorage.getItem('openrouter_code_verifier');
    const savedState = sessionStorage.getItem('openrouter_state');
    const codeMethod =
        sessionStorage.getItem('openrouter_code_method') || 'S256';
    log('query params present:', {
        code: Boolean(code),
        state: Boolean(state),
    });
    log('session present:', {
        verifier: Boolean(verifier),
        savedState: Boolean(savedState),
        codeMethod,
    });

    if (!code || !verifier) {
        console.error('[openrouter-callback] Missing code or verifier');
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Missing code or verifier. Tap Continue to return.';
        return;
    }
    if (savedState && state !== savedState) {
        console.error('[openrouter-callback] State mismatch, potential CSRF', {
            incoming: state,
            savedState,
        });
        loading.value = false;
        ready.value = true;
        errorMessage.value = 'State mismatch. Tap Continue to return.';
        return;
    }

    try {
        // Call OpenRouter directly per docs: https://openrouter.ai/api/v1/auth/keys
        log('exchanging code with OpenRouter', {
            endpoint: 'https://openrouter.ai/api/v1/auth/keys',
            codeLength: String(code).length,
            method: codeMethod,
            usingHTTPS: true,
        });
        const directResp = await fetch(
            'https://openrouter.ai/api/v1/auth/keys',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: String(code),
                    code_verifier: verifier,
                    code_challenge_method: codeMethod,
                }),
            }
        );
        const directJson = await directResp.json().catch(async () => {
            const text = await directResp.text().catch(() => '<no-body>');
            log('non-JSON response body snippet:', text?.slice(0, 300));
            return null;
        });
        if (!directResp.ok || !directJson) {
            console.error(
                '[openrouter-callback] Direct exchange failed',
                directResp.status,
                directJson
            );
            return;
        }
        const userKey = directJson.key || directJson.access_token;
        if (!userKey) {
            console.error(
                '[openrouter-callback] Direct exchange returned no key',
                {
                    keys: Object.keys(directJson || {}),
                }
            );
            return;
        }
        // store in localStorage for use by front-end
        log('storing key in localStorage (length)', String(userKey).length);
        // Save a human-readable name and the value; id/clock are handled
        // inside the helper to match your schema
        try {
            await kv.set('openrouter_api_key', userKey);
        } catch (e) {
            log('kvByName.set failed', e?.message || e);
        }
        try {
            log('dispatching openrouter:connected event');
            window.dispatchEvent(new CustomEvent('openrouter:connected'));
            // Best-effort: also persist to synced KV
            try {
                await setKVNonBlocking('openrouter_api_key', userKey, 300);
            } catch {}
        } catch {}
        log('clearing session markers (verifier/state/method)');
        sessionStorage.removeItem('openrouter_code_verifier');
        sessionStorage.removeItem('openrouter_state');
        sessionStorage.removeItem('openrouter_code_method');
        // Allow event loop to process storage events in other tabs/components
        await new Promise((r) => setTimeout(r, 10));
        loading.value = false;
        ready.value = true;
        log('ready to redirect');
        // Attempt auto-redirect but keep the Continue button visible
        setTimeout(() => {
            // first SPA attempt
            log("auto: router.replace('/')");
            router.replace('/').catch((e) => {
                log('auto: router.replace failed', e?.message || e);
            });
            // then a hard replace if SPA was blocked
            setTimeout(() => {
                try {
                    log("auto: window.location.replace('/')");
                    window.location.replace('/');
                } catch (e) {
                    log(
                        'auto: window.location.replace failed',
                        e?.message || e
                    );
                }
            }, 250);
        }, 50);
    } catch (err) {
        console.error('[openrouter-callback] Exchange failed', err);
        loading.value = false;
        ready.value = true;
        errorMessage.value =
            'Authentication finished, but we couldn’t auto-redirect.';
    }
});
</script>
````

## File: app/plugins/hooks.client.ts
````typescript
import { defineNuxtPlugin } from '#app';
import { createHookEngine, type HookEngine } from '../utils/hooks';

// Client: keep a singleton across HMR to avoid duplicate engines
export default defineNuxtPlugin(() => {
    const g = globalThis as any;
    let engine: HookEngine;
    if (!g.__NUXT_HOOKS__) {
        g.__NUXT_HOOKS__ = createHookEngine();
    }
    engine = g.__NUXT_HOOKS__ as HookEngine;

    // Optional: on HMR module dispose, we could clean up or keep state.
    if (import.meta.hot) {
        // No-op by default; disposers in useHookEffect handle duplicates.
    }

    return {
        provide: {
            hooks: engine,
        },
    };
});
````

## File: app/plugins/hooks.server.ts
````typescript
import { defineNuxtPlugin } from '#app';
import { createHookEngine } from '../utils/hooks';

// Server: create a fresh engine per request for SSR safety
export default defineNuxtPlugin(() => {
    const engine = createHookEngine();
    return {
        provide: {
            hooks: engine,
        },
    };
});
````

## File: app/plugins/theme.client.ts
````typescript
export default defineNuxtPlugin((nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const storageKey = 'theme';
    const root = document.documentElement;

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
    };

    const read = () => localStorage.getItem(storageKey) as string | null;

    let current = read() || getSystemPref();
    apply(current);

    const set = (name: string) => {
        current = name;
        localStorage.setItem(storageKey, name);
        apply(name);
    };

    const toggle = () => set(current === 'dark' ? 'light' : 'dark');

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
        if (!read()) {
            current = e.matches ? 'dark' : 'light';
            apply(current);
        }
    };
    media.addEventListener('change', onChange);

    nuxtApp.hook('app:beforeMount', () => {
        current = read() || getSystemPref();
        apply(current);
    });

    // Cleanup for HMR in dev so we don't stack listeners
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            media.removeEventListener('change', onChange)
        );
    }

    nuxtApp.provide('theme', {
        set,
        toggle,
        get: () => current,
        system: getSystemPref,
    });
});
````

## File: app/state/global.ts
````typescript
import { openrouter } from '@openrouter/ai-sdk-provider';
import { ref } from 'vue';

export const state = ref({
    openrouterKey: '' as string | null,
});
````

## File: app/utils/hooks.ts
````typescript
// Lightweight, type-safe hook engine for Nuxt/Vue apps
// - Supports actions (side-effects) and filters (value transform)
// - Priority scheduling (lower runs earlier)
// - Sync/async execution APIs
// - Error and timing wrappers
// - Optional wildcard matching via simple glob to RegExp

export type HookKind = 'action' | 'filter';

type AnyFn = (...args: any[]) => any;

export interface RegisterOptions {
    priority?: number; // default 10
    acceptedArgs?: number; // reserved for compatibility, not used
}

export interface OnOptions extends RegisterOptions {
    kind?: HookKind;
}

interface CallbackEntry<F extends AnyFn = AnyFn> {
    fn: F;
    priority: number;
    id: number; // tiebreaker to preserve insertion order
    name: string; // original name/pattern used to register
}

interface CompiledPattern {
    pattern: string;
    regex: RegExp;
}

function globToRegExp(glob: string): RegExp {
    // Escape regex special chars, then replace '*' with '.*'
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function sortCallbacks<T extends CallbackEntry>(arr: T[]): T[] {
    return arr.sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export interface HookEngine {
    // filters
    addFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeFilter: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    applyFilters: <T>(name: string, value: T, ...args: any[]) => Promise<T>;
    applyFiltersSync: <T>(name: string, value: T, ...args: any[]) => T;

    // actions
    addAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number,
        acceptedArgs?: number
    ) => void;
    removeAction: <F extends AnyFn>(
        name: string,
        fn: F,
        priority?: number
    ) => void;
    doAction: (name: string, ...args: any[]) => Promise<void>;
    doActionSync: (name: string, ...args: any[]) => void;

    // utils
    hasFilter: (name?: string, fn?: AnyFn) => boolean | number;
    hasAction: (name?: string, fn?: AnyFn) => boolean | number;
    removeAllCallbacks: (priority?: number) => void;
    currentPriority: () => number | false;

    // ergonomics
    onceAction: (name: string, fn: AnyFn, priority?: number) => () => void;
    on: (name: string, fn: AnyFn, opts?: OnOptions) => () => void; // disposer
    off: (disposer: () => void) => void;

    // diagnostics (best-effort)
    _diagnostics: {
        timings: Record<string, number[]>; // name -> array of durations (ms)
        errors: Record<string, number>; // name -> error count
        callbacks(actionOrFilter?: HookKind): number; // total callbacks registered
    };
}

export function createHookEngine(): HookEngine {
    const DEFAULT_PRIORITY = 10;
    let counter = 0; // id tiebreaker
    const currentPriorityStack: number[] = [];

    // Separate stores for actions and filters
    const actions = new Map<string, CallbackEntry[]>();
    const filters = new Map<string, CallbackEntry[]>();

    // Wildcard registrations are stored separately with compiled regex for fast matching
    const actionWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];
    const filterWildcards: {
        pattern: CompiledPattern;
        entry: CallbackEntry;
    }[] = [];

    // Helpers to get matching callbacks (exact + wildcards)
    function getMatching(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string
    ): CallbackEntry[] {
        const list = map.get(name)
            ? [...(map.get(name) as CallbackEntry[])]
            : [];
        if (wildcards.length) {
            for (const { pattern, entry } of wildcards) {
                if (pattern.regex.test(name)) list.push(entry);
            }
        }
        return sortCallbacks(list);
    }

    function add(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
        const entry: CallbackEntry = { fn, priority: p, id: ++counter, name };
        if (name.includes('*')) {
            wildcards.push({
                pattern: { pattern: name, regex: globToRegExp(name) },
                entry,
            });
        } else {
            const arr = map.get(name) || [];
            arr.push(entry);
            map.set(name, arr);
        }
    }

    function remove(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name: string,
        fn: AnyFn,
        priority?: number
    ) {
        const p = typeof priority === 'number' ? priority : undefined;
        if (name.includes('*')) {
            const idx = wildcards.findIndex(
                (wc) =>
                    wc.pattern.pattern === name &&
                    wc.entry.fn === fn &&
                    (p === undefined || wc.entry.priority === p)
            );
            if (idx >= 0) wildcards.splice(idx, 1);
        } else {
            const arr = map.get(name);
            if (!arr) return;
            const filtered = arr.filter(
                (e) => !(e.fn === fn && (p === undefined || e.priority === p))
            );
            if (filtered.length) map.set(name, filtered);
            else map.delete(name);
        }
    }

    function has(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        name?: string,
        fn?: AnyFn
    ): boolean | number {
        if (!name) {
            // any callbacks at all?
            return (
                Array.from(map.values()).some((a) => a.length > 0) ||
                wildcards.length > 0
            );
        }
        if (fn) {
            const arr = map.get(name) || [];
            const found = arr.find((e) => e.fn === fn);
            if (found) return found.priority;
            // also check wildcards matching the same original pattern string
            const wc = wildcards.find(
                (wc) => wc.pattern.pattern === name && wc.entry.fn === fn
            );
            return wc ? wc.entry.priority : false;
        }
        const arr = map.get(name) || [];
        const any =
            arr.length > 0 ||
            wildcards.some((wc) => wc.pattern.regex.test(name));
        return any;
    }

    function removeAll(
        map: Map<string, CallbackEntry[]>,
        wildcards: { pattern: CompiledPattern; entry: CallbackEntry }[],
        priority?: number
    ) {
        if (priority === undefined) {
            map.clear();
            wildcards.length = 0;
            return;
        }
        for (const [k, arr] of map) {
            const filtered = arr.filter((e) => e.priority !== priority);
            if (filtered.length) map.set(k, filtered);
            else map.delete(k);
        }
        for (let i = wildcards.length - 1; i >= 0; i--) {
            const wc = wildcards[i];
            if (wc && wc.entry.priority === priority) wildcards.splice(i, 1);
        }
    }

    function recordTiming(name: string, ms: number) {
        (diagnostics.timings[name] ||= []).push(ms);
    }

    function recordError(name: string) {
        diagnostics.errors[name] = (diagnostics.errors[name] || 0) + 1;
    }

    async function callAsync(
        cbs: CallbackEntry[],
        name: string,
        args: any[],
        isFilter: boolean,
        initialValue?: any
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                // Maintain current priority during execution
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = await fn(value, ...args);
                    } else {
                        await fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    function callSync(
        cbs: CallbackEntry[],
        name: string,
        args: any[],
        isFilter: boolean,
        initialValue?: any
    ) {
        {
            const firstPriority =
                cbs.length > 0 ? cbs[0]!.priority : DEFAULT_PRIORITY;
            currentPriorityStack.push(firstPriority);
        }
        try {
            let value = initialValue;
            for (const { fn, priority } of cbs) {
                if (currentPriorityStack.length)
                    currentPriorityStack[currentPriorityStack.length - 1] =
                        priority;
                const start =
                    typeof performance !== 'undefined' && performance.now
                        ? performance.now()
                        : Date.now();
                try {
                    if (isFilter) {
                        value = fn(value, ...args);
                    } else {
                        fn(...args);
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(
                        `[hooks] Error in ${
                            isFilter ? 'filter' : 'action'
                        } "${name}":`,
                        err
                    );
                    recordError(name);
                } finally {
                    const end =
                        typeof performance !== 'undefined' && performance.now
                            ? performance.now()
                            : Date.now();
                    recordTiming(name, end - start);
                }
            }
            return value;
        } finally {
            currentPriorityStack.pop();
        }
    }

    const diagnostics = {
        timings: {} as Record<string, number[]>,
        errors: {} as Record<string, number>,
        callbacks(kind?: HookKind) {
            const count = (
                map: Map<string, CallbackEntry[]>,
                wc: { pattern: CompiledPattern; entry: CallbackEntry }[]
            ) =>
                Array.from(map.values()).reduce((acc, a) => acc + a.length, 0) +
                wc.length;
            if (!kind)
                return (
                    count(actions, actionWildcards) +
                    count(filters, filterWildcards)
                );
            return kind === 'action'
                ? count(actions, actionWildcards)
                : count(filters, filterWildcards);
        },
    };

    const engine: HookEngine = {
        // filters
        addFilter(name, fn, priority, _acceptedArgs) {
            add(filters, filterWildcards, name, fn, priority);
        },
        removeFilter(name, fn, priority) {
            remove(filters, filterWildcards, name, fn, priority);
        },
        async applyFilters(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return await callAsync(cbs, name, args, true, value);
        },
        applyFiltersSync(name, value, ...args) {
            const cbs = getMatching(filters, filterWildcards, name);
            if (cbs.length === 0) return value;
            return callSync(cbs, name, args, true, value);
        },

        // actions
        addAction(name, fn, priority, _acceptedArgs) {
            add(actions, actionWildcards, name, fn, priority);
        },
        removeAction(name, fn, priority) {
            remove(actions, actionWildcards, name, fn, priority);
        },
        async doAction(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            await callAsync(cbs, name, args, false);
        },
        doActionSync(name, ...args) {
            const cbs = getMatching(actions, actionWildcards, name);
            if (cbs.length === 0) return;
            callSync(cbs, name, args, false);
        },

        // utils
        hasFilter(name?: string, fn?: AnyFn) {
            return has(filters, filterWildcards, name, fn);
        },
        hasAction(name?: string, fn?: AnyFn) {
            return has(actions, actionWildcards, name, fn);
        },
        removeAllCallbacks(priority?: number) {
            removeAll(actions, actionWildcards, priority);
            removeAll(filters, filterWildcards, priority);
        },
        currentPriority() {
            return currentPriorityStack.length
                ? currentPriorityStack[currentPriorityStack.length - 1]!
                : false;
        },

        // ergonomics
        onceAction(name: string, fn: AnyFn, priority?: number) {
            const wrapper = (...args: any[]) => {
                try {
                    fn(...args);
                } finally {
                    engine.removeAction(name, wrapper, priority);
                }
            };
            engine.addAction(name, wrapper, priority);
            return () => engine.removeAction(name, wrapper, priority);
        },
        on(name: string, fn: AnyFn, opts?: OnOptions) {
            const kind = opts?.kind ?? 'action';
            const priority = opts?.priority;
            if (kind === 'filter') engine.addFilter(name, fn, priority);
            else engine.addAction(name, fn, priority);
            return () => {
                if (kind === 'filter') engine.removeFilter(name, fn, priority);
                else engine.removeAction(name, fn, priority);
            };
        },
        off(disposer: () => void) {
            try {
                disposer();
            } catch {
                /* noop */
            }
        },

        _diagnostics: diagnostics,
    };

    return engine;
}

// Convenience type for imports in .d.ts
export type { AnyFn as HookFn };
````

## File: app/utils/models-service.ts
````typescript
// ModelsService: Fetch OpenRouter models, cache, and provide simple filters
// Source: https://openrouter.ai/api/v1/models
// Usage: import { modelsService } from "~/utils/models-service";

export interface OpenRouterModel {
    id: string; // e.g. "deepseek/deepseek-r1-0528:free"
    name: string;
    description?: string;
    created?: number;
    architecture?: {
        input_modalities?: string[];
        output_modalities?: string[];
        tokenizer?: string;
        instruct_type?: string;
    };
    top_provider?: {
        is_moderated?: boolean;
        context_length?: number;
        max_completion_tokens?: number;
    };
    pricing?: {
        prompt?: string; // USD per input token (stringified number)
        completion?: string; // USD per output token
        image?: string;
        request?: string;
        web_search?: string;
        internal_reasoning?: string;
        input_cache_read?: string;
        input_cache_write?: string;
    };
    canonical_slug?: string;
    context_length?: number;
    hugging_face_id?: string;
    per_request_limits?: Record<string, unknown>;
    supported_parameters?: string[]; // e.g. ["temperature","top_p","reasoning"]
}

interface ModelsResponse {
    data: OpenRouterModel[];
}

export interface ModelCatalogCache {
    data: OpenRouterModel[];
    fetchedAt: number;
}

const CACHE_KEY = 'openrouter_model_catalog_v1';

function readApiKey(): string | null {
    try {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('openrouter_api_key');
    } catch {
        return null;
    }
}

function saveCache(data: OpenRouterModel[]): void {
    try {
        if (typeof window === 'undefined') return;
        const payload: ModelCatalogCache = { data, fetchedAt: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {}
}

function loadCache(): ModelCatalogCache | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ModelCatalogCache;
        if (!Array.isArray(parsed?.data)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function toNumber(x?: string | number | null): number | null {
    if (x === undefined || x === null) return null;
    const n = typeof x === 'string' ? Number(x) : x;
    return Number.isFinite(n) ? n : null;
}

export async function fetchModels(opts?: {
    force?: boolean;
    ttlMs?: number;
}): Promise<OpenRouterModel[]> {
    const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60; // 1 hour
    if (!opts?.force) {
        const cached = loadCache();
        if (
            cached &&
            Date.now() - cached.fetchedAt <= ttlMs &&
            cached.data.length
        ) {
            return cached.data;
        }
    }

    const url = 'https://openrouter.ai/api/v1/models';
    const key = readApiKey();
    const headers: Record<string, string> = {};
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
        // Fallback to any cache on failure
        const cached = loadCache();
        if (cached?.data?.length) return cached.data;
        throw new Error(
            `Failed to fetch models: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as ModelsResponse;
    const list = Array.isArray(json?.data) ? json.data : [];
    saveCache(list);
    return list;
}

// Filters
export function filterByText(
    models: OpenRouterModel[],
    q: string
): OpenRouterModel[] {
    const query = q?.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => {
        const hay = `${m.id}\n${m.name || ''}\n${
            m.description || ''
        }`.toLowerCase();
        return hay.includes(query);
    });
}

export function filterByModalities(
    models: OpenRouterModel[],
    opts: { input?: string[]; output?: string[] } = {}
): OpenRouterModel[] {
    const { input, output } = opts;
    if (!input && !output) return models;
    return models.filter((m) => {
        const inOk =
            !input ||
            input.every((i) => m.architecture?.input_modalities?.includes(i));
        const outOk =
            !output ||
            output.every((o) => m.architecture?.output_modalities?.includes(o));
        return inOk && outOk;
    });
}

export function filterByContextLength(
    models: OpenRouterModel[],
    minCtx: number
): OpenRouterModel[] {
    if (!minCtx) return models;
    return models.filter((m) => {
        const ctx = m.top_provider?.context_length ?? m.context_length ?? 0;
        return (ctx || 0) >= minCtx;
    });
}

export function filterByParameters(
    models: OpenRouterModel[],
    params: string[]
): OpenRouterModel[] {
    if (!params?.length) return models;
    return models.filter((m) => {
        const supported = m.supported_parameters || [];
        return params.every((p) => supported.includes(p));
    });
}

export type PriceBucket = 'free' | 'low' | 'medium' | 'any';

export function filterByPriceBucket(
    models: OpenRouterModel[],
    bucket: PriceBucket
): OpenRouterModel[] {
    if (!bucket || bucket === 'any') return models;
    return models.filter((m) => {
        const p = toNumber(m.pricing?.prompt) ?? 0;
        const c = toNumber(m.pricing?.completion) ?? 0;
        const max = Math.max(p, c);
        if (bucket === 'free') return max === 0;
        if (bucket === 'low') return max > 0 && max <= 0.000002; // heuristic
        if (bucket === 'medium') return max > 0.000002 && max <= 0.00001;
        return true;
    });
}

export const modelsService = {
    fetchModels,
    filterByText,
    filterByModalities,
    filterByContextLength,
    filterByParameters,
    filterByPriceBucket,
};

export default modelsService;
````

## File: public/robots.txt
````
User-Agent: *
Disallow:
````

## File: types/orama.d.ts
````typescript
declare module 'orama' {
    export function create(options: any): Promise<any> | any;
    export function insertMultiple(db: any, docs: any[]): Promise<void> | void;
    export function search(db: any, opts: any): Promise<any> | any;
}

declare module '@orama/orama' {
    export function create(options: any): Promise<any> | any;
    export function insertMultiple(db: any, docs: any[]): Promise<void> | void;
    export function search(db: any, opts: any): Promise<any> | any;
}
````

## File: .gitignore
````
# Nuxt dev/build outputs
.output
.data
.nuxt
.nitro
.cache
dist

# Node dependencies
node_modules

# Logs
logs
*.log

# Misc
.DS_Store
.fleet
.idea

# Local env files
.env
.env.*
!.env.example
````

## File: app.config.ts
````typescript
// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: [
                    'rounded-full font-bold inline-flex items-center disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:opacity-75 aria-disabled:opacity-75',
                    'transition-colors',
                    'border border-black',
                ],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            // Override size variant so padding wins over defaults
            variants: {
                size: {
                    md: {
                        base: 'px-6 py-3 gap-3',
                    },
                },
            },
        },
    },
});
````

## File: tsconfig.json
````json
{
  // https://nuxt.com/docs/guide/concepts/typescript
  "files": [],
  "references": [
    {
      "path": "./.nuxt/tsconfig.app.json"
    },
    {
      "path": "./.nuxt/tsconfig.server.json"
    },
    {
      "path": "./.nuxt/tsconfig.shared.json"
    },
    {
      "path": "./.nuxt/tsconfig.node.json"
    }
  ]
}
````

## File: app/composables/useModelStore.ts
````typescript
import { kv } from '~/db';
import modelsService, {
    type OpenRouterModel,
    type PriceBucket,
} from '~/utils/models-service';

export function useModelStore() {
    const favoriteModels = ref<OpenRouterModel[]>([]);
    const catalog = ref<OpenRouterModel[]>([]);

    const searchQuery = ref('');
    const filters = ref<{
        input?: string[];
        output?: string[];
        minContext?: number;
        parameters?: string[];
        price?: PriceBucket;
    }>({});

    async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
        const list = await modelsService.fetchModels(opts);

        catalog.value = list;
        return list;
    }

    const KV_KEY = 'favorite_models';

    async function persist() {
        try {
            await kv.set(KV_KEY, JSON.stringify(favoriteModels.value));
        } catch (e) {
            console.warn('[useModelStore] persist favorites failed', e);
        }
    }

    async function addFavoriteModel(model: OpenRouterModel) {
        if (favoriteModels.value.some((m) => m.id === model.id)) return; // dedupe
        favoriteModels.value.push(model);
        await persist();
    }

    async function removeFavoriteModel(model: OpenRouterModel) {
        favoriteModels.value = favoriteModels.value.filter(
            (m) => m.id !== model.id
        );
        await persist();
    }

    async function clearFavoriteModels() {
        favoriteModels.value = [];
        await persist();
    }

    async function getFavoriteModels() {
        try {
            const record: any = await kv.get(KV_KEY);
            const raw = record?.value;
            if (raw && typeof raw === 'string') {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    favoriteModels.value = parsed;
                } else {
                    favoriteModels.value = [];
                }
            } else {
                favoriteModels.value = [];
            }
        } catch {
            favoriteModels.value = [];
        }
        return favoriteModels.value;
    }

    return {
        favoriteModels,
        catalog,
        fetchModels,
        getFavoriteModels,
        addFavoriteModel,
        removeFavoriteModel,
        clearFavoriteModels,
    };
}
````

## File: app/db/util.ts
````typescript
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export function parseOrThrow<TSchema extends ZodTypeAny>(
    schema: TSchema,
    data: unknown
): ZodInfer<TSchema> {
    const res = schema.safeParse(data as any);
    if (!res.success) throw new Error(res.error.message);
    return res.data as ZodInfer<TSchema>;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function newId(): string {
    // Prefer Web Crypto if available
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
````

## File: app/app.vue
````vue
<template>
    <UApp>
        <NuxtPage />
    </UApp>
</template>
<script setup lang="ts">
// Apply initial theme class to <html> so CSS variables cascade app-wide
useHead({
    htmlAttrs: {
        class: 'light',
    },
});
</script>
````

## File: nuxt.config.ts
````typescript
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: { enabled: true },
    modules: ['@nuxt/ui', '@nuxt/fonts'],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],
    fonts: {
        families: [
            { name: 'Press Start 2P', provider: 'google' },
            { name: 'VT323', provider: 'google' },
        ],
    },
});
````

## File: README.md
````markdown
# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

Additionally, see the project’s Hook/Action system guide: [docs/hooks.md](./docs/hooks.md).

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
````

## File: app/components/chat/ChatMessage.vue
````vue
<template>
    <div :class="outerClass" class="p-2 rounded-md my-2">
        <div :class="innerClass" v-html="rendered"></div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};

const props = defineProps<{ message: ChatMessage }>();

const outerClass = computed(() => ({
    'bg-primary text-white border-2 px-4 border-black retro-shadow backdrop-blur-sm w-fit self-end':
        props.message.role === 'user',
    'bg-white/5 border-2 w-full retro-shadow backdrop-blur-sm':
        props.message.role === 'assistant',
}));

const innerClass = computed(() => ({
    'prose max-w-none w-full leading-[1.5] prose-p:leading-normal prose-li:leading-normal prose-li:my-1 prose-ol:pl-5 prose-ul:pl-5 prose-headings:leading-tight prose-strong:font-semibold prose-h1:text-[28px] prose-h2:text-[24px] prose-h3:text-[20px] p-1 sm:p-5':
        props.message.role === 'assistant',
}));

const rendered = computed(() => marked.parse(props.message.content));
</script>

<style scoped></style>
````

## File: app/composables/useUserApiKey.ts
````typescript
import { computed } from 'vue';
import { db } from '~/db';
import { state } from '~/state/global';

export function useUserApiKey() {
    // Read from Dexie on client without awaiting the composable
    if (import.meta.client) {
        db.kv
            .where('name')
            .equals('openrouter_api_key')
            .first()
            .then((rec) => {
                if (rec && typeof rec.value === 'string') {
                    state.value.openrouterKey = rec.value;
                } else if (rec && rec.value == null) {
                    state.value.openrouterKey = null;
                }
            })
            .catch(() => {
                /* noop */
            });
    }

    function setKey(key: string) {
        state.value.openrouterKey = key;
    }

    function clearKey() {
        state.value.openrouterKey = null;
    }

    // Return a computed ref so callers can read `apiKey.value` and
    // still observe changes made to the shared state.
    const apiKey = computed(() => state.value.openrouterKey) as {
        readonly value: string | null;
    };

    return {
        apiKey,
        setKey,
        clearKey,
    };
}
````

## File: app/db/schema.ts
````typescript
import { z } from 'zod';
import { newId } from './util';

const nowSec = () => Math.floor(Date.now() / 1000);

export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type Project = z.infer<typeof ProjectSchema>;

// threads
export const ThreadSchema = z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    last_message_at: z.number().int().nullable().optional(),
    parent_thread_id: z.string().nullable().optional(),
    status: z.string().default('ready'),
    deleted: z.boolean().default(false),
    pinned: z.boolean().default(false),
    clock: z.number().int(),
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// For incoming create payloads (apply defaults like the DB)
export const ThreadCreateSchema = ThreadSchema.partial({
    // Make a wide set of fields optional for input; we'll supply defaults below
    id: true,
    title: true,
    last_message_at: true,
    parent_thread_id: true,
    status: true,
    deleted: true,
    pinned: true,
    forked: true,
    project_id: true,
})
    // We'll re-add with defaults/derived values
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Dynamic defaults while keeping inputs optional
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
// Use z.input so defaulted fields are optional for callers
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;
// messages
export const MessageSchema = z.object({
    id: z.string(),
    data: z.unknown().nullable().optional(),
    role: z.string(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    error: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    thread_id: z.string(),
    index: z.number().int(),
    clock: z.number().int(),
    stream_id: z.string().nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessageCreateSchema = MessageSchema.partial({ index: true })
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Keep inputs minimal; generate missing id/clock
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
// Use input type so callers can omit defaulted fields
export type MessageCreate = z.input<typeof MessageCreateSchema>;

// kv
export const KvSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
});
export type Kv = z.infer<typeof KvSchema>;

export const KvCreateSchema = KvSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type KvCreate = z.infer<typeof KvCreateSchema>;

// attachments
export const AttachmentSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.url(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentCreateSchema = AttachmentSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;
````

## File: docs/hooks.md
````markdown
# Hook/Action System for Nuxt

A lightweight, type-safe hook engine for the Nuxt frontend. It lets components, composables, and plugins subscribe to events (actions) or transform data (filters) with predictable ordering and SSR/HMR safety.

-   Actions: fire-and-forget side effects (logging, analytics, UI updates)
-   Filters: transform values in a pipeline (value-in → value-out)
-   Priorities: lower runs earlier (default 10)
-   Wildcards: use `*` to match patterns, e.g. `ui.*:action:after`

## Installation & Access

The engine is provided globally by Nuxt plugins:

-   Client: singleton instance across HMR
-   Server (SSR): fresh instance per request

Access anywhere:

```ts
import { useNuxtApp } from '#app';

const hooks = useNuxtApp().$hooks;
// or
import { useHooks } from '~/app/composables/useHooks';
const hooks2 = useHooks();
```

In components, prefer the lifecycle-safe composable:

```ts
import { useHookEffect } from '~/app/composables/useHookEffect';

useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

## API Overview

Engine methods:

-   Filters
    -   addFilter(name, fn, priority?, acceptedArgs?)
    -   removeFilter(name, fn, priority?)
    -   applyFilters(name, value, ...args) => Promise<Return>
    -   applyFiltersSync(name, value, ...args)
-   Actions
    -   addAction(name, fn, priority?, acceptedArgs?)
    -   removeAction(name, fn, priority?)
    -   doAction(name, ...args) => Promise<void>
    -   doActionSync(name, ...args)
-   Utils
    -   hasFilter(name?, fn?) => boolean|priority
    -   hasAction(name?, fn?) => boolean|priority
    -   removeAllCallbacks(priority?)
    -   currentPriority() => number|false
-   Ergonomics
    -   onceAction(name, fn, priority?)
    -   on(name, fn, { kind: 'action'|'filter', priority }) → disposer
    -   off(disposer)

Types are exported from `app/utils/hooks`.

## Hook Naming

Use hierarchical strings with dots/colons to keep hooks descriptive:

-   `app.init:action:after`
-   `ui.form.submit:filter:input`
-   `route.change:action:before`

Wildcards are supported with `*`, e.g. `ui.*:action:after`.

## Examples

### Subscribe to an action (component-safe)

```ts
// Track route changes
useHookEffect('route.change:action:after', (_ctx, to, from) => {
    console.log('navigated from', from, 'to', to);
});
```

### Fire an action

```ts
const hooks = useHooks();
await hooks.doAction('app.init:action:after', nuxtApp);
```

### Filter pipeline (async)

```ts
const hooks = useHooks();
const sanitized = await hooks.applyFilters(
    'ui.chat.message:filter:outgoing',
    rawPayload,
    { roomId }
);
```

### Filter pipeline (sync)

```ts
const result = hooks.applyFiltersSync(
    'ui.form.submit:filter:input',
    initialValues
);
```

### Wildcard subscription

```ts
const offAnyUiAfter = hooks.on(
    'ui.*:action:after',
    () => {
        console.log('some UI after-action fired');
    },
    { kind: 'action', priority: 5 }
);

// Later
hooks.off(offAnyUiAfter);
```

### Once-only action handler

```ts
hooks.onceAction('app.init:action:after', () => {
    console.log('init completed');
});
```

## Priorities

Callbacks execute in ascending priority. For equal priorities, insertion order is preserved. Default priority is 10.

```ts
hooks.on('ui.form.submit:action:before', fnA, { kind: 'action', priority: 5 });
hooks.on('ui.form.submit:action:before', fnB); // runs after fnA (priority 10)
```

## SSR and HMR Safety

-   Server: a new engine instance is created per request to avoid state leakage.
-   Client: a singleton engine is reused across HMR; component-level disposers prevent duplicate handlers.
-   `useHookEffect` automatically unregisters on component unmount and on module dispose during HMR.

## Error Handling & Timing

All callbacks are wrapped in try/catch. Errors are logged to the console and per-hook error counters are incremented. Basic timings are recorded:

```ts
const { timings, errors, callbacks } = hooks._diagnostics;
console.log('timings for hook', timings['ui.form.submit:action:before']);
console.log('error count for hook', errors['ui.form.submit:action:before']);
console.log('total callbacks registered', callbacks());
```

## Recommendations

-   Keep hook names consistent and scoped (e.g., `ui.form.*`, `route.*`).
-   Use filters for transformations and actions for side effects.
-   Prefer `useHookEffect` inside components; use `hooks.on/off` in non-component modules.
-   Consider using wildcards for broad tracing during development.

## Files

-   Engine: `app/utils/hooks.ts`
-   Plugins: `app/plugins/hooks.client.ts`, `app/plugins/hooks.server.ts`
-   Composables: `app/composables/useHooks.ts`, `app/composables/useHookEffect.ts`
-   Types: `types/nuxt.d.ts` adds `$hooks` to `NuxtApp`

---

Future ideas:

-   Vue DevTools timeline integration
-   Inspector UI listing current callbacks
-   Debounced/throttled variants
-   Unit tests and benchmarks

## DB integration hooks

The app/db modules are instrumented with hooks at important lifecycle points. You can transform inputs with filters and observe mutations with actions.

Entities covered: attachments, kv, projects, threads, messages.

Common patterns:

-   Create
    -   `db.{entity}.create:filter:input` — transform input prior to validation
    -   `db.{entity}.create:action:before` — before persisting
    -   `db.{entity}.create:action:after` — after persisting
-   Upsert
    -   `db.{entity}.upsert:filter:input`
    -   `db.{entity}.upsert:action:before`
    -   `db.{entity}.upsert:action:after`
-   Delete
    -   Soft: `db.{entity}.delete:action:soft:before|after`
    -   Hard: `db.{entity}.delete:action:hard:before|after`
-   Get/Queries (output filters)
    -   `db.{entity}.get:filter:output`
    -   kv: `db.kv.getByName:filter:output`
    -   threads: `db.threads.byProject:filter:output`, `db.threads.searchByTitle:filter:output`, `db.threads.children:filter:output`
    -   messages: `db.messages.byThread:filter:output`, `db.messages.byStream:filter:output`
-   Advanced operations
    -   messages: `db.messages.append|move|copy|insertAfter|normalize:action:before|after`
    -   threads: `db.threads.fork:action:before|after`

### Examples

Redact fields from project reads:

```ts
useHookEffect(
    'db.projects.get:filter:output',
    (project) =>
        project ? (({ secret, ...rest }) => rest)(project as any) : project,
    { kind: 'filter' }
);
```

Stamp updated_at on all message upserts:

```ts
useHookEffect(
    'db.messages.upsert:filter:input',
    (value) => ({ ...value, updated_at: Math.floor(Date.now() / 1000) }),
    { kind: 'filter', priority: 5 }
);
```

Track thread forks and clones:

```ts
useHookEffect('db.threads.fork:action:before', ({ source, fork }) => {
    console.log('Forking thread', source.id, '→', fork.id);
});
useHookEffect('db.threads.fork:action:after', (fork) => {
    console.log('Fork created', fork.id);
});
```

Audit deletes (soft and hard):

```ts
useHookEffect('db.*.delete:action:soft:after', (entity) => {
    console.log('Soft-deleted', entity?.id ?? entity);
});
useHookEffect('db.*.delete:action:hard:after', (id) => {
    console.log('Hard-deleted id', id);
});
```

Normalize and observe message index compaction:

```ts
useHookEffect('db.messages.normalize:action:before', ({ threadId }) => {
    console.log('Normalizing indexes for thread', threadId);
});
```

Note: Query output filters run after the underlying Dexie query resolves, allowing you to reshape or sanitize results before they’re returned to callers.

## AI chat hooks

The `useChat` composable is instrumented so you can shape the chat flow without forking the code.

Hook names:

-   Outgoing user text
    -   `ui.chat.message:filter:outgoing` — sanitize/augment the user input
-   Model & input overrides
    -   `ai.chat.model:filter:select` — select/override model id (default `openai/gpt-4`)
    -   `ai.chat.messages:filter:input` — modify message array sent to the model
-   Send lifecycle
    -   `ai.chat.send:action:before` — before streaming starts
    -   `ai.chat.stream:action:delta` — for each streamed text delta
    -   `ui.chat.message:filter:incoming` — transform the final assistant text
    -   `ai.chat.send:action:after` — after full response is appended
-   Errors
    -   `ai.chat.error:action` — on exceptions during send/stream

Examples:

Override the model:

```ts
useHookEffect('ai.chat.model:filter:select', () => 'openai/gpt-4o-mini', {
    kind: 'filter',
});
```

Trim outgoing user text and collapse whitespace:

```ts
useHookEffect(
    'ui.chat.message:filter:outgoing',
    (text) => text.trim().replace(/\s+/g, ' '),
    { kind: 'filter' }
);
```

Inspect streaming deltas for live UI effects:

```ts
useHookEffect('ai.chat.stream:action:delta', (delta) => {
    // e.g., update a typing indicator or progress UI
    console.debug('delta:', delta);
});
```

Post-process the assistant response:

```ts
useHookEffect(
    'ui.chat.message:filter:incoming',
    (text) => text.replaceAll('\n\n', '\n'),
    { kind: 'filter' }
);
```

Capture errors for telemetry:

```ts
useHookEffect('ai.chat.error:action', (err) => {
    console.error('Chat error', err);
});
```
````

## File: types/nuxt.d.ts
````typescript
// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            set: (name: string) => void;
            toggle: () => void; // Already exists
            get: () => string; // Already exists
            system: () => 'light' | 'dark';
        };
        $hooks: import('../app/utils/hooks').HookEngine;
    }
}

export {};
````

## File: app/db/attachments.ts
````typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import {
    AttachmentCreateSchema,
    AttachmentSchema,
    type Attachment,
    type AttachmentCreate,
} from './schema';

export async function createAttachment(
    input: AttachmentCreate
): Promise<Attachment> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.create:filter:input',
        input
    );
    await hooks.doAction('db.attachments.create:action:before', filtered);
    const value = parseOrThrow(AttachmentCreateSchema, filtered);
    await db.attachments.put(value);
    await hooks.doAction('db.attachments.create:action:after', value);
    return value;
}

export async function upsertAttachment(value: Attachment): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.attachments.upsert:filter:input',
        value
    );
    await hooks.doAction('db.attachments.upsert:action:before', filtered);
    parseOrThrow(AttachmentSchema, filtered);
    await db.attachments.put(filtered);
    await hooks.doAction('db.attachments.upsert:action:after', filtered);
}

export async function softDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.attachments, async () => {
        const a = await db.attachments.get(id);
        if (!a) return;
        await hooks.doAction('db.attachments.delete:action:soft:before', a);
        await db.attachments.put({
            ...a,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.attachments.delete:action:soft:after', a);
    });
}

export async function hardDeleteAttachment(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.attachments.get(id);
    await hooks.doAction(
        'db.attachments.delete:action:hard:before',
        existing ?? id
    );
    await db.attachments.delete(id);
    await hooks.doAction('db.attachments.delete:action:hard:after', id);
}

export async function getAttachment(id: string) {
    const hooks = useHooks();
    const res = await db.attachments.get(id);
    return hooks.applyFilters('db.attachments.get:filter:output', res);
}
````

## File: app/db/index.ts
````typescript
import { db } from './client';
import type {
    Attachment,
    AttachmentCreate,
    Kv,
    KvCreate,
    Message,
    MessageCreate,
    Project,
    Thread,
    ThreadCreate,
} from './schema';
import {
    createThread,
    searchThreadsByTitle,
    threadsByProject,
    upsertThread,
    softDeleteThread,
    hardDeleteThread,
} from './threads';
import {
    appendMessage,
    createMessage,
    messagesByThread,
    moveMessage,
    copyMessage,
    getMessage,
    messageByStream,
    softDeleteMessage,
    upsertMessage,
    hardDeleteMessage,
} from './messages';
import {
    createKv,
    upsertKv,
    hardDeleteKv,
    getKv,
    getKvByName,
    setKvByName,
    hardDeleteKvByName,
} from './kv';
import {
    createAttachment,
    upsertAttachment,
    softDeleteAttachment,
    hardDeleteAttachment,
    getAttachment,
} from './attachments';
import {
    createProject,
    upsertProject,
    softDeleteProject,
    hardDeleteProject,
    getProject,
} from './projects';

// Barrel API (backward compatible shape)
export { db } from './client';

export const create = {
    thread: createThread,
    message: createMessage,
    kv: createKv,
    attachment: createAttachment,
    project: createProject,
};

export const upsert = {
    thread: upsertThread,
    message: upsertMessage,
    kv: upsertKv,
    attachment: upsertAttachment,
    project: upsertProject,
};

export const queries = {
    threadsByProject,
    messagesByThread,
    searchThreadsByTitle,
    getMessage,
    messageByStream,
    getKv,
    getKvByName,
    getAttachment,
    getProject,
};

export const del = {
    // soft deletes
    soft: {
        project: softDeleteProject,
        thread: softDeleteThread,
        message: softDeleteMessage,
        attachment: softDeleteAttachment,
        // kv has no deleted flag; only hard delete is supported
    },
    // hard deletes (destructive)
    hard: {
        project: hardDeleteProject,
        thread: hardDeleteThread,
        message: hardDeleteMessage,
        attachment: hardDeleteAttachment,
        kv: hardDeleteKv,
        kvByName: hardDeleteKvByName,
    },
};

export const tx = {
    appendMessage,
    moveMessage,
    copyMessage,
};

// Shorthand helpers for common KV flows
export const kv = {
    get: getKvByName,
    set: setKvByName,
    delete: hardDeleteKvByName,
};

export type {
    Thread,
    ThreadCreate,
    Message,
    MessageCreate,
    Kv,
    KvCreate,
    Attachment,
    AttachmentCreate,
    Project,
};
````

## File: app/db/projects.ts
````typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { ProjectSchema, type Project } from './schema';

export async function createProject(input: Project): Promise<Project> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.create:filter:input',
        input
    );
    await hooks.doAction('db.projects.create:action:before', filtered);
    const value = parseOrThrow(ProjectSchema, filtered);
    await db.projects.put(value);
    await hooks.doAction('db.projects.create:action:after', value);
    return value;
}

export async function upsertProject(value: Project): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.projects.upsert:filter:input',
        value
    );
    await hooks.doAction('db.projects.upsert:action:before', filtered);
    parseOrThrow(ProjectSchema, filtered);
    await db.projects.put(filtered);
    await hooks.doAction('db.projects.upsert:action:after', filtered);
}

export async function softDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.projects, async () => {
        const p = await db.projects.get(id);
        if (!p) return;
        await hooks.doAction('db.projects.delete:action:soft:before', p);
        await db.projects.put({
            ...p,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.projects.delete:action:soft:after', p);
    });
}

export async function hardDeleteProject(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.projects.get(id);
    await hooks.doAction(
        'db.projects.delete:action:hard:before',
        existing ?? id
    );
    await db.projects.delete(id);
    await hooks.doAction('db.projects.delete:action:hard:after', id);
}

export async function getProject(id: string) {
    const hooks = useHooks();
    const res = await db.projects.get(id);
    return hooks.applyFilters('db.projects.get:filter:output', res);
}
````

## File: app/components/modal/SettingsModal.vue
````vue
<template>
    <UModal
        v-model:open="open"
        title="Rename thread"
        :ui="{
            footer: 'justify-end border-t-2',
            header: 'border-b-2  border-black bg-primary p-0 min-h-[50px] text-white',
            body: 'p-0!',
        }"
        class="border-2 w-full sm:min-w-[720px]! overflow-hidden"
    >
        <template #header>
            <div class="flex w-full items-center justify-between pr-2">
                <h3 class="font-semibold text-sm pl-2">Settings</h3>
                <UButton
                    class="bg-white/90 hover:bg-white/95 active:bg-white/95 flex items-center justify-center"
                    :square="true"
                    variant="ghost"
                    size="xs"
                    icon="i-heroicons-x-mark"
                    @click="open = false"
                />
            </div>
        </template>
        <template #body>
            <div class="flex flex-col h-full">
                <div
                    class="px-6 border-b-2 border-black h-[50px] dark:border-white/10 bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm flex items-center"
                >
                    <div class="relative w-full max-w-md">
                        <UInput
                            v-model="searchQuery"
                            icon="i-heroicons-magnifying-glass-20-solid"
                            placeholder="Search models (id, name, description, modality)"
                            size="sm"
                            class="w-full pr-8"
                            :ui="{ base: 'w-full' }"
                            autofocus
                        />
                        <button
                            v-if="searchQuery"
                            type="button"
                            aria-label="Clear search"
                            class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                            @click="searchQuery = ''"
                        >
                            <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
                        </button>
                    </div>
                </div>
                <div v-if="!searchReady" class="p-6 text-sm text-neutral-500">
                    Indexing models…
                </div>
                <div v-else class="flex-1 min-h-0">
                    <VList
                        :data="chunkedModels as OpenRouterModel[][]"
                        style="height: 70vh"
                        class="[scrollbar-color:rgb(156_163_175)_transparent] [scrollbar-width:thin] sm:py-4 w-full px-0!"
                        :overscan="4"
                        #default="{ item: row }"
                    >
                        <div
                            class="grid grid-cols-1 sm:grid-cols-2 sm:gap-5 px-6 w-full"
                            :class="gridColsClass"
                        >
                            <div
                                v-for="m in row"
                                :key="m.id"
                                class="group relative mb-5 retro-shadow flex flex-col justify-between rounded-xl border-2 border-black/90 dark:border-white/90 bg-white/80 dark:bg-neutral-900/70 backdrop-blur-sm shadow-sm hover:shadow-md transition overflow-hidden h-[170px] px-4 py-5"
                            >
                                <div
                                    class="flex items-start justify-between gap-2"
                                >
                                    <div class="flex flex-col min-w-0">
                                        <div
                                            class="font-medium text-sm truncate"
                                            :title="m.canonical_slug"
                                        >
                                            {{ m.canonical_slug }}
                                        </div>
                                        <div
                                            class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                                        >
                                            CTX {{ m.context_length }}
                                        </div>
                                    </div>
                                    <button
                                        class="text-yellow-400 hover:text-yellow-500 hover:text-shadow-sm transition text-[24px]"
                                        :aria-pressed="isFavorite(m)"
                                        @click.stop="toggleFavorite(m)"
                                        :title="
                                            isFavorite(m)
                                                ? 'Unfavorite'
                                                : 'Favorite'
                                        "
                                    >
                                        <span v-if="isFavorite(m)">★</span>
                                        <span v-else>☆</span>
                                    </button>
                                </div>
                                <div
                                    class="mt-2 grid grid-cols-2 gap-1 text-xs leading-tight"
                                >
                                    <div class="flex flex-col">
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Input</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.prompt,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                    <div
                                        class="flex flex-col items-end text-right"
                                    >
                                        <span
                                            class="text-neutral-500 dark:text-neutral-400"
                                            >Output</span
                                        >
                                        <span
                                            class="font-semibold tabular-nums"
                                            >{{
                                                formatPerMillion(
                                                    m.pricing.completion,
                                                    m.pricing?.currency
                                                )
                                            }}</span
                                        >
                                    </div>
                                </div>
                                <div
                                    class="mt-auto pt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400"
                                >
                                    <span>{{
                                        m.architecture?.modality || 'text'
                                    }}</span>
                                    <span class="opacity-60">/1M tokens</span>
                                </div>
                                <div
                                    class="absolute inset-0 pointer-events-none border border-black/5 dark:border-white/5 rounded-xl"
                                />
                            </div>
                        </div>
                    </VList>
                    <div
                        v-if="!chunkedModels.length && searchQuery"
                        class="px-6 pb-6 text-xs text-neutral-500"
                    >
                        No models match "{{ searchQuery }}".
                    </div>
                </div>
            </div>
        </template>
        <template #footer> </template>
    </UModal>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { VList } from 'virtua/vue';
import { useModelSearch } from '~/composables/useModelSearch';
import type { OpenRouterModel } from '~/utils/models-service';
import { useModelStore } from '~/composables/useModelStore';

const props = defineProps<{
    showModal: boolean;
}>();
const emit = defineEmits<{ (e: 'update:showModal', value: boolean): void }>();

// Bridge prop showModal to UModal's v-model:open (which emits update:open) by mapping update to parent event
const open = computed({
    get: () => props.showModal,
    set: (value: boolean) => emit('update:showModal', value),
});

const modelCatalog = ref<OpenRouterModel[]>([]);
// Search state (Orama index built client-side)
const {
    query: searchQuery,
    results: searchResults,
    ready: searchReady,
} = useModelSearch(modelCatalog);

// Fixed 3-column layout for consistent rows
const COLS = 2;
const gridColsClass = computed(() => ''); // class already on container; keep placeholder if future tweaks

const chunkedModels = computed(() => {
    const source = searchQuery.value.trim()
        ? searchResults.value
        : modelCatalog.value;
    const cols = COLS;
    const rows: OpenRouterModel[][] = [];
    for (let i = 0; i < source.length; i += cols) {
        rows.push(source.slice(i, i + cols));
    }
    return rows;
});

const {
    favoriteModels,
    getFavoriteModels,
    catalog,
    fetchModels,
    addFavoriteModel,
    removeFavoriteModel,
} = useModelStore();

onMounted(() => {
    fetchModels().then(() => {
        modelCatalog.value = catalog.value;
    });

    getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    });
});

function isFavorite(m: OpenRouterModel) {
    return favoriteModels.value.some((f) => f.id === m.id);
}

function toggleFavorite(m: OpenRouterModel) {
    if (isFavorite(m)) {
        removeFavoriteModel(m);
    } else {
        addFavoriteModel(m);
    }
}

/**
 * Format a per-token price into a "per 1,000,000 tokens" currency string.
 * Accepts numbers or numeric strings. Defaults to USD when no currency provided.
 */
function formatPerMillion(raw: unknown, currency = 'USD') {
    const perToken = Number(raw ?? 0);
    const perMillion = perToken * 1_000_000;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(perMillion);
    } catch (e) {
        // Fallback: simple fixed formatting
        return `$${perMillion.toFixed(2)}`;
    }
}
</script>
````

## File: app/db/kv.ts
````typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { parseOrThrow } from './util';
import { KvCreateSchema, KvSchema, type Kv, type KvCreate } from './schema';

export async function createKv(input: KvCreate): Promise<Kv> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.create:filter:input',
        input
    );
    await hooks.doAction('db.kv.create:action:before', filtered);
    const value = parseOrThrow(KvCreateSchema, filtered);
    await db.kv.put(value);
    await hooks.doAction('db.kv.create:action:after', value);
    return value;
}

export async function upsertKv(value: Kv): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.kv.upsert:filter:input',
        value
    );
    await hooks.doAction('db.kv.upsert:action:before', filtered);
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsert:action:after', filtered);
}

export async function hardDeleteKv(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.get(id);
    await hooks.doAction('db.kv.delete:action:hard:before', existing ?? id);
    await db.kv.delete(id);
    await hooks.doAction('db.kv.delete:action:hard:after', id);
}

export async function getKv(id: string) {
    const hooks = useHooks();
    const res = await db.kv.get(id);
    return hooks.applyFilters('db.kv.get:filter:output', res);
}

export async function getKvByName(name: string) {
    const hooks = useHooks();
    const res = await db.kv.where('name').equals(name).first();
    return hooks.applyFilters('db.kv.getByName:filter:output', res);
}

// Convenience helpers for auth/session flows
export async function setKvByName(
    name: string,
    value: string | null
): Promise<Kv> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    const now = Math.floor(Date.now() / 1000);
    const record: Kv = {
        id: existing?.id ?? `kv:${name}`,
        name,
        value,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        clock: (existing?.clock ?? 0) + 1,
    };
    const filtered = await hooks.applyFilters(
        'db.kv.upsertByName:filter:input',
        record
    );
    parseOrThrow(KvSchema, filtered);
    await db.kv.put(filtered);
    await hooks.doAction('db.kv.upsertByName:action:after', filtered);
    return filtered;
}

export async function hardDeleteKvByName(name: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.kv.where('name').equals(name).first();
    if (!existing) return; // nothing to do
    await hooks.doAction('db.kv.deleteByName:action:hard:before', existing);
    await db.kv.delete(existing.id);
    await hooks.doAction('db.kv.deleteByName:action:hard:after', existing.id);
}
````

## File: app/db/threads.ts
````typescript
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    ThreadCreateSchema,
    ThreadSchema,
    type Thread,
    type ThreadCreate,
} from './schema';

export async function createThread(input: ThreadCreate): Promise<Thread> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.create:filter:input',
        input
    );
    // Apply create-time defaults (id/clock/timestamps, etc.)
    const prepared = parseOrThrow(ThreadCreateSchema, filtered);
    // Validate against full schema so required defaults (status/pinned/etc.) are present
    const value = parseOrThrow(ThreadSchema, prepared);
    await hooks.doAction('db.threads.create:action:before', value);
    await db.threads.put(value);
    await hooks.doAction('db.threads.create:action:after', value);
    return value;
}

export async function upsertThread(value: Thread): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.threads.upsert:filter:input',
        value
    );
    await hooks.doAction('db.threads.upsert:action:before', filtered);
    parseOrThrow(ThreadSchema, filtered);
    await db.threads.put(filtered);
    await hooks.doAction('db.threads.upsert:action:after', filtered);
}

export function threadsByProject(projectId: string) {
    const hooks = useHooks();
    const promise = db.threads.where('project_id').equals(projectId).toArray();
    return promise.then((res) =>
        hooks.applyFilters('db.threads.byProject:filter:output', res)
    );
}

export function searchThreadsByTitle(term: string) {
    const q = term.toLowerCase();
    const hooks = useHooks();
    return db.threads
        .filter((t) => (t.title ?? '').toLowerCase().includes(q))
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.searchByTitle:filter:output', res)
        );
}

export function getThread(id: string) {
    const hooks = useHooks();
    return db.threads
        .get(id)
        .then((res) => hooks.applyFilters('db.threads.get:filter:output', res));
}

export function childThreads(parentThreadId: string) {
    const hooks = useHooks();
    return db.threads
        .where('parent_thread_id')
        .equals(parentThreadId)
        .toArray()
        .then((res) =>
            hooks.applyFilters('db.threads.children:filter:output', res)
        );
}

export async function softDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.threads, async () => {
        const t = await db.threads.get(id);
        if (!t) return;
        await hooks.doAction('db.threads.delete:action:soft:before', t);
        await db.threads.put({
            ...t,
            deleted: true,
            updated_at: Math.floor(Date.now() / 1000),
        });
        await hooks.doAction('db.threads.delete:action:soft:after', t);
    });
}

export async function hardDeleteThread(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.threads.get(id);
    await db.transaction('rw', db.threads, db.messages, async () => {
        await hooks.doAction(
            'db.threads.delete:action:hard:before',
            existing ?? id
        );
        await db.messages.where('thread_id').equals(id).delete();
        await db.threads.delete(id);
        await hooks.doAction('db.threads.delete:action:hard:after', id);
    });
}

// Fork a thread: clone thread metadata and optionally copy messages
export async function forkThread(
    sourceThreadId: string,
    overrides: Partial<ThreadCreate> = {},
    options: { copyMessages?: boolean } = {}
): Promise<Thread> {
    const hooks = useHooks();
    return db.transaction('rw', db.threads, db.messages, async () => {
        const src = await db.threads.get(sourceThreadId);
        if (!src) throw new Error('Source thread not found');
        const now = nowSec();
        const forkId = newId();
        const fork = parseOrThrow(ThreadSchema, {
            ...src,
            id: forkId,
            forked: true,
            parent_thread_id: src.id,
            created_at: now,
            updated_at: now,
            last_message_at: null,
            ...overrides,
        });
        await hooks.doAction('db.threads.fork:action:before', {
            source: src,
            fork,
        });
        await db.threads.put(fork);

        if (options.copyMessages) {
            const msgs = await db.messages
                .where('thread_id')
                .equals(src.id)
                .sortBy('index');
            for (const m of msgs) {
                await db.messages.put({ ...m, id: newId(), thread_id: forkId });
            }
            if (msgs.length > 0) {
                await db.threads.put({
                    ...fork,
                    last_message_at: now,
                    updated_at: now,
                });
            }
        }
        await hooks.doAction('db.threads.fork:action:after', fork);
        return fork;
    });
}
````

## File: app/components/chat/ChatInputDropper.vue
````vue
<template>
    <div
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="handleDrop"
        :class="[
            'flex flex-col bg-white dark:bg-gray-900 border-2 border-[var(--md-inverse-surface)] mx-2 md:mx-0 items-stretch transition-all duration-300 relative retro-shadow hover:shadow-xl focus-within:shadow-xl cursor-text z-10 rounded-[3px]',
            isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'hover:border-[var(--md-primary)] focus-within:border-[var(--md-primary)] dark:focus-within:border-gray-600',
            loading ? 'opacity-90 pointer-events-auto' : '',
        ]"
    >
        <div class="flex flex-col gap-3.5 m-3.5">
            <!-- Main Input Area -->
            <div class="relative">
                <div
                    class="max-h-96 w-full overflow-y-auto break-words min-h-[3rem]"
                >
                    <textarea
                        v-model="promptText"
                        placeholder="How can I help you today?"
                        class="w-full h-12 break-words max-w-full resize-none bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 text-sm leading-relaxed"
                        rows="1"
                        @input="handlePromptInput"
                        @paste="handlePaste"
                        ref="textareaRef"
                        :disabled="loading"
                    ></textarea>
                    <div
                        v-if="loading"
                        class="absolute top-1 right-1 flex items-center gap-2"
                    >
                        <UIcon
                            name="i-lucide:loader-2"
                            class="w-4 h-4 animate-spin opacity-70"
                        />
                    </div>
                </div>
            </div>

            <!-- Bottom Controls -->
            <div class="flex gap-2.5 w-full items-center">
                <div
                    class="relative flex-1 flex items-center gap-2 shrink min-w-0"
                >
                    <!-- Attachment Button -->
                    <div class="relative shrink-0">
                        <UButton
                            @click="triggerFileInput"
                            :square="true"
                            size="sm"
                            color="info"
                            class="retro-btn text-black dark:text-white flex items-center justify-center"
                            type="button"
                            aria-label="Add attachments"
                            :disabled="loading"
                        >
                            <UIcon name="i-lucide:plus" class="w-4 h-4" />
                        </UButton>
                    </div>

                    <!-- Settings Button (stub) -->
                    <div class="relative shrink-0">
                        <UButton
                            @click="
                                showSettingsDropdown = !showSettingsDropdown
                            "
                            :square="true"
                            size="sm"
                            color="info"
                            class="retro-btn text-black dark:text-white flex items-center justify-center"
                            type="button"
                            aria-label="Settings"
                            :disabled="loading"
                        >
                            <UIcon
                                name="i-lucide:sliders-horizontal"
                                class="w-4 h-4"
                            />
                        </UButton>
                    </div>
                </div>

                <!-- Model Selector (simple) -->
                <div class="shrink-0">
                    <USelectMenu
                        :ui="{
                            content: 'border-[2px] border-black rounded-[3px]',
                            input: 'border-0 rounded-none!',
                            arrow: 'h-[18px] w-[18px]',
                            itemTrailingIcon:
                                'shrink-0 w-[18px] h-[18px] text-dimmed',
                        }"
                        :search-input="{
                            icon: 'i-lucide-search',
                            ui: {
                                base: 'border-0 border-b-1 rounded-none!',
                                leadingIcon:
                                    'shrink-0 w-[18px] h-[18px] pr-2 text-dimmed',
                            },
                        }"
                        v-if="
                            selectedModel &&
                            favoriteModels &&
                            favoriteModels.length > 0
                        "
                        v-model="selectedModel as string"
                        :value-key="'value'"
                        class="retro-btn h-[32px] min-w-[100px] text-sm rounded-md border px-2 bg-white dark:bg-gray-800 w-48"
                        :disabled="loading"
                        :items="
                            favoriteModels.map((m) => ({
                                label: m.canonical_slug,
                                value: m.canonical_slug,
                            }))
                        "
                    >
                    </USelectMenu>
                </div>

                <!-- Send Button -->
                <div>
                    <UButton
                        @click="handleSend"
                        :disabled="
                            loading ||
                            (!promptText.trim() && uploadedImages.length === 0)
                        "
                        :square="true"
                        size="sm"
                        color="primary"
                        class="retro-btn disabled:opacity-40 text-white dark:text-black flex items-center justify-center"
                        type="button"
                        aria-label="Send message"
                    >
                        <UIcon name="i-lucide:arrow-up" class="w-4 h-4" />
                    </UButton>
                </div>
            </div>
        </div>

        <!-- Image Thumbnails -->
        <div
            v-if="uploadedImages.length > 0"
            class="mx-3.5 mb-3.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3"
        >
            <div
                v-for="(image, index) in uploadedImages"
                :key="index"
                class="relative group aspect-square"
            >
                <img
                    :src="image.url"
                    :alt="'Uploaded Image ' + (index + 1)"
                    class="w-full h-full object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
                />
                <button
                    @click="removeImage(index)"
                    class="absolute top-1 right-1 bg-black bg-opacity-50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-opacity-75"
                    aria-label="Remove image"
                    :disabled="loading"
                >
                    <UIcon name="i-lucide:x" class="w-3 h-3" />
                </button>
                <div
                    class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate group-hover:opacity-100 opacity-0 transition-opacity duration-200 rounded-b-lg"
                >
                    {{ image.name }}
                </div>
            </div>
        </div>

        <!-- Drag and Drop Overlay -->
        <div
            v-if="isDragging"
            class="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-500 rounded-2xl flex items-center justify-center z-50"
        >
            <div class="text-center">
                <UIcon
                    name="i-lucide:upload-cloud"
                    class="w-12 h-12 mx-auto mb-3 text-blue-500"
                />
                <p class="text-blue-600 dark:text-blue-400 text-sm font-medium">
                    Drop images here to upload
                </p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick, defineEmits } from 'vue';

const props = defineProps<{ loading?: boolean }>();

const { favoriteModels, getFavoriteModels } = useModelStore();

onMounted(async () => {
    const fave = await getFavoriteModels();
    console.log('Favorite models:', fave);
});

interface UploadedImage {
    file: File;
    url: string;
    name: string;
}

interface ImageSettings {
    quality: 'low' | 'medium' | 'high';
    numResults: number;
    size: '1024x1024' | '1024x1536' | '1536x1024';
}

const emit = defineEmits<{
    (
        e: 'send',
        payload: {
            text: string;
            images: UploadedImage[];
            model: string;
            settings: ImageSettings;
        }
    ): void;
    (e: 'prompt-change', value: string): void;
    (e: 'image-add', image: UploadedImage): void;
    (e: 'image-remove', index: number): void;
    (e: 'model-change', model: string): void;
    (e: 'settings-change', settings: ImageSettings): void;
    (e: 'trigger-file-input'): void;
}>();

const promptText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const uploadedImages = ref<UploadedImage[]>([]);
const isDragging = ref(false);
const selectedModel = ref<string>('openai/gpt-oss-120b');
const hiddenFileInput = ref<HTMLInputElement | null>(null);
const imageSettings = ref<ImageSettings>({
    quality: 'medium',
    numResults: 2,
    size: '1024x1024',
});
const showSettingsDropdown = ref(false);

watch(selectedModel, (newModel) => {
    emit('model-change', newModel);
});

const autoResize = async () => {
    await nextTick();
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
        textareaRef.value.style.height =
            Math.min(textareaRef.value.scrollHeight, 384) + 'px';
    }
};

const handlePromptInput = () => {
    emit('prompt-change', promptText.value);
    autoResize();
};

const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                const url = typeof result === 'string' ? result : '';
                const image: UploadedImage = {
                    file: file,
                    url,
                    name: file.name || `pasted-image-${Date.now()}.png`,
                };
                uploadedImages.value.push(image);
                emit('image-add', image);
            };
            reader.readAsDataURL(file);
        }
    }
};

const triggerFileInput = () => {
    emit('trigger-file-input');
    if (!hiddenFileInput.value) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', (e) => {
            handleFileChange(e);
        });
        document.body.appendChild(input);
        hiddenFileInput.value = input;
    }
    hiddenFileInput.value?.click();
};

const processFiles = (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        const mime = file.type || '';
        if (!mime.startsWith('image/')) continue;
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result;
            const url = typeof result === 'string' ? result : '';
            const image: UploadedImage = {
                file: file,
                url,
                name: file.name,
            };
            uploadedImages.value.push(image);
            emit('image-add', image);
        };
        reader.readAsDataURL(file);
    }
};

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || !target.files) return;
    processFiles(target.files);
};

const handleDrop = (event: DragEvent) => {
    isDragging.value = false;
    processFiles(event.dataTransfer?.files || null);
};

const onDragOver = (event: DragEvent) => {
    const items = event.dataTransfer?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const mime = item.type || '';
        if (mime.startsWith('image/')) {
            isDragging.value = true;
            return;
        }
    }
};

const onDragLeave = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        isDragging.value = false;
    }
};

const removeImage = (index: number) => {
    uploadedImages.value.splice(index, 1);
    emit('image-remove', index);
};

const handleSend = () => {
    if (props.loading) return;
    if (promptText.value.trim() || uploadedImages.value.length > 0) {
        emit('send', {
            text: promptText.value,
            images: uploadedImages.value,
            model: selectedModel.value,
            settings: imageSettings.value,
        });
        promptText.value = '';
        uploadedImages.value = [];
        autoResize();
    }
};
</script>

<style scoped>
/* Custom scrollbar for textarea */
/* Firefox */
textarea {
    scrollbar-width: thin;
    scrollbar-color: var(--md-primary) transparent;
}

/* WebKit */
textarea::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

textarea::-webkit-scrollbar-track {
    background: transparent;
}

textarea::-webkit-scrollbar-thumb {
    background: var(--md-primary);
    border-radius: 9999px;
}

textarea::-webkit-scrollbar-thumb:hover {
    background: color-mix(in oklab, var(--md-primary) 85%, black);
}

/* Focus states */
.group:hover .opacity-0 {
    opacity: 1;
}

/* Smooth transitions */
* {
    transition-property: color, background-color, border-color, opacity,
        transform;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
}
</style>
````

## File: app/components/sidebar/SideBottomNav.vue
````vue
<template>
    <div
        class="hud absolute bottom-0 w-full border-t-2 border-[var(--md-inverse-surface)]"
    >
        <!-- Removed previously added extra div; using pseudo-element for top pattern -->
        <div
            class="w-full relative max-w-[1200px] mx-auto bg-[var(--md-surface-variant)] border-2 border-[var(--md-outline-variant)]"
        >
            <div class="h-[10px] top-10 header-pattern-flipped"></div>
            <div
                class="retro-bar flex items-center justify-between gap-2 p-2 rounded-md bg-[var(--md-surface)] border-2 border-[var(--md-outline)] shadow-[inset_0_-2px_0_0_var(--md-surface-bright),inset_0_2px_0_0_var(--md-surface-container-high)] overflow-x-auto"
            >
                <!-- MY INFO -->
                <button
                    type="button"
                    aria-label="My Info"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-5 h-5 fill-current pointer-events-none"
                            viewBox="0 0 64 64"
                            aria-hidden="true"
                        >
                            <path d="M12 52c4-8 12-12 20-12s16 4 20 12v4H12z" />
                            <circle cx="32" cy="26" r="12" />
                        </svg>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            INFO
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div class="h-[2px] bg-current"></div>
                            <div class="h-[2px] bg-current"></div>
                        </div>
                    </div>
                </button>

                <!-- Connect -->
                <button
                    @click="onConnectButtonClick"
                    type="button"
                    aria-label="Connect"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-4 h-4"
                            viewBox="0 0 512 512"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="currentColor"
                            stroke="currentColor"
                        >
                            <g clip-path="url(#clip0_205_3)">
                                <path
                                    d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
                                    stroke-width="90"
                                />
                                <path
                                    d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
                                />
                                <path
                                    d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
                                    stroke-width="90"
                                />
                                <path
                                    d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
                                />
                            </g>
                        </svg>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            {{ orIsConnected ? 'Disconnect' : 'Connect' }}
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div
                                :class="{
                                    'bg-green-600': orIsConnected,
                                    'bg-error': !orIsConnected,
                                }"
                                class="h-[2px]"
                            ></div>
                            <div
                                :class="{
                                    'bg-success': orIsConnected,
                                    'bg-error': !orIsConnected,
                                }"
                                class="h-[2px]"
                            ></div>
                        </div>
                    </div>
                </button>

                <!-- HELP -->
                <button
                    @click="showSettingsModal = true"
                    type="button"
                    aria-label="Help"
                    class="relative flex w-full h-[56px] rounded-sm border-2 border-[var(--md-outline)] outline-2 outline-[var(--md-outline-variant)] outline-offset-[-2px] shadow-[inset_0_4px_0_0_rgba(0,0,0,0.08)] text-[var(--md-on-primary-fixed)] dark:text-[var(--md-on-surface)] uppercase cursor-pointer px-4 bg-[linear-gradient(var(--md-primary-fixed),var(--md-primary-fixed))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-fixed-dim),var(--md-primary-fixed-dim))_0_100%/100%_50%_no-repeat] after:content-[''] after:absolute after:left-[2px] after:right-[2px] after:top-[calc(50%-1px)] after:h-0.5 after:bg-[var(--md-outline)] active:bg-[linear-gradient(var(--md-primary),var(--md-primary))_0_0/100%_50%_no-repeat,linear-gradient(var(--md-primary-container),var(--md-primary-container))_0_100%/100%_50%_no-repeat] active:text-[var(--md-on-primary-fixed)] dark:active:text-[var(--md-on-surface)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--md-surface)] group"
                >
                    <div
                        class="absolute left-0 right-0 top-1 bottom-[calc(50%+4px)] flex items-center justify-center"
                    >
                        <svg
                            class="w-5 h-5 fill-current pointer-events-none"
                            viewBox="0 0 64 64"
                            aria-hidden="true"
                        >
                            <path d="M32 46a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
                            <path
                                d="M32 10c-7 0-12 4.7-12 10h8c0-2.1 1.9-4 4-4 2.2 0 4 1.6 4 3.6 0 1.6-.6 2.6-2.7 4.1-3.8 2.8-5.3 5.2-5.3 10.3v2h8v-1c0-3.1.8-4.3 3.4-6.1C42.2 26.7 44 24 44 20.6 44 14.5 38.5 10 32 10z"
                            />
                        </svg>
                    </div>
                    <div
                        class="absolute left-0 right-0 top-[calc(50%+2px)] bottom-1 flex flex-col items-center gap-1"
                    >
                        <div
                            class="text-sm font-extrabold tracking-[0.06em] leading-none m-0 group-active:text-[var(--md-on-primary-fixed)] dark:group-active:text-[var(--md-on-surface)]"
                        >
                            HELP
                        </div>
                        <div
                            class="w-2/3 h-3 flex flex-col justify-between opacity-[0.85]"
                        >
                            <div class="h-[2px] bg-current"></div>
                            <div class="h-[2px] bg-current"></div>
                        </div>
                    </div>
                </button>
            </div>
            <div class="h-[10px] top-10"></div>
        </div>
    </div>
    <modal-settings-modal v-model:showModal="showSettingsModal" />
</template>

<script lang="ts" setup>
import { state } from '~/state/global';

const openrouter = useOpenRouterAuth();
const orIsConnected = computed(() => state.value.openrouterKey);
const showSettingsModal = ref(false);

function onConnectButtonClick() {
    if (orIsConnected.value) {
        console.log(orIsConnected);
        // Logic to disconnect
        state.value.openrouterKey = null;
        openrouter.logoutOpenRouter();
    } else {
        // Logic to connect
        openrouter.startLogin();
    }
}
</script>

<style scoped>
/* Retro bar overlay: scanlines + soft gloss + subtle noise (doesn't touch the top gradient) */
.retro-bar {
    position: relative;
    isolation: isolate; /* contain blend */
}
.retro-bar::before {
    /* Chrome gloss + bevel hint */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background: linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.18),
        rgba(255, 255, 255, 0.06) 28%,
        rgba(0, 0, 0, 0) 40%,
        rgba(0, 0, 0, 0.1) 100%
    );
    pointer-events: none;
    mix-blend-mode: soft-light;
}
.retro-bar::after {
    /* Scanlines + speckle noise, extremely subtle */
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1; /* render under content */
    background-image: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.045) 0px,
            rgba(255, 255, 255, 0.045) 1px,
            rgba(0, 0, 0, 0) 1px,
            rgba(0, 0, 0, 0) 3px
        ),
        radial-gradient(
            1px 1px at 12% 18%,
            rgba(255, 255, 255, 0.04),
            transparent 100%
        ),
        radial-gradient(
            1px 1px at 64% 62%,
            rgba(0, 0, 0, 0.04),
            transparent 100%
        );
    opacity: 0.25;
    pointer-events: none;
    mix-blend-mode: soft-light;
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern-flipped {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x-sm.webp');
    rotate: 180deg;
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x-sm.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}
</style>
````

## File: app/components/ResizableSidebarLayout.vue
````vue
<template>
    <div
        class="relative w-full h-screen border border-[var(--md-outline-variant)] overflow-hidden bg-[var(--md-surface)] text-[var(--md-on-surface)] flex overflow-x-hidden"
    >
        <!-- Backdrop on mobile when open -->
        <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                v-if="!isDesktop && open"
                class="absolute inset-0 bg-black/40 z-30 md:hidden"
                @click="close()"
            />
        </Transition>

        <!-- Sidebar -->
        <aside
            :class="[
                'z-40 bg-[var(--md-surface)] text-[var(--md-on-surface)] border-black',
                // width transition on desktop
                'md:transition-[width] md:duration-200 md:ease-out',
                'md:relative md:h-full md:flex-shrink-0 md:border-r-2',
                side === 'right' ? 'md:border-l md:border-r-0' : '',
                // mobile overlay behavior
                !isDesktop
                    ? [
                          'absolute top-0 bottom-0 w-[80vw] max-w-[90vw] shadow-xl',
                          // animated slide
                          'transition-transform duration-200 ease-out',
                          side === 'right'
                              ? 'right-0 translate-x-full'
                              : 'left-0 -translate-x-full',
                          open ? 'translate-x-0' : '',
                      ]
                    : '',
            ]"
            :style="
                Object.assign(
                    isDesktop ? { width: computedWidth + 'px' } : {},
                    {
                        '--sidebar-rep-size': props.sidebarPatternSize + 'px',
                        '--sidebar-rep-opacity': String(
                            props.sidebarPatternOpacity
                        ),
                    }
                )
            "
            @keydown.esc.stop.prevent="close()"
        >
            <div class="h-full flex flex-col">
                <!-- Sidebar header -->
                <SidebarHeader
                    :collapsed="collapsed"
                    :toggle-icon="toggleIcon"
                    :toggle-aria="toggleAria"
                    @toggle="toggleCollapse"
                >
                    <template #sidebar-header>
                        <slot name="sidebar-header" />
                    </template>
                    <template #sidebar-toggle="slotProps">
                        <slot name="sidebar-toggle" v-bind="slotProps" />
                    </template>
                </SidebarHeader>

                <!-- Sidebar content -->
                <div v-show="!collapsed" class="flex-1 overflow-auto">
                    <slot name="sidebar">
                        <div class="p-3 space-y-2 text-sm opacity-80">
                            <p>Add your nav here…</p>
                            <ul class="space-y-1">
                                <li
                                    v-for="i in 10"
                                    :key="i"
                                    class="px-2 py-1 rounded hover:bg-[var(--md-secondary-container)] hover:text-[var(--md-on-secondary-container)] cursor-pointer"
                                >
                                    Item {{ i }}
                                </li>
                            </ul>
                        </div>
                    </slot>
                </div>
            </div>

            <!-- Resize handle (desktop only) -->
            <ResizeHandle
                :is-desktop="isDesktop"
                :collapsed="collapsed"
                :side="side"
                :min-width="props.minWidth"
                :max-width="props.maxWidth"
                :computed-width="computedWidth"
                @resize-start="onPointerDown"
                @resize-keydown="onHandleKeydown"
            />
        </aside>

        <!-- Main content -->
        <div class="relative z-10 flex-1 h-full flex flex-col">
            <div
                class="flex-1 overflow-hidden content-bg"
                :style="{
                    '--content-bg-size': props.patternSize + 'px',
                    '--content-bg-opacity': String(props.patternOpacity),
                    '--content-overlay-size': props.overlaySize + 'px',
                    '--content-overlay-opacity': String(props.overlayOpacity),
                }"
            >
                <slot>
                    <div class="p-4 space-y-2 text-sm opacity-80">
                        <p>Put your main content here…</p>
                        <p>
                            Resize the sidebar on desktop by dragging the
                            handle. On mobile, use the Menu button to open/close
                            the overlay.
                        </p>
                    </div>
                </slot>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import SidebarHeader from './sidebar/SidebarHeader.vue';
import ResizeHandle from './sidebar/ResizeHandle.vue';

type Side = 'left' | 'right';

const props = defineProps({
    modelValue: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: true },
    side: { type: String as () => Side, default: 'left' },
    minWidth: { type: Number, default: 200 },
    maxWidth: { type: Number, default: 480 },
    defaultWidth: { type: Number, default: 280 },
    collapsedWidth: { type: Number, default: 56 },
    storageKey: { type: String, default: 'sidebar:width' },
    // Visual tuning for content pattern
    patternOpacity: { type: Number, default: 0.05 }, // 0..1
    patternSize: { type: Number, default: 150 }, // px
    // Overlay pattern (renders above the base pattern)
    overlayOpacity: { type: Number, default: 0.05 },
    overlaySize: { type: Number, default: 120 },
    // Sidebar repeating background
    sidebarPatternOpacity: { type: Number, default: 0.09 },
    sidebarPatternSize: { type: Number, default: 240 },
});
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'resize', width: number): void;
}>();

// open state (controlled or uncontrolled)
const openState = ref<boolean>(props.modelValue ?? props.defaultOpen);
const open = computed({
    get: () =>
        props.modelValue === undefined ? openState.value : props.modelValue,
    set: (v) => {
        if (props.modelValue === undefined) openState.value = v;
        emit('update:modelValue', v);
    },
});

// collapsed toggle remembers last expanded width
const collapsed = ref(false);
const lastExpandedWidth = ref(props.defaultWidth);

// width state with persistence
const width = ref<number>(props.defaultWidth);
const computedWidth = computed(() =>
    collapsed.value ? props.collapsedWidth : width.value
);

// responsive
const isDesktop = ref(false);
let mq: MediaQueryList | undefined;
const updateMq = () => {
    if (typeof window === 'undefined') return;
    mq = window.matchMedia('(min-width: 768px)');
    isDesktop.value = mq.matches;
};

onMounted(() => {
    updateMq();
    mq?.addEventListener('change', () => (isDesktop.value = !!mq?.matches));

    // restore width
    try {
        const saved = localStorage.getItem(props.storageKey);
        if (saved) width.value = clamp(parseInt(saved, 10));
    } catch {}
});

onBeforeUnmount(() => {
    mq?.removeEventListener('change', () => {});
});

watch(width, (w) => {
    try {
        localStorage.setItem(props.storageKey, String(w));
    } catch {}
    emit('resize', w);
});

const clamp = (w: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, w));

function toggle() {
    open.value = !open.value;
}
function close() {
    open.value = false;
}
function toggleCollapse() {
    if (!collapsed.value) {
        lastExpandedWidth.value = width.value;
        collapsed.value = true;
    } else {
        collapsed.value = false;
        width.value = clamp(lastExpandedWidth.value || props.defaultWidth);
    }
}

// Resize logic (desktop only)
let startX = 0;
let startWidth = 0;
function onPointerDown(e: PointerEvent) {
    if (!isDesktop.value || collapsed.value) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startX = e.clientX;
    startWidth = width.value;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
}
function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const delta = props.side === 'right' ? -dx : dx;
    width.value = clamp(startWidth + delta);
}
function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
}

// Keyboard a11y for the resize handle
function onHandleKeydown(e: KeyboardEvent) {
    if (!isDesktop.value || collapsed.value) return;
    const step = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        // reverse on right side
        const signed = props.side === 'right' ? -dir : dir;
        width.value = clamp(width.value + signed * step);
    } else if (e.key === 'Home') {
        e.preventDefault();
        width.value = props.minWidth;
    } else if (e.key === 'End') {
        e.preventDefault();
        width.value = props.maxWidth;
    } else if (e.key === 'PageUp') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? -1 : 1;
        width.value = clamp(width.value + signed * big);
    } else if (e.key === 'PageDown') {
        e.preventDefault();
        const big = step * 2;
        const signed = props.side === 'right' ? 1 : -1;
        width.value = clamp(width.value - signed * big);
    }
}

// expose minimal API if needed
defineExpose({ toggle, close });

const side = computed<Side>(() => (props.side === 'right' ? 'right' : 'left'));
// Icon and aria label for collapse/expand button
const toggleIcon = computed(() => {
    // When collapsed, show the icon that suggests expanding back toward content area
    if (collapsed.value) {
        return side.value === 'right'
            ? 'i-lucide:chevron-left'
            : 'i-lucide:chevron-right';
    }
    // When expanded, show icon pointing into the sidebar to collapse it
    return side.value === 'right'
        ? 'i-lucide:chevron-right'
        : 'i-lucide:chevron-left';
});
const toggleAria = computed(() =>
    collapsed.value ? 'Expand sidebar' : 'Collapse sidebar'
);
</script>

<style scoped>
/* Optional: could add extra visual flair for the resize handle here */
.content-bg {
    position: relative;
    /* Base matches sidebar/header */
    background-color: var(--md-surface);
}

.content-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/bg-repeat.webp');
    background-repeat: repeat;
    background-position: top left;
    /* Default variables; can be overridden via inline style */
    --content-bg-size: 150px;
    --content-bg-opacity: 0.08;
    background-size: var(--content-bg-size) var(--content-bg-size);
    opacity: var(--content-bg-opacity);
    z-index: 0;
}

/* Ensure the real content sits above the pattern */
.content-bg > * {
    position: relative;
    z-index: 1;
}

/* Overlay layer above base pattern but below content */
.content-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/bg-repeat-2.png');
    background-repeat: repeat;
    background-position: top left;
    --content-overlay-size: 380px;
    --content-overlay-opacity: 0.125;
    background-size: var(--content-overlay-size) var(--content-overlay-size);
    opacity: var(--content-overlay-opacity);
    z-index: 0.5;
}

/* Hardcoded header pattern repeating horizontally */
.header-pattern {
    background-color: var(--md-surface-variant);
    background-image: url('/gradient-x.webp');
    background-repeat: repeat-x;
    background-position: left center;
    background-size: auto 100%;
}

/* Sidebar repeating background layer */
aside::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('/sidebar-repeater.webp');
    background-repeat: repeat;
    background-position: top left;
    background-size: var(--sidebar-rep-size) var(--sidebar-rep-size);
    opacity: var(--sidebar-rep-opacity);
    z-index: 0;
}

/* Ensure sidebar children render above the pattern, but keep handle on top */
aside > *:not(.resize-handle-layer) {
    position: relative;
    z-index: 1;
}
</style>
````

## File: app/db/messages.ts
````typescript
import Dexie from 'dexie';
import { db } from './client';
import { useHooks } from '../composables/useHooks';
import { newId, nowSec, parseOrThrow } from './util';
import {
    MessageCreateSchema,
    MessageSchema,
    type Message,
    type MessageCreate,
} from './schema';

export async function createMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.create:filter:input',
        input
    );
    // Apply defaults (id/clock/timestamps) then validate fully
    const prepared = parseOrThrow(MessageCreateSchema, filtered);
    const value = parseOrThrow(MessageSchema, prepared);
    await hooks.doAction('db.messages.create:action:before', value);
    await db.messages.put(value);
    await hooks.doAction('db.messages.create:action:after', value);
    return value;
}

export async function upsertMessage(value: Message): Promise<void> {
    const hooks = useHooks();
    const filtered = await hooks.applyFilters(
        'db.messages.upsert:filter:input',
        value
    );
    await hooks.doAction('db.messages.upsert:action:before', filtered);
    parseOrThrow(MessageSchema, filtered);
    await db.messages.put(filtered);
    await hooks.doAction('db.messages.upsert:action:after', filtered);
}

export function messagesByThread(threadId: string) {
    const hooks = useHooks();
    return db.messages
        .where('thread_id')
        .equals(threadId)
        .sortBy('index')
        .then((res) =>
            hooks.applyFilters('db.messages.byThread:filter:output', res)
        );
}

export function getMessage(id: string) {
    const hooks = useHooks();
    return db.messages
        .get(id)
        .then((res) =>
            hooks.applyFilters('db.messages.get:filter:output', res)
        );
}

export function messageByStream(streamId: string) {
    const hooks = useHooks();
    return db.messages
        .where('stream_id')
        .equals(streamId)
        .first()
        .then((res) =>
            hooks.applyFilters('db.messages.byStream:filter:output', res)
        );
}

export async function softDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        const m = await db.messages.get(id);
        if (!m) return;
        await hooks.doAction('db.messages.delete:action:soft:before', m);
        await db.messages.put({ ...m, deleted: true, updated_at: nowSec() });
        await hooks.doAction('db.messages.delete:action:soft:after', m);
    });
}

export async function hardDeleteMessage(id: string): Promise<void> {
    const hooks = useHooks();
    const existing = await db.messages.get(id);
    await hooks.doAction(
        'db.messages.delete:action:hard:before',
        existing ?? id
    );
    await db.messages.delete(id);
    await hooks.doAction('db.messages.delete:action:hard:after', id);
}

// Append a message to a thread and update thread timestamps atomically
export async function appendMessage(input: MessageCreate): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        const value = parseOrThrow(MessageCreateSchema, input);
        await hooks.doAction('db.messages.append:action:before', value);
        // If index not set, compute next sparse index in thread
        if (value.index === undefined || value.index === null) {
            const last = await db.messages
                .where('[thread_id+index]')
                .between(
                    [value.thread_id, Dexie.minKey],
                    [value.thread_id, Dexie.maxKey]
                )
                .last();
            const lastIdx = last?.index ?? 0;
            value.index = last ? lastIdx + 1000 : 1000;
        }
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(value.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.append:action:after', finalized);
        return finalized;
    });
}

// Move a message to another thread, computing next index in destination
export async function moveMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.move:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            thread_id: toThreadId,
            index: nextIdx,
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.move:action:after', {
            messageId,
            toThreadId,
        });
    });
}

// Copy a message into another thread (new id) and update dest thread timestamps
export async function copyMessage(
    messageId: string,
    toThreadId: string
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, db.threads, async () => {
        const m = await db.messages.get(messageId);
        if (!m) return;
        await hooks.doAction('db.messages.copy:action:before', {
            message: m,
            toThreadId,
        });
        const last = await db.messages
            .where('[thread_id+index]')
            .between([toThreadId, Dexie.minKey], [toThreadId, Dexie.maxKey])
            .last();
        const nextIdx = last ? last.index + 1000 : 1000;
        await db.messages.put({
            ...m,
            id: newId(),
            thread_id: toThreadId,
            index: nextIdx,
            created_at: nowSec(),
            updated_at: nowSec(),
        });

        const now = nowSec();
        const t = await db.threads.get(toThreadId);
        if (t)
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        await hooks.doAction('db.messages.copy:action:after', {
            from: messageId,
            toThreadId,
        });
    });
}

// Insert a message right after a given message id, adjusting index using sparse spacing
export async function insertMessageAfter(
    afterMessageId: string,
    input: Omit<MessageCreate, 'index'>
): Promise<Message> {
    const hooks = useHooks();
    return db.transaction('rw', db.messages, db.threads, async () => {
        const after = await db.messages.get(afterMessageId);
        if (!after) throw new Error('after message not found');
        const next = await db.messages
            .where('[thread_id+index]')
            .above([after.thread_id, after.index])
            .first();
        let newIndex: number;
        if (!next) {
            newIndex = after.index + 1000;
        } else if (next.index - after.index > 1) {
            newIndex = after.index + Math.floor((next.index - after.index) / 2);
        } else {
            // No gap, normalize thread then place after
            await normalizeThreadIndexes(after.thread_id);
            newIndex = after.index + 1000;
        }
        const value = parseOrThrow(MessageCreateSchema, {
            ...input,
            index: newIndex,
            thread_id: after.thread_id,
        });
        await hooks.doAction('db.messages.insertAfter:action:before', {
            after,
            value,
        });
        const finalized = parseOrThrow(MessageSchema, value);
        await db.messages.put(finalized);
        const t = await db.threads.get(after.thread_id);
        if (t) {
            const now = nowSec();
            await db.threads.put({
                ...t,
                last_message_at: now,
                updated_at: now,
            });
        }
        await hooks.doAction('db.messages.insertAfter:action:after', finalized);
        return finalized;
    });
}

// Compact / normalize indexes for a thread to 1000, 2000, 3000...
export async function normalizeThreadIndexes(
    threadId: string,
    start = 1000,
    step = 1000
): Promise<void> {
    const hooks = useHooks();
    await db.transaction('rw', db.messages, async () => {
        await hooks.doAction('db.messages.normalize:action:before', {
            threadId,
            start,
            step,
        });
        const msgs = await db.messages
            .where('[thread_id+index]')
            .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
            .toArray();
        msgs.sort((a, b) => a.index - b.index);
        let idx = start;
        for (const m of msgs) {
            if (m.index !== idx) {
                await db.messages.put({
                    ...m,
                    index: idx,
                    updated_at: nowSec(),
                });
            }
            idx += step;
        }
        await hooks.doAction('db.messages.normalize:action:after', {
            threadId,
        });
    });
}
````

## File: task.md
````markdown
# Chat stabilization tasks

A concise, checkable plan to make chat behavior correct, reactive, and performant. I’ll check items off as we complete them.

Legend: [ ] todo, [x] done, [~] optional

## 0) Current progress snapshot

-   [x] ChatContainer re-initializes useChat when threadId changes (watch + shallowRef)
    -   File: `app/components/chat/ChatContainer.vue`
    -   Status: Implemented
-   [ ] All other tasks pending

---

## 1) Fix thread selection event mismatch (critical)

Goal: Ensure clicking a thread in the sidebar updates the page `threadId`.

-   Files:
    -   `app/pages/chat.vue`
    -   `app/components/sidebar/SideNavContent.vue`

Tasks:

-   [ ] Standardize the event name between child and parent.
    -   Minimal fix: In `chat.vue`, listen to the existing camelCase event.
        -   Change: `<sidebar-side-nav-content @chatSelected="onChatSelected" />`
    -   [x] Minimal fix applied: `chat.vue` now listens for `@chatSelected`.
    -   [~] Alternative: Switch to kebab-case consistently (child emits `'chat-selected'`, parent listens `@chat-selected`). Choose one and apply to both files.

Acceptance:

-   [x] Clicking a sidebar item calls `onChatSelected` and sets `threadId`.

---

## 2) Keep ChatContainer messages in sync on thread and history changes

Goal: No stale/empty messages after switching threads or after async history load.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Also react to `props.messageHistory` changes (implemented):
    -   Used the direct-assignment approach in `ChatContainer.vue`:
        -   `chat.value.messages.value = [...(props.messageHistory || [])]`
    -   (Alternative re-init approach is still valid if you prefer.)
-   [ ] Remove reliance on parent `:key` remount (optional) once the above sync is in place.

Acceptance:

-   [x] Switching threads updates the list immediately.
-   [x] Messages do not flicker or show stale content.

---

## 3) Propagate new thread id created on first send

Goal: When sending a first message without a selected thread, a new thread is created and the page learns its id.

-   Files:
    -   `app/composables/useAi.ts`
    -   `app/components/chat/ChatContainer.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [x] In `useAi.ts`, make `threadId` reactive:
    -   Use `const threadIdRef = ref(threadId)`; update `threadIdRef.value` when creating a thread.
    -   Return `threadId: threadIdRef` from `useChat`.
-   [x] In `ChatContainer.vue`:
    -   Watch the returned `chat.value.threadId` and emit upward when it transitions from falsy to a real id, e.g., `emit('thread-selected', id)`.
-   [x] In `chat.vue`:
    -   Listen for `@thread-selected` from `ChatContainer` and set page-level `threadId`.

Acceptance:

-   [x] Sending the first message when no thread is selected creates a thread and binds the UI to it.

---

## 4) Use stable keys for message rendering

Goal: Avoid DOM reuse glitches and ensure predictable rendering.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [ ] Update `v-for` key to a stable identifier:
    -   Prefer DB `message.id`.
    -   Fallback: `message.stream_id` for streaming assistant placeholders.
    -   As a last resort: a composite key such as `${index}-${message.role}` only if no ids exist yet (not ideal for long-term).

Acceptance:

-   [ ] No warning about duplicate/unstable keys; UI remains stable during updates and streaming.

---

## 5) Improve Dexie query performance and ordering

Goal: Efficiently fetch ordered messages per thread without client-side resort.

-   Files:
    -   `app/db/client.ts` (Dexie schema; add an index)
    -   `app/pages/chat.vue`

Tasks:

-   [x] Add a compound index to messages: `[thread_id+index]`.
-   [x] Query ordered messages via the compound index:
    -   Replace `.where('thread_id').equals(id).sortBy('index')` with
        `.where('[thread_id+index]').between([id, Dexie.minKey], [id, Dexie.maxKey]).toArray()`.
-   [x] Remove extra JS sorting when possible.

Acceptance:

-   [x] Message fetch is ordered and fast on large datasets.

---

## 6) Wire up "New Chat" button

Goal: Create a new thread and select it immediately.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [ ] Implement click handler on New Chat:
    -   Create a thread via `create.thread({ title: 'New Thread', ... })`.
    -   Emit upward the new id (`emit('chatSelected', newId)` or kebab-case version).
-   [ ] Parent `chat.vue` sets `threadId` in `onChatSelected` and fetches messages.

Acceptance:

-   [ ] Clicking New Chat opens an empty conversation bound to the new thread id.

---

## 7) Streaming write optimization (optional but recommended)

Goal: Reduce write amplification during assistant streaming while remaining correct.

-   File: `app/composables/useAi.ts`

Tasks:

-   [x] Throttle `upsert.message` during streaming (e.g., 50–150ms) and ensure a final upsert at end.
-   [x] Keep hooks (`ai.chat.stream:action:delta`) intact.

Acceptance:

-   [x] Noticeably fewer writes during long responses without losing final content.

---

## 8) Loading UX and input state

Goal: Visual feedback and prevent duplicate sends while streaming.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Bind `loading` to disable send UI or show a subtle spinner/typing indicator.
-   [x] Guard `onSend` to no-op while `loading` is true.

Acceptance:

-   [x] Input disabled/indicates streaming; no duplicate sends mid-stream.

---

## 9) Delete semantics consistency (soft vs hard)

Goal: Predictable UX for delete vs trash.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/db/index.ts` (only if changing which API is used)

Tasks:

-   [ ] Choose a policy:
    -   Soft delete: Use `del.soft.thread(id)` and filter out `deleted` in lists (current UI already filters).
    -   Hard delete: Keep current hard delete but adjust copy to warn it’s permanent and ensure no other code expects soft-deleted items.
-   [ ] Apply consistently in menu actions and list queries.

Acceptance:

-   [ ] Delete behavior matches the chosen policy across UI and data layer.

---

## 10) Minor schema and docs polish (optional)

Goal: Align expectations and reduce surprises.

-   Files:
    -   `app/composables/useAi.ts` (model default consistency with docs)
    -   `app/db/schema.ts` (only if relaxing URL constraints for attachments)

Tasks:

-   [~] Align default model id with docs or update docs to reflect `'openai/gpt-oss-120b'`.
-   [~] If needed, relax `AttachmentSchema.url` to allow `blob:`/`data:`/relative URLs, or validate upstream.

Acceptance:

-   [ ] Docs and defaults align; attachment storage behavior is intentional.

---

## File-by-file quick reference

-   `app/pages/chat.vue`

    -   [ ] Fix event listener name (`@chatSelected` or kebab-case strategy)
    -   [ ] Optional: remove `:key` remount after child sync is robust
    -   [ ] Switch to compound-index query once available

-   `app/components/sidebar/SideNavContent.vue`

    -   [ ] Event name consistency with parent
    -   [ ] Implement New Chat creation and emit id
    -   [ ] Decide and apply delete policy (soft vs hard)

-   `app/components/chat/ChatContainer.vue`

    -   [x] Re-init `useChat` on `threadId` change (done)
    -   [ ] Sync messages on `messageHistory` change
    -   [ ] Stable `v-for` keys (prefer `message.id`)
    -   [ ] Use `loading` to disable input / show indicator
    -   [ ] Emit upward when thread id is created by `useChat`

-   `app/composables/useAi.ts`

    -   [ ] Return reactive `threadId` (ref)
    -   [ ] Throttle streaming upserts (optional)
    -   [~] Model default/docs alignment

-   `app/db/client.ts`

    -   [ ] Add `[thread_id+index]` index for messages

-   `app/db/index.ts`

    -   [ ] No code change required unless delete policy changes (then switch to soft/hard helpers accordingly)

-   `app/db/schema.ts`
    -   [~] Optional: relax `AttachmentSchema.url` if non-absolute URLs are used

---

## Acceptance checklist (end-to-end)

-   [ ] Clicking a thread selects it and loads messages quickly
-   [ ] New Chat creates and selects a new thread with empty history
-   [ ] Switching threads shows the correct messages without flicker
-   [ ] First send without a thread creates one and binds the UI to it
-   [ ] Streaming is smooth; input disabled; minimal DB writes
-   [ ] Delete behavior matches chosen policy consistently
-   [ ] No console errors; keys stable; queries efficient

---

Notes:

-   Prefer minimal-diff fixes first (event name, message sync) to restore core functionality, then ship performance and UX improvements.
-   If you want me to start executing, I’ll begin with Section 1 and 2 and validate the flow live.
````

## File: package.json
````json
{
  "name": "nuxt-app",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "@nuxt/ui": "^3.3.2",
    "@openrouter/ai-sdk-provider": "^1.1.2",
    "@orama/orama": "^3.1.11",
    "ai": "^5.0.17",
    "dexie": "^4.0.11",
    "gpt-tokenizer": "^3.0.1",
    "highlight.js": "^11.11.1",
    "marked-highlight": "^2.2.2",
    "nuxt": "^4.0.3",
    "orama": "^2.0.6",
    "turndown": "^7.2.1",
    "typescript": "^5.6.3",
    "virtua": "^0.41.5",
    "vue": "^3.5.18",
    "vue-router": "^4.5.1",
    "zod": "^4.0.17"
  },
  "devDependencies": {
    "@tailwindcss/typography": "^0.5.16"
  }
}
````

## File: app/components/sidebar/SideNavContent.vue
````vue
<template>
    <div class="flex flex-col h-full relative">
        <div class="p-2 flex flex-col space-y-2">
            <UButton
                @click="onNewChat"
                class="w-full flex items-center justify-center backdrop-blur-2xl"
                >New Chat</UButton
            >
            <div class="relative w-full ml-[1px]">
                <UInput
                    v-model="threadSearchQuery"
                    icon="i-lucide-search"
                    size="md"
                    variant="outline"
                    placeholder="Search threads..."
                    class="w-full"
                />
                <button
                    v-if="threadSearchQuery"
                    type="button"
                    aria-label="Clear thread search"
                    class="absolute inset-y-0 right-2 my-auto h-5 w-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white transition"
                    @click="threadSearchQuery = ''"
                >
                    <UIcon name="i-heroicons-x-mark" class="h-4 w-4" />
                </button>
            </div>
        </div>
        <div class="flex flex-col p-2 space-y-1.5">
            <div v-for="item in displayThreads" :key="item.id">
                <RetroGlassBtn
                    :class="{
                        'active-element bg-primary/25':
                            item.id === props.activeThread,
                    }"
                    class="w-full flex items-center justify-between text-left"
                    @click="() => emit('chatSelected', item.id)"
                >
                    <span class="truncate">{{
                        item.title || 'New Thread'
                    }}</span>

                    <!-- Three-dot popover INSIDE the retro button -->
                    <UPopover
                        :content="{
                            side: 'right',
                            align: 'start',
                            sideOffset: 6,
                        }"
                    >
                        <!-- Trigger -->
                        <span
                            class="inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-black/10 active:bg-black/20"
                            @click.stop
                        >
                            <UIcon
                                name="i-lucide-more-vertical"
                                class="w-4 h-4 opacity-70"
                            />
                        </span>

                        <!-- Content -->
                        <template #content>
                            <div class="p-1 w-44 space-y-1">
                                <UButton
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    icon="i-lucide-pencil"
                                    @click="openRename(item)"
                                    >Rename</UButton
                                >
                                <UButton
                                    color="error"
                                    variant="ghost"
                                    size="sm"
                                    class="w-full justify-start"
                                    icon="i-lucide-trash-2"
                                    @click="confirmDelete(item)"
                                    >Delete</UButton
                                >
                            </div>
                        </template>
                    </UPopover>
                </RetroGlassBtn>
            </div>
        </div>
        <sidebar-side-bottom-nav />

        <!-- Rename modal -->
        <UModal
            v-model:open="showRenameModal"
            title="Rename thread"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Rename thread?</h3> </template>
            <template #body>
                <div class="space-y-4">
                    <UInput
                        v-model="renameTitle"
                        placeholder="Thread title"
                        icon="i-lucide-pencil"
                        @keyup.enter="saveRename"
                    />
                </div>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showRenameModal = false"
                    >Cancel</UButton
                >
                <UButton color="primary" @click="saveRename">Save</UButton>
            </template>
        </UModal>

        <!-- Delete confirm modal -->
        <UModal
            v-model:open="showDeleteModal"
            title="Delete thread?"
            :ui="{ footer: 'justify-end' }"
            class="border-2"
        >
            <template #header> <h3>Delete thread?</h3> </template>
            <template #body>
                <p class="text-sm opacity-70">
                    This will permanently remove the thread and its messages.
                </p>
            </template>
            <template #footer>
                <UButton variant="ghost" @click="showDeleteModal = false"
                    >Cancel</UButton
                >
                <UButton color="error" @click="deleteThread">Delete</UButton>
            </template>
        </UModal>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { liveQuery } from 'dexie';
import { db, upsert, del as dbDel } from '~/db'; // Dexie + barrel helpers

const props = defineProps<{
    activeThread?: string;
}>();

const items = ref<any[]>([]);
import { useThreadSearch } from '~/composables/useThreadSearch';
const { query: threadSearchQuery, results: threadSearchResults } =
    useThreadSearch(items as any);
const displayThreads = computed(() =>
    threadSearchQuery.value.trim() ? threadSearchResults.value : items.value
);
let sub: { unsubscribe: () => void } | null = null;

onMounted(() => {
    // Sort by last opened using updated_at index; filter out deleted
    sub = liveQuery(() =>
        db.threads
            .orderBy('updated_at')
            .reverse()
            .filter((t) => !t.deleted)
            .toArray()
    ).subscribe({
        next: (results) => (items.value = results),
        error: (err) => console.error('liveQuery error', err),
    });
});

watch(
    () => items.value,
    (newItems) => {
        console.log('Items updated:', newItems);
    }
);

onUnmounted(() => {
    sub?.unsubscribe();
});

const emit = defineEmits(['chatSelected', 'newChat']);

// ----- Actions: menu, rename, delete -----
const showRenameModal = ref(false);
const renameId = ref<string | null>(null);
const renameTitle = ref('');

const showDeleteModal = ref(false);
const deleteId = ref<string | null>(null);

function openRename(thread: any) {
    renameId.value = thread.id;
    renameTitle.value = thread.title ?? '';
    showRenameModal.value = true;
}

async function saveRename() {
    if (!renameId.value) return;
    const t = await db.threads.get(renameId.value);
    if (!t) return;
    const now = Math.floor(Date.now() / 1000);
    await upsert.thread({ ...t, title: renameTitle.value, updated_at: now });
    showRenameModal.value = false;
    renameId.value = null;
    renameTitle.value = '';
}

function confirmDelete(thread: any) {
    deleteId.value = thread.id as string;
    showDeleteModal.value = true;
}

async function deleteThread() {
    if (!deleteId.value) return;
    await dbDel.hard.thread(deleteId.value);
    showDeleteModal.value = false;
    deleteId.value = null;
}

function onNewChat() {
    emit('newChat');
    console.log('New chat requested');
}
</script>
````

## File: app/pages/chat.vue
````vue
<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <sidebar-side-nav-content
                @new-chat="onNewChat"
                @chatSelected="onChatSelected"
                :active-thread="threadId"
            />
        </template>
        <div class="flex-1 h-screen w-full">
            <ChatContainer
                :message-history="messageHistory"
                :thread-id="threadId"
                @thread-selected="onChatSelected"
            />
        </div>
    </resizable-sidebar-layout>
</template>

<script lang="ts" setup>
import ResizableSidebarLayout from '~/components/ResizableSidebarLayout.vue';
import { db, upsert } from '~/db';
import { ref, onMounted, watch } from 'vue';
import Dexie from 'dexie';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const messageHistory = ref<ChatMessage[]>([]);
const threadId = ref(''); // Replace with actual thread ID logic

async function getMessagesForThread(id: string) {
    if (!id) return;

    // Query ordered messages via compound index and filter deleted
    const msgs = await db.messages
        .where('[thread_id+index]')
        .between([id, Dexie.minKey], [id, Dexie.maxKey])
        .filter((m: any) => !m.deleted)
        .toArray();

    if (msgs) {
        messageHistory.value = msgs.map((msg: any) => {
            const data = msg.data as unknown;
            const content =
                typeof data === 'object' && data !== null && 'content' in data
                    ? String((data as any).content ?? '')
                    : String((msg.content as any) ?? '');
            return {
                role: msg.role as 'user' | 'assistant',
                content,
            };
        });

        console.log('Messages for thread:', id, messageHistory.value);
    }
}

onMounted(async () => {
    await getMessagesForThread(threadId.value);
});

watch(
    () => threadId.value,
    async (newThreadId) => {
        if (newThreadId) {
            // Bump updated_at to reflect "last opened" ordering in sidebar
            const t = await db.threads.get(newThreadId);
            if (t) {
                const now = Math.floor(Date.now() / 1000);
                await upsert.thread({ ...t, updated_at: now });
            }
            await getMessagesForThread(newThreadId);
        }
    }
);

function onNewChat() {
    messageHistory.value = [];
    threadId.value = '';
    console.log('New chat started, cleared message history and thread ID');
}

function onChatSelected(chatId: string) {
    threadId.value = chatId;
}

// Optional enhancement: if needed, we can also watch for outgoing user messages from ChatContainer via a custom event
// and append to messageHistory immediately to avoid any initial blank state. Current fix defers parent overwrite during loading instead.
</script>

<style>
body {
    overflow-y: hidden; /* Prevents body scroll */
}
</style>
````

## File: app/app.config.ts
````typescript
export default defineAppConfig({
    ui: {
        button: {
            slots: {
                // Make base styles clearly different so it's obvious when applied
                base: ['transition-colors', 'retro-btn dark:retro-btn'],
                // Label tweaks are rarely overridden by variants, good to verify
                label: 'truncate uppercase tracking-wider',
                leadingIcon: 'shrink-0',
                leadingAvatar: 'shrink-0',
                leadingAvatarSize: '',
                trailingIcon: 'shrink-0',
            },
            variants: {
                // Override size variant so padding wins over defaults
                size: {
                    xs: { base: 'h-[24px] w-[24px] px-0! text-[14px]' },
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
                square: {
                    true: 'px-0! aspect-square!',
                },
                buttonGroup: {
                    horizontal:
                        'first:rounded-l-[3px]! first:rounded-r-none! rounded-none! last:rounded-l-none! last:rounded-r-[3px]!',
                    vertical:
                        'first:rounded-t-[3px]! first:rounded-b-none! rounded-none! last:rounded-t-none! last:rounded-b-[3px]!',
                },
            },
        },
        input: {
            slots: {
                base: 'mt-0 rounded-md border-[2px] border-[var(--md-inverse-surface)]  focus:border-[var(--md-primary)] focus:ring-1 focus:ring-[var(--md-primary)]',
            },
            variants: {
                // When using leading/trailing icons, bump padding so text/placeholder doesn't overlap the icon
                leading: { true: 'ps-10!' },
                trailing: { true: 'pe-10!' },
                size: {
                    sm: { base: 'h-[32px] px-[12px]! text-[16px]' },
                    md: { base: 'h-[40px] px-[16px]! text-[17px]' },
                    lg: { base: 'h-[56px] px-[24px]! text-[24px]' },
                },
            },
        },
        formField: {
            slots: {
                base: 'flex flex-col ',
                label: 'text-sm font-medium -mb-1 px-1',
                help: 'mt-[4px] text-xs text-[var(--md-secondary)] px-1!',
            },
        },
        buttonGroup: {
            base: 'relative',
            variants: {
                orientation: {
                    horizontal: 'inline-flex -space-x-px',
                    vertical: 'flex flex-col -space-y-px',
                },
            },
        },
        // Make the toast close button md-sized by default
        toast: {
            slots: {
                root: 'border border-2 retro-shadow rounded-[3px]',
                // Match our md button height (40px) and enforce perfect centering
                close: 'inline-flex items-center justify-center leading-none h-[32px] w-[32px] p-0',
            },
        },
        popover: {
            slots: {
                content:
                    'bg-white dark:bg-black rounded-[3px] border-black border-2 p-0.5',
            },
        },
    },
});
````

## File: app/assets/css/main.css
````css
/* Tailwind v4: single import includes preflight + utilities */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* Nuxt UI base styles (load first so we can override its tokens below) */
@import "@nuxt/ui";

/* Ensure Tailwind scans files outside srcDir (e.g. root-level app.config.ts)
	so classes used in Nuxt UI theme overrides are generated. */
@source "../../../app.config.ts";


/* Your Material theme variable files (scoped: .light, .dark, etc.) */
@import "./theme.css";

/* Map Material variables to Nuxt UI tokens (loads last to win cascade) */
@import "~/assets/css/nuxt-ui-map.css";

/* Font setup: body uses VT323, headings use Press Start 2P */
:root {
	/* Tailwind v4 token vars (optional for font utilities) */
	--font-sans: "VT323", ui-sans-serif, system-ui, sans-serif;
	--font-heading: "Press Start 2P", ui-sans-serif, system-ui, sans-serif;
    --ui-radius: 3px;
}

html, body {
	font-family: var(--font-sans) !important;
    font-size: 20px; 
}

h1, h2, h3, h4, h5, h6, .font-heading {
	font-family: var(--font-heading) !important;
}

.retro-btn { 
	display: inline-flex;
	line-height: 1; /* avoid extra vertical space from font metrics */
	position: relative;
	border-radius: 3px;                               /* default */
	border: 2px solid var(--md-inverse-surface);      /* dark 2px outline */
	box-shadow: 2px 2px 0 var(--md-inverse-surface);  /* hard, pixel shadow (no blur) */
	transition: transform 80ms ease, box-shadow 80ms ease;
}

/* Icon-only (aspect-square) buttons: center icon perfectly and remove padding */
.retro-btn.aspect-square {
	padding: 0; /* our button variant already sets px-0, this enforces it */
	place-items: center;
}

/* Physical press: move button into its shadow and add subtle inner bevel */
.retro-btn:active {
	transform: translate(2px, 2px);
	box-shadow: 0 0 0 var(--md-inverse-surface),
							inset 0 2px 0 rgba(0, 0, 0, 0.25),
							inset 0 -2px 0 rgba(255, 255, 255, 0.12);
}

.active-element {
		box-shadow: 0 0 0 var(--md-inverse-surface),
							inset 0 2px 0 rgba(0, 0, 0, 0.25),
							inset 0 -2px 0 rgba(255, 255, 255, 0.12);
}

/* Keyboard accessibility: preserve pixel look while focused */
.retro-btn:focus-visible {
	outline: 2px solid var(--md-primary);
	outline-offset: 2px;
}

.retro-shadow {
	box-shadow: 2px 2px 0 var(--md-inverse-surface);
}

/* Global thin colored scrollbars (WebKit + Firefox) */
/* Firefox */
html {
	scrollbar-width: thin;
	/* thumb color, then track color */
	scrollbar-color: var(--md-primary) transparent;
}

/* WebKit (Chromium, Safari) */
/* Apply to all scrollable elements */
*::-webkit-scrollbar {
	width: 8px;
	height: 8px;
}
*::-webkit-scrollbar-track {
	background: transparent;
	border-radius: 9999px;
}
*::-webkit-scrollbar-thumb {
	background: var(--md-primary);
	border-radius: 9999px;
	border: 2px solid transparent; /* creates padding so the thumb appears thinner */
	background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
	background: color-mix(in oklab, var(--md-primary) 85%, black);
}
*::-webkit-scrollbar-corner { background: transparent; }
````

## File: app/composables/useAi.ts
````typescript
import { ref, computed } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { create, db, tx, upsert } from '~/db';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export function useChat(msgs: ChatMessage[] = [], initialThreadId?: string) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const threadIdRef = ref<string | undefined>(initialThreadId);

    // Make provider reactive so it initializes when apiKey arrives later
    const openrouter = computed(() =>
        apiKey.value ? createOpenRouter({ apiKey: apiKey.value }) : null
    );

    async function sendMessage(content: string, model = DEFAULT_AI_MODEL) {
        if (!apiKey.value || !openrouter.value) {
            return console.log('No API key set');
        }

        if (!threadIdRef.value) {
            // Pass minimal fields; DB layer (ThreadCreateSchema) fills defaults
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
            });
            threadIdRef.value = newThread.id;
        }

        // Allow transforms on outgoing user content
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );
        // Persist user message first (DB fills defaults and index)
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing },
        });
        messages.value.push({ role: 'user', content: outgoing });
        loading.value = true;

        try {
            const startedAt = Date.now();
            // Let callers change the model or the messages before sending
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            console.log('Message sending with model:', modelId);

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messages.value
            );

            // Prepare assistant placeholder in DB and include a stream id
            const streamId = newId();
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: streamId,
                data: { content: '' },
            });

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            const result = streamText({
                model: openrouter.value!.chat(modelId),
                messages: effectiveMessages,
            });

            // Create assistant placeholder in UI
            const idx =
                messages.value.push({ role: 'assistant', content: '' }) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100; // throttle window
            let lastPersistAt = 0;
            for await (const delta of result.textStream) {
                await hooks.doAction('ai.chat.stream:action:delta', delta, {
                    threadId: threadIdRef.value,
                    assistantId: assistantDbMsg.id,
                    streamId,
                    deltaLength: String(delta ?? '').length,
                    totalLength:
                        (current.content?.length ?? 0) +
                        String(delta ?? '').length,
                    chunkIndex: chunkIndex++,
                });
                current.content = (current.content ?? '') + String(delta ?? '');
                // Persist incremental content (throttled)
                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: current.content,
                        },
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    lastPersistAt = now;
                }
            }

            // Final post-processing of the full assistant text
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                current.content,
                threadIdRef.value
            );
            current.content = incoming;
            // Finalize assistant message in DB (final upsert ensures last chunk is saved)
            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                },
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);

            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
                request: { modelId, userId: userDbMsg.id },
                response: {
                    assistantId: assistantDbMsg.id,
                    length: incoming.length,
                },
                timings: {
                    startedAt,
                    endedAt,
                    durationMs: endedAt - startedAt,
                },
            });
        } catch (err) {
            await hooks.doAction('ai.chat.error:action', {
                threadId: threadIdRef.value,
                stage: 'stream',
                error: err,
            });
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return { messages, sendMessage, loading, threadId: threadIdRef };
}
````

## File: app/components/chat/ChatContainer.vue
````vue
<template>
    <main
        class="flex w-full flex-1 flex-col overflow-hidden transition-[width,height]"
    >
        <div
            class="absolute w-full h-screen overflow-y-scroll sm:pt-3.5 pb-[165px]"
        >
            <div
                class="mx-auto flex w-full px-1.5 sm:px-0 sm:max-w-[768px] flex-col space-y-12 pb-10 pt-safe-offset-10"
            >
                <ChatMessage
                    v-for="(message, index) in messages || []"
                    :key="
                        message.id ||
                        message.stream_id ||
                        `${index}-${message.role}`
                    "
                    :message="message"
                />
            </div>
        </div>
        <div class="pointer-events-none absolute bottom-0 top-0 w-full">
            <div
                class="pointer-events-none absolute bottom-0 z-30 w-full flex justify-center pr-0.5 sm:pr-[11px]"
            >
                <chat-input-dropper
                    :loading="loading"
                    @send="onSend"
                    @model-change="onModelChange"
                    class="pointer-events-auto w-full max-w-[780px] mx-auto mb-1 sm:mb-2"
                />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import ChatMessage from './ChatMessage.vue';
import { shallowRef, computed, watch } from 'vue';

type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    stream_id?: string;
};

const model = ref('openai/gpt-oss-120b');

function onModelChange(newModel: string) {
    model.value = newModel;
    console.log('Model changed to:', newModel);
}

const props = defineProps<{
    threadId?: string;
    messageHistory?: ChatMessage[];
}>();

const emit = defineEmits<{
    (e: 'thread-selected', id: string): void;
}>();

// Initialize chat composable and make it refresh when threadId changes
const chat = shallowRef(useChat(props.messageHistory, props.threadId));

watch(
    () => props.threadId,
    (newId) => {
        const currentId = chat.value?.threadId?.value;
        // Avoid re-initializing if the composable already set the same id (first-send case)
        if (newId && currentId && newId === currentId) return;
        chat.value = useChat(props.messageHistory, newId);
    }
);

// Keep composable messages in sync when parent provides an updated messageHistory
watch(
    () => props.messageHistory,
    (mh) => {
        if (!chat.value) return;
        // While streaming, don't clobber the in-flight assistant placeholder with stale DB content
        if (chat.value.loading.value) return;
        // Prefer to update the internal messages array directly to avoid remount flicker
        chat.value.messages.value = [...(mh || [])];
    }
);

// When a new thread id is created internally (first send), propagate upward once
watch(
    () => chat.value?.threadId?.value,
    (id, prev) => {
        if (!prev && id) emit('thread-selected', id);
    }
);

// Stable bindings for template consumption
const messages = computed<ChatMessage[]>(() => chat.value.messages.value);
const loading = computed(() => chat.value.loading.value);

function onSend(payload: any) {
    if (loading.value) return; // prevent duplicate sends while streaming
    chat.value.sendMessage(payload.text, model.value || undefined);
}
</script>

<style></style>
````

## File: app/pages/_test.vue
````vue
<template>
    <resizable-sidebar-layout>
        <template #sidebar>
            <div class="flex flex-col h-full relative">
                <div class="p-2 flex flex-col space-y-2">
                    <UButton class="w-full flex items-center justify-center"
                        >New Chat</UButton
                    >
                    <UInput
                        icon="i-lucide-search"
                        size="md"
                        variant="outline"
                        placeholder="Search..."
                        class="w-full ml-[1px]"
                    ></UInput>
                </div>
                <div class="flex flex-col p-2 space-y-1.5">
                    <RetroGlassBtn>Chat about tacos</RetroGlassBtn>
                    <UButton
                        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                        >Chat about aids</UButton
                    >
                    <UButton
                        class="w-full bg-[var(--md-inverse-surface)]/5 hover:bg-primary/15 active:bg-[var(--md-primary)]/25 backdrop-blur-sm text-[var(--md-on-surface)]"
                        >Chat about dogs</UButton
                    >
                </div>
                <sidebar-side-bottom-nav />
            </div>
        </template>

        <!-- Default slot = main content (right side) -->
        <div class="h-screen overflow-y-scroll">
            <div
                class="ml-5 mt-5 flex w-full md:w-[820px] h-[250px] bg-white/5 border-2 retro-shadow backdrop-blur-sm"
            ></div>

            <div class="p-6 space-y-4">
                <div class="flex flex-row space-x-2">
                    <UButton @click="showToast" size="sm" color="primary"
                        >Nuxt UI Button</UButton
                    >
                    <UButton color="success">Nuxt UI Button</UButton>
                    <UButton size="lg" color="warning">Nuxt UI Button</UButton>
                </div>
                <div class="flex flex-row space-x-2">
                    <UButtonGroup size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                    <UButtonGroup orientation="vertical" size="lg">
                        <UButton @click="showToast" color="primary"
                            >Nuxt UI Button</UButton
                        >
                        <UButton color="success">Nuxt UI Button</UButton>
                        <UButton color="warning">Nuxt UI Button</UButton>
                    </UButtonGroup>
                </div>

                <div class="flex space-x-2">
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="sm"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="md"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Email"
                        help="We won't share your email."
                        required
                    >
                        <UInput
                            size="lg"
                            placeholder="Enter email"
                            :ui="{ base: 'peer' }"
                        >
                        </UInput>
                    </UFormField>
                </div>

                <div class="flex items-center gap-3">
                    <button
                        class="px-3 py-1.5 rounded border text-sm bg-[var(--md-primary)] text-[var(--md-on-primary)] border-[var(--md-outline)]"
                        @click="toggle()"
                    >
                        Toggle Light/Dark
                    </button>
                    <span class="text-[var(--md-on-surface)]"
                        >Current: {{ theme }}</span
                    >
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div
                        class="p-4 rounded bg-[var(--md-surface)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)]"
                    >
                        Surface / On-Surface
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]"
                    >
                        Secondary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-tertiary-container)] text-[var(--md-on-tertiary-container)]"
                    >
                        Tertiary Container
                    </div>
                    <div
                        class="p-4 rounded bg-[var(--md-error-container)] text-[var(--md-on-error-container)]"
                    >
                        Error Container
                    </div>
                </div>

                <chat-input-dropper />
            </div>
        </div>
    </resizable-sidebar-layout>
</template>

<script setup lang="ts">
import RetroGlassBtn from '~/components/RetroGlassBtn.vue';

const nuxtApp = useNuxtApp();
const theme = computed(() => (nuxtApp.$theme as any).get());
const toggle = () => (nuxtApp.$theme as any).toggle();
const toast = useToast();

function showToast() {
    toast.add({
        title: 'Success',
        description: 'Your action was completed successfully.',
        color: 'success',
    });
}
</script>
````

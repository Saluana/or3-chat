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
  pages/
    _test.vue
    home.vue
    homepage.vue
  plugins/
    theme.client.ts
  app.vue
public/
  robots.txt
types/
  nuxt.d.ts
.gitignore
app.config.ts
nuxt.config.ts
package.json
README.md
tsconfig.json
```

# Files

## File: app.config.ts
````typescript
// Allow using the Nuxt macro without relying on generated types at dev-time in this editor.
// Nuxt will inject the proper macro type from .nuxt during build/dev.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const defineAppConfig: (config: any) => any;

export default defineAppConfig({
    // Nuxt UI global component theme overrides
    ui: {
        button: {
            // Add or override classes on internal slots
            // See https://ui.nuxt.com/components/button#theme for available slots/variants
            slots: {
                // Strengthen the default weight and slightly increase rounding globally
                // Keep spacing overrides in variants.size.* so they win over defaults
                base: [
                    'rounded-md font-medium px-[100px] inline-flex items-center disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:opacity-75 aria-disabled:opacity-75',
                    'transition-colors',
                ],
            },
        },
    },
});
````

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

## File: public/robots.txt
````
User-Agent: *
Disallow:
````

## File: types/nuxt.d.ts
````typescript
// Type augmentation for the theme plugin
declare module '#app' {
    interface NuxtApp {
        $theme: {
            set: (name: string) => void;
            toggle: () => void;
            get: () => string;
            system: () => 'light' | 'dark';
        };
    }
}

export {};
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

## File: README.md
````markdown
# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

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
    "@nuxt/ui": "3.3.2",
    "dexie": "^4.0.11",
    "nuxt": "^4.0.3",
    "orama": "^2.0.6",
    "typescript": "^5.6.3",
    "vue": "^3.5.18",
    "vue-router": "^4.5.1",
    "zod": "^4.0.17"
  }
}
````

## File: app/pages/_test.vue
````vue
<template>
    <div class="p-6 space-y-4">
        <UButton color="primary">Nuxt UI Button</UButton>
        <UButton color="success">Nuxt UI Button</UButton>
        <UButton color="warning">Nuxt UI Button</UButton>

        <UInput></UInput>
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
    </div>
</template>

<script setup lang="ts">
const nuxtApp = useNuxtApp();
const theme = computed(() => (nuxtApp.$theme as any).get());
const toggle = () => (nuxtApp.$theme as any).toggle();
</script>
````

## File: app/assets/css/main.css
````css
/* Tailwind v4: single import includes preflight + utilities */
@import "tailwindcss";

/* Nuxt UI base styles (load first so we can override its tokens below) */
@import "@nuxt/ui";

/* Ensure Tailwind scans files outside srcDir (e.g. root-level app.config.ts)
	so classes used in Nuxt UI theme overrides are generated. */
@source "../../app.config.ts";


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
````

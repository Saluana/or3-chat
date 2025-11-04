# Theme Testing Scripts

These scripts are for testing the theme system manually in the browser console.

## Usage

1. Start your development server: `bun run dev`
2. Open your browser to `http://localhost:3001`
3. Open the browser console (F12 or Cmd+Opt+J)
4. Copy and paste the contents of either script into the console

## Scripts

### `test-theme-switch.js`
Automated test script that cycles through all available themes and tests dark/light mode toggling.

### `set-theme.js`
Simple script to switch to the cyberpunk theme and display available themes.

## Notes

- These scripts are for development/testing purposes only
- They rely on the Nuxt theme plugin being available as `window.$nuxt.$theme`
- The scripts will automatically execute when pasted into the console

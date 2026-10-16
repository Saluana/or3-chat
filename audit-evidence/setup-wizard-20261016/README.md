# Source setup wizard journeys — evidence

Produced by `bun run test:e2e:setup-wizard` (journeys W1–W6 in
[planning/setup-ux/journeys.md](../../planning/setup-ux/journeys.md)) against a
disposable copy of the checkout, Chromium 1280×720 (phone: 390×844). Rerun the
harness to regenerate everything here; it also writes a Playwright trace per
journey to `test-results/setup-wizard/` (not committed, about 22 MB).

| File | Journey and what it shows |
| --- | --- |
| `w1-first-step.png` | W1. The first step is template selection; Advanced setup is collapsed; no Back button. |
| `w1-saved.png` | W1. After Save Settings: one "Settings saved" message naming `bun run dev`, then the admin login card. |
| `w2-advanced-open.png` | W2. Advanced setup open in place; the branding, theme, feature and provider steps join the sidebar. |
| `w2-advanced-open-mobile.png` | W2. The same section at phone width. |
| `w3-field-error.png` | W3. An invalid public domain keeps the step and shows the error inside Advanced setup. |
| `w4-failed-start.png` | W4. With port 3000 held, Apply + Deploy reads as a failure; recovery names `bun run dev`; the login stays. |
| `w6-deployed.png` | W6. Authenticated deploy started with `bun run dev` (SSR auth from `.env`). |
| `w6-signed-in-app.png` | W6. Signed in with the login card's email and password, after a reload. |
| `w5-browser-only-app.png` | W5. Browser-only deploy started with the same command and opened the app without sign-in. |
| `timings.json` | Startup on this machine with the current Nuxt-dev wizard host: command launch to wizard URL, and to the first interactive screen (session loaded, cards live). |

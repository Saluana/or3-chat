# Setup and sign-in browser journeys

Written before implementation. Each journey names the surface it proves, what
must be true at each step, and the evidence it leaves (Playwright trace,
screenshots, timings). Journeys run through named harnesses only, because they
write credentials and start servers.

| Area | Harness | PR |
| --- | --- | --- |
| Source wizard (W1–W6) | `bun run test:e2e:setup-wizard` | #258 |
| Wizard runtime startup (R1–R3) | same harness, `--grep startup` | wizard-runtime follow-up |
| Dependency install (D1–D2) | shell transcript (no browser) | dependency follow-up |
| Sign-in and registration (S1–S8) | `bun run test:e2e:sign-in-gate` | sign-in follow-ups |

Evidence lands in `test-results/<harness>/` (traces and screenshots per test)
plus a `timings.json` for startup measurements.

## Source wizard

**W1. Save on the recommended path.** Open the wizard URL with its token.
- The first screen is template selection: four (or three, from `--mode self-hosted`) cards, Self-hosted marked Recommended.
- No Back button on the first visible step. Advanced setup is collapsed.
- Continue → Admin account → enter an email → Review.
- Save Settings → exactly one success message ("Settings saved"), the admin
  login card with email, password and Copy login, and a Next Steps list whose
  start command is `<package manager> run dev`.
- Evidence: screenshot of step 1 and the saved review.

**W2. Advanced navigation.** From step 1:
- Expand Advanced setup: project folder, settings file, package manager,
  deployment and preview-only fields appear. Every checkbox shows its own
  description, never "Enabled"/"Disabled".
- Branding, Look & Feel, Features and Providers steps appear in the sidebar.
- Continue through one extra step, use the sidebar to return to step 1: Advanced
  setup is still expanded and values are kept; Back is hidden again.
- Collapse Advanced setup: the extra steps leave the sidebar.

**W3. Field errors are preserved.** Choose Docker with a public domain, enter
`https://bad/`, Continue: the step stays put, the field shows its error inside
the expanded Advanced setup section, and the sidebar marks the step.

**W4. Failed deployment.** Hold port 3000, choose Apply + Deploy on the
recommended path.
- The result reads as a failure (no success check), names the busy port, and
  the recovery steps give the same start command as W1.
- The admin login card is still shown (settings were written).

**W5. Browser-only deployment starts.** Template "This device only", Apply +
Deploy. The deploy runs `<package manager> run dev`; `/api/health` answers and
the app opens without a sign-in prompt (SSR auth off, per `.env`). The wizard
hands off to the app and stops, so this journey runs last.

**W6. Authenticated deployment starts.** Recommended template, Apply + Deploy.
The same command starts the app with SSR auth on (from `.env`), and the email
and password shown in the login card sign in; the session survives a reload.

Terminal parity (not a browser journey, checked in the same PR): the terminal
wizard's cheat sheet, the configure-only next steps and the server's
local-deploy command all print the same `<package manager> run dev`.

## Wizard runtime startup

**R1. Launch to first interactive screen.** From `bun run setup --ui --no-open`
to the template cards being clickable (the browser's session request answered,
not just `/api/health`). Three cold runs on one machine after `bun install`,
each a fresh process with the prebuilt page removed first; target under 10
seconds each. Recorded in `timings.json`.

**R2. Protection.** The wizard binds to 127.0.0.1 only; API calls without the
token are refused; the temporary host directory is removed after exit.

**R3. Isolation.** Saving settings changes the target instance's `.env` but not
the running wizard's configuration.

## Dependency install

**D1.** `bun install` with an empty cache and GitHub unreachable succeeds and
does not request `github.com` / `api.github.com`.

**D2.** Wizard local deployment (which runs the install) succeeds under the same
conditions. SQLite integration tests still run against the real driver.

## Sign-in and registration

Profile: Basic Auth + SQLite + filesystem storage, guest access off, unless a
journey says otherwise.

**S1. Desktop sign-in.** Signed out at 1440×900: the landing shows a prominent
"Sign in to start chatting" button. It and the composer open the same sign-in
dialog. Sign in → the button disappears and chat is usable.

**S2. Mobile sign-in.** Same at 390×844, including the composer entry point.

**S3. No prompt while loading.** Delay `/api/auth/session`: neither the button
nor the dialog appears until the session resolves.

**S4. Open registration.** The dialog offers "Create account"; registering
signs the new user in.

**S5. Invite-only registration.** The dialog does not offer open sign-up; it
offers "Have an invitation?" wording. A valid invite link opens the invitation
form with the token filled; a manually pasted valid token also works; an
invalid or forged token shows a clear error and creates no account.

**S6. Registration disabled.** No registration affordance at all; the server
still refuses a direct registration request.

**S7. Session persists after reload.** After S1/S4/S5, reload: still signed in,
no sign-in button.

**S8. Guest and browser-only modes unchanged.** With guest access on, or SSR
auth off, no sign-in button or dialog is forced.

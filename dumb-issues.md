## Convex dev blocks the rest of local deploy

**Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/deploy.ts:148` and `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/deploy.ts:181`

**Code:**
```ts
commands.push({ step: 'Start Convex dev', command: 'bunx', args: ['convex', 'dev'], optional: true })
...
for (const command of commands) {
  await runCommand(command, answers.instanceDir)
}
```

`bunx convex dev` is long-running. You execute it inline before `bun run dev:ssr`, so the loop never reaches Nuxt startup for local-dev.

**Consequence:** users pick local-dev and get stuck in Convex forever with no OR3 server booted.

**Fix:** either run Convex in detached/background mode, or don’t auto-run it and print a separate instruction. Example:
```ts
if (answers.deploymentTarget === 'local-dev' && wantsConvex) {
  spawn('bunx', ['convex', 'dev'], { cwd, detached: true, stdio: 'ignore' }).unref()
}
await runCommand({ step: 'Start Nuxt SSR', command: 'bun', args: ['run', 'dev:ssr'] }, cwd)
```

## Convex URL validation is gated by the wrong feature flag

**Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/validation.ts:115`

**Code:**
```ts
if (answers.syncEnabled && (answers.syncProvider === 'convex' || answers.storageProvider === 'convex')) {
  // validate VITE_CONVEX_URL
}
```

This only validates `VITE_CONVEX_URL` when `syncEnabled` is true. If sync is off but storage provider is Convex, URL validation is skipped.

**Consequence:** wizard can write an invalid Convex storage config that passes validation and fails later at runtime.

**Fix:** validate by each feature’s enable flag:
```ts
const needsConvexUrl =
  (answers.syncEnabled && answers.syncProvider === 'convex') ||
  (answers.storageEnabled && answers.storageProvider === 'convex')
```

## You persist secrets to disk by default

**Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/api.ts:100` and `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/store.ts:37`

**Code:**
```ts
includeSecrets: input.includeSecrets ?? true
...
await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8')
```

Session files store raw answers and default to including secrets. That means JWT secrets, passwords, and API keys land in plaintext under `~/.or3-cloud/sessions`.

**Consequence:** local compromise, backups, shared machines, and support bundles can leak production credentials.

**Fix:** default to `includeSecrets: false`, persist only non-secret fields, and re-prompt secrets on resume. If secret persistence is ever allowed, encrypt at rest.

## Password prompts are not masked

**Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/cli/or3-cloud.ts:187`

**Code:**
```ts
case 'password':
case 'text':
  return prompt.text(...)
```

Password fields use the same visible terminal input as plain text.

**Consequence:** shoulder-surfing and shell recording leaks credentials during setup.

**Fix:** implement hidden input for `password` fields (disable TTY echo or use a prompt library that supports masked input).

## Preset application order silently clobbers explicit user input

**Location:** `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/api.ts:139` and `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/api.ts:147`

**Code:**
```ts
let nextAnswers = completeAnswers({ ...session.answers, ...patch })
...
nextAnswers = applyPresetAnswers(nextAnswers, preset)
```

If a patch contains `presetName` plus explicit overrides, you apply the preset *after* merging the patch, so preset defaults can overwrite user-provided values in the same submit call.

**Consequence:** non-deterministic behavior depending on update ordering; users see values “change back” unexpectedly.

**Fix:** apply preset first, then overlay explicit patch values:
```ts
let nextAnswers = completeAnswers(session.answers)
if (patch.presetName) nextAnswers = applyPresetAnswers(nextAnswers, preset)
nextAnswers = completeAnswers({ ...nextAnswers, ...patch })
```

## Invalid package-manager values fall through to npm execution

**Location:** `/Users/brendon/Documents/or3/or3-chat/scripts/cli/or3-cloud.ts:222` and `/Users/brendon/Documents/or3/or3-chat/shared/cloud/wizard/install-plan.ts:120`

**Code:**
```ts
const packageManager = (toStringFlag(flags, 'package-manager') ?? 'bun') as InstallPackageManager
...
if (options.packageManager === 'bun') { ... } else { await runCommand('npm', ...) }
```

`--package-manager` is unchecked. Any typo (like `--package-manager bnu`) drops into the `else` branch and runs npm.

**Consequence:** users run the wrong installer silently and mutate lockfiles/tooling unexpectedly.

**Fix:** validate input strictly and fail fast:
```ts
const raw = toStringFlag(flags, 'package-manager') ?? 'bun'
if (raw !== 'bun' && raw !== 'npm') throw new Error('package-manager must be bun or npm')
```

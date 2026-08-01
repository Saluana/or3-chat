import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Check, flagPath, parseArgs, pathExists, printChecks, readJson } from './lib'
import { findOr3ChatRoot } from './detect-or3-context'

interface PackageJson {
  exports?: Record<string, unknown>
  scripts?: Record<string, string>
}

const DOCUMENT_ASSERTIONS = [
  {
    path: 'public/_documentation/plugins/runtime-v2-overview.md',
    text: 'not yet perform the immutable V2 candidate/promotion workflow',
    code: 'v2-activation-status-changed',
  },
  {
    path: 'public/_documentation/plugins/manifest-v2.md',
    text: 'requestedGrants',
    code: 'manifest-contract-changed',
  },
  {
    path: 'public/_documentation/plugins/plugin-sdk.md',
    text: '@or3/plugin-sdk',
    code: 'plugin-sdk-contract-changed',
  },
  {
    path: 'public/_documentation/themes/quick-start.md',
    text: 'bun run theme:create',
    code: 'theme-create-guidance-changed',
  },
  {
    path: 'public/_documentation/cloud/or3-cloud-wizard.md',
    text: 'bun run or3-cloud:init',
    code: 'setup-guidance-changed',
  },
  {
    path: 'public/_documentation/hooks/typed-hooks.md',
    text: 'createTypedHookEngine',
    code: 'typed-hooks-contract-changed',
  },
]

const REQUIRED_SCRIPTS = [
  'or3-cloud:init',
  'or3-cloud:validate',
  'doctor',
  'theme:create',
  'theme:validate',
  'theme:build-css',
  'plugin-runtime:cli',
]

export async function checkDocDrift(start: string): Promise<{ checks: Check[]; root: string | null }> {
  const root = await findOr3ChatRoot(start)
  if (!root) {
    return {
      checks: [{ code: 'or3-chat-not-found', level: 'error', message: 'No ancestor with package name or3-chat was found.', path: resolve(start) }],
      root: null,
    }
  }

  const checks: Check[] = []
  for (const assertion of DOCUMENT_ASSERTIONS) {
    const path = resolve(root, assertion.path)
    if (!await pathExists(path)) {
      checks.push({ code: 'document-missing', level: 'error', message: `Required source document is missing: ${assertion.path}.`, path })
      continue
    }
    if (!(await readFile(path, 'utf8')).includes(assertion.text)) {
      checks.push({ code: assertion.code, level: 'error', message: 'Public guidance changed; review and update the skill before accepting the new contract.', path })
    }
  }

  const chatPackage = await readJson<PackageJson>(resolve(root, 'package.json'))
  for (const script of REQUIRED_SCRIPTS) {
    if (!chatPackage.scripts?.[script]) {
      checks.push({ code: 'required-script-missing', level: 'error', message: `Expected package script ${script} is unavailable.`, path: resolve(root, 'package.json') })
    }
  }

  const sdkPath = resolve(root, 'packages/plugin-sdk/package.json')
  if (!await pathExists(sdkPath)) {
    checks.push({ code: 'plugin-sdk-missing', level: 'error', message: 'Plugin SDK package is missing.', path: sdkPath })
  } else {
    const sdk = await readJson<PackageJson>(sdkPath)
    for (const entrypoint of ['.', './manifest', './host', './testing']) {
      if (!sdk.exports?.[entrypoint]) {
        checks.push({ code: 'plugin-sdk-export-missing', level: 'error', message: `Expected SDK entrypoint ${entrypoint} is unavailable.`, path: sdkPath })
      }
    }
  }

  return { checks, root }
}

if (import.meta.main) {
  const { flags } = parseArgs(Bun.argv.slice(2))
  const start = flagPath(flags, 'cwd', process.cwd())
  const { checks, root } = await checkDocDrift(start)
  const passed = printChecks(checks, flags.has('json'), { root })
  if (!passed) process.exitCode = 1
}

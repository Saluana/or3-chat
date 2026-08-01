import { resolve } from 'node:path'
import { Check, flagPath, findUp, parseArgs, pathExists, printChecks, readJson, runText } from './lib'

interface PackageJson {
  dependencies?: Record<string, string>
  packageManager?: string
  scripts?: Record<string, string>
  version?: string
  name?: string
}

export interface Or3Context {
  commit: string | null
  docmap: boolean
  instructions: string | null
  internClient: boolean
  packageManager: string | null
  pluginRuntime: { v1Workspace: boolean; v2Sdk: boolean; cli: boolean }
  product: 'or3-chat'
  root: string
  setup: { init: boolean; doctor: boolean; validate: boolean }
  theme: { create: boolean; validate: boolean; buildCss: boolean }
  version: string | null
}

export async function findOr3ChatRoot(start: string) {
  return findUp(start, async (candidate) => {
    const packagePath = resolve(candidate, 'package.json')
    if (!await pathExists(packagePath)) return false
    const packageJson = await readJson<PackageJson>(packagePath)
    return packageJson.name === 'or3-chat'
  })
}

export async function detectOr3Context(start: string): Promise<{ checks: Check[]; context: Or3Context | null }> {
  const root = await findOr3ChatRoot(start)
  if (!root) {
    return {
      checks: [{ code: 'or3-chat-not-found', level: 'error', message: 'No ancestor with package name or3-chat was found.', path: resolve(start) }],
      context: null,
    }
  }

  const packageJson = await readJson<PackageJson>(resolve(root, 'package.json'))
  const scripts = packageJson.scripts ?? {}
  const git = await runText(['git', 'rev-parse', '--short', 'HEAD'], root)
  const context: Or3Context = {
    commit: git.exitCode === 0 ? git.stdout : null,
    docmap: await pathExists(resolve(root, 'public/_documentation/docmap.json')),
    instructions: await pathExists(resolve(root, 'AGENTS.md')) ? resolve(root, 'AGENTS.md') : null,
    internClient: Boolean(packageJson.dependencies?.['@or3/intern-client']),
    packageManager: packageJson.packageManager ?? null,
    pluginRuntime: {
      v1Workspace: await pathExists(resolve(root, 'extensions/plugins')),
      v2Sdk: await pathExists(resolve(root, 'packages/plugin-sdk/package.json')),
      cli: Boolean(scripts['plugin-runtime:cli']),
    },
    product: 'or3-chat',
    root,
    setup: {
      init: Boolean(scripts['or3-cloud:init']),
      doctor: Boolean(scripts.doctor),
      validate: Boolean(scripts['or3-cloud:validate']),
    },
    theme: {
      create: Boolean(scripts['theme:create']),
      validate: Boolean(scripts['theme:validate']),
      buildCss: Boolean(scripts['theme:build-css']),
    },
    version: packageJson.version ?? null,
  }

  const checks: Check[] = []
  if (!context.instructions) checks.push({ code: 'agents-instructions-missing', level: 'warning', message: 'No root AGENTS.md was found.', path: root })
  if (!context.docmap) checks.push({ code: 'docmap-missing', level: 'warning', message: 'No public documentation map was found.', path: root })
  if (!context.pluginRuntime.v2Sdk) checks.push({ code: 'plugin-sdk-missing', level: 'warning', message: 'V2 package authoring surface was not detected.', path: root })
  if (!context.pluginRuntime.v1Workspace) checks.push({ code: 'v1-workspace-missing', level: 'warning', message: 'Bundled V1 plugin workspace was not detected.', path: root })
  if (!context.setup.init || !context.setup.validate || !context.theme.validate || !context.pluginRuntime.cli) {
    checks.push({ code: 'expected-command-missing', level: 'warning', message: 'One or more documented setup, theme, or plugin commands are unavailable.', path: resolve(root, 'package.json') })
  }

  return { checks, context }
}

if (import.meta.main) {
  const { flags } = parseArgs(Bun.argv.slice(2))
  const start = flagPath(flags, 'cwd', process.cwd())
  const { checks, context } = await detectOr3Context(start)
  const passed = printChecks(checks, flags.has('json'), { context })
  if (!passed) process.exitCode = 1
}

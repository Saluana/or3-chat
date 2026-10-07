#!/usr/bin/env node

import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCommandFlags, assertCommandPositionals, parseFlags } from './cli/args';
import { dispatchCommand, mutationDirectory, requiresMutationLease } from './cli/dispatch';
import { help } from './cli/help';
import { withDeploymentLease } from './deployment/lease';
import { PACKAGE_VERSION } from './package-info';
import { redact } from './util/primitives';

async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  if (command === '--help' || command === 'help') return help();
  if (command === '--version' || command === 'version') return console.log(PACKAGE_VERSION);
  try {
    const parsed = parseFlags(rest);
    if (parsed.flags.help) return help();
    assertCommandFlags(command, parsed.flags);
    assertCommandPositionals(command, parsed.positionals);
    const dispatch = () => dispatchCommand(command, parsed);
    if (requiresMutationLease(command, parsed)) {
      return await withDeploymentLease(mutationDirectory(command, parsed.positionals, parsed.flags), command, dispatch);
    }
    return await dispatch();
  } catch (error) {
    console.error(`\nOR3 Cloud failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  }
}

const invokedAsCli = process.argv[1]
  ? ['or3', 'cli.mjs'].includes(basename(process.argv[1]))
  : false;
if (invokedAsCli || (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))) {
  await main();
}

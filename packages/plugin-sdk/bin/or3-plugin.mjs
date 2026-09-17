#!/usr/bin/env node
import { runPluginCli } from '../dist/cli/index.js';

runPluginCli(process.argv.slice(2))
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[or3-plugin] ${message}\n`);
        process.exitCode = 1;
    });

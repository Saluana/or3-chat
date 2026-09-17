import { resolve } from 'node:path';
import { buildV2Package } from './build';
import { createV2Package } from './create';
import { inspectV2Package } from './inspect';
import { packV2Package } from './pack';
import { printJson } from './shared';
import { testV2Package } from './test';
import { formatValidationReport, validateV2Package } from './validate';

function usage(): string {
    return `Usage: or3-plugin <command> [options]

Commands:
  create --id <plugin-id> --dir <path> [--name <display-name>] [--template <name>]
  validate <package-root>
  test <package-root> [-- <test-args...>]
  build <package-root>
  pack <package-root> [--out <pack-dir>] [--archive <archive-path>]
  inspect <package-root-or-archive>

Templates:
  portable-v1   isolated-client package conformant with or3-portable-client-v1 (default)
  minimal-v2    trusted-host V2 package scaffold
`;
}

function requireArg(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1]) {
        throw new Error(`Missing required ${flag}`);
    }
    return args[index + 1]!;
}

export async function runPluginCli(argv: readonly string[]): Promise<number> {
    const [command, ...rest] = argv;
    if (!command || command === '-h' || command === '--help') {
        process.stdout.write(usage());
        return command ? 0 : 1;
    }

    switch (command) {
        case 'create': {
            const created = createV2Package({
                pluginId: requireArg(rest, '--id'),
                directory: requireArg(rest, '--dir'),
                name: rest.includes('--name') ? requireArg(rest, '--name') : undefined,
                template: rest.includes('--template')
                    ? requireArg(rest, '--template')
                    : undefined,
            });
            printJson({ status: 'created', ...created });
            return 0;
        }
        case 'validate': {
            const root = rest[0];
            if (!root) throw new Error('validate requires <package-root>');
            const report = await validateV2Package(root);
            process.stdout.write(formatValidationReport(report));
            return report.exitCode;
        }
        case 'test': {
            const root = rest[0];
            if (!root) throw new Error('test requires <package-root>');
            const separator = rest.indexOf('--');
            const extra = separator >= 0 ? rest.slice(separator + 1) : [];
            const result = testV2Package(root, { args: extra });
            return result.exitCode;
        }
        case 'build': {
            const root = rest[0];
            if (!root) throw new Error('build requires <package-root>');
            const result = await buildV2Package(root);
            printJson({
                status: 'built',
                sourceRoot: result.sourceRoot,
                buildRoot: result.buildRoot,
                files: result.files,
                digest: result.pack.verification.digest,
                packRoot: result.pack.packRoot,
            });
            return 0;
        }
        case 'pack': {
            const root = rest[0];
            if (!root) throw new Error('pack requires <package-root>');
            const out = rest.includes('--out') ? requireArg(rest, '--out') : undefined;
            const archive = rest.includes('--archive')
                ? requireArg(rest, '--archive')
                : undefined;
            const result = await packV2Package(root, {
                outputDirectory: out,
                archivePath: archive,
            });
            printJson({
                status: 'packed',
                sourceRoot: result.sourceRoot,
                packRoot: result.packRoot,
                files: result.files,
                digest: result.verification.digest,
                manifestDigest: result.verification.manifestDigest,
                archivePath: result.archivePath,
            });
            return 0;
        }
        case 'inspect': {
            const root = rest[0];
            if (!root) throw new Error('inspect requires <package-root>');
            const result = await inspectV2Package(resolve(root));
            printJson(result);
            return 0;
        }
        default: {
            process.stderr.write(`Unknown command: ${command}\n${usage()}`);
            return 1;
        }
    }
}

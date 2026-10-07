export function help() {
  console.log(`OR3 Cloud — managed container installer and operator

Usage:
  npx @or3/cloud init [directory] --local
  npx @or3/cloud init [directory] --public --domain <hostname>
  npx @or3/cloud update [--to <exact-version>] [--dry-run] [--json]
  npx @or3/cloud backup [list [--json]|prune [--keep <n>]|export <backup-id> <destination-dir>]
  npx @or3/cloud restore <backup-id-or-path> --yes
  npx @or3/cloud rollback --yes
  npx @or3/cloud credentials reset --yes [--owner-password-file <path> --admin-password-file <path>]
  npx @or3/cloud doctor
  npx @or3/cloud verify [--read-only] [--public] [--verification-email <email> --verification-password-file <path>]
  npx @or3/cloud recover [--dry-run | --finish | --restore --yes]
  npx @or3/cloud adopt --from <v1-directory> [directory]
  npx @or3/cloud status [--json]
  npx @or3/cloud logs [--tail <n>] [service]
  npx @or3/cloud start | stop | restart
  npx @or3/cloud remove [--purge-data --yes]

Options:
  --admin-email <email>          Administrator email for first login
  --admin-password <password>    Explicit password (prefer --admin-password-file); for credentials reset, the new admin password
  --admin-password-file <path>   Read the bootstrap/reset admin password without shell history
  --owner-password <password>    New owner (basic auth) password for credentials reset
  --owner-password-file <path>   Read the new owner password without shell history
  --verification-email <email>   Current owner email used only for this verification
  --verification-password-file <path>  Read the current owner password for this verification
  --port <port>                  Local OR3 port (default: 3000)
  --keep <n>                     Backups to retain when pruning (default: 5)
  --force                        Bypass suspect-entry deferral; protected recovery backups remain protected
  --tail <n>                     Log lines to show (default: 200)
  --public                       Require verification through the public HTTPS origin
  --read-only                    Verify without the lease, login, storage, or database writes
  --dry-run                      Preview an update or recovery without changing anything
  --finish                       Commit a proven completed replacement without restoring data
  --restore                      Explicitly restore the recorded snapshot (requires --yes)
  --json                         Emit one machine-readable result object on stdout
  --purge-data                   Remove data volumes and managed files (with remove)
  --yes                          Confirm a destructive restore, rollback, credentials reset, or purge
  --help                         Show this help
  --version                      Show the Cloud package version

The supported profile is Basic Auth + SQLite + filesystem storage.
The installer never changes firewall, DNS, Cloudflare, or Tailscale settings.`);
}

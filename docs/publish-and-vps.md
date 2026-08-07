# Deprecated: `create-or3-chat`

Normal installations now use the managed Cloud distribution:

```bash
npx @or3/cloud init --public --domain cloud.example.com
```

See [Installation and operations](installation.md) for local mode, Caddy,
nftables/UFW, Cloudflare, backups, upgrades, rollback, and adoption of an
existing generated project.

`create-or3-chat` remains available only for older generated projects and
source-development history. It is not the supported update path and does not
automatically upgrade an existing deployment.

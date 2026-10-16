# Installing without GitHub

`or3-provider-sqlite-tests` was a Git dependency
(`git+https://github.com/Saluana/or3-provider-sqlite.git#92f1262…`), so every
install with an empty cache downloaded a tarball from `api.github.com`. When
that host is unreachable or refuses the request, the install fails with the
error reported in setup testing:

```
error: GET https://api.github.com/repos/Saluana/or3-provider-sqlite/tarball/92f1262 - 403
```

## Cause of the reported 403

The 403 was not GitHub rate limiting. The setup test ran in a sandbox whose
egress proxy only allows GitHub repositories attached to the session; the same
request for a repository outside that set returns the proxy's JSON body
`"GitHub access to this repository is not enabled for this session…"`, and the
request succeeded (302 → codeload 200, authenticated limit 15000/h) once the
SQLite repository was attached. Any environment that cannot reach GitHub
(offline mirrors, corporate proxies, outages, or the 60/h anonymous API limit
on shared CI addresses) fails the same way.

## Reproduce

`github-block-proxy.mjs` logs every proxied CONNECT and refuses GitHub hosts.
`registry.npmjs.org` is reached directly (it is in `NO_PROXY` here), so only
GitHub traffic goes through the proxy.

```bash
UPSTREAM_PROXY="$HTTPS_PROXY" node github-block-proxy.mjs 18080 connect.log &
env -u GITHUB_TOKEN -u GH_TOKEN HTTPS_PROXY=http://127.0.0.1:18080 \
  BUN_INSTALL_CACHE_DIR="$(mktemp -d)" bun install
```

`transcript.txt` has the results: the base commit fails on the GitHub tarball;
this branch installs with an empty cache (16s; 11s in a fresh checkout), and
the wizard's own deployment (`bun run setup --fast … --target dev`, which runs
`bun install` and starts OR3) is healthy 31s after launch. Neither attempts a
GitHub connection.

# Permissions and trust

Ask for only the access required by the requested behavior. Before code or
configuration takes effect, make these facts explicit:

- repository writes, shell commands, package installation, network domains,
  server execution, storage access, deployment, and Git publication;
- plugin grants, trust tier, and isolation requirements;
- whether secrets are required, where they are stored, and that they will not
  be printed, committed, or placed in examples.

`trusted-host` executes in the host JavaScript realm and is not a sandbox.
`isolated-client` and `isolated-server` must fail closed when isolation is
unavailable; neither may silently fall back to trusted-host. Disabling a plugin,
deleting its package, deleting its data, and rolling back its pointer are
separate operations.

# Permissions and trust

Work within the user's requested scope and existing authorization; ask when material access or approval is missing.
Request only grants, network destinations, storage access, and server execution needed for the feature.
Explain consequential deployment, publication, trust, or secret-handling changes when relevant rather than requiring a permission inventory for routine edits.

Keep secrets out of source, examples, logs, and reports.
Preserve explicit approval boundaries for destructive data replacement, provider migrations, and external-runtime credential/network changes.

`trusted-host` executes in the host realm and is not a sandbox.
Isolated execution must fail closed when unavailable and must never silently fall back to trusted-host.
Manifest vocabulary does not establish runtime support; check the host's supported modes.
Disabling a plugin, uninstalling its package, deleting its data, and rolling back a selected version are distinct operations.

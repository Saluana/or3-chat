# Cloud overview

OR3 Cloud adds accounts, shared workspaces, cross-device sync, server-side file storage, and background execution to the local-first app. Your browser still stores workspace data in Dexie and queues local changes while offline. Cloud features require the SSR application; static builds remain local-only.

## Choose a starting point

| Your goal | Start here |
|---|---|
| Run OR3 privately on your machine | [Set up Cloud](/documentation/cloud/setup#run-locally) |
| Host it on a public domain | [Set up Cloud](/documentation/cloud/setup#run-on-a-public-domain) |
| Understand accounts, invitations, and permissions | [Accounts and access](/documentation/cloud/auth-system) |
| Change deployment settings | [Configure OR3](/documentation/cloud/configure) |
| Maintain, back up, or recover an instance | [Operations](/documentation/cloud/deployment-operations) |
| Work on source or choose other backends | [Providers](/documentation/cloud/providers) and [source wizard](/documentation/cloud/or3-cloud-wizard) |

## What is supported by the managed distribution?

The supported managed profile is **Basic Auth + SQLite + filesystem storage**. The `@or3/cloud` CLI installs and operates a versioned container. It creates the required configuration, persistent data volume, and initial credentials; you do not need a source checkout or a hand-written environment file.

Optional Clerk, Convex, S3, custom provider selection, and trusted source extension rebuilds use the advanced source path. They are not choices in managed setup. Remote OR3 Connect is currently **withheld** from managed Cloud; see [Connect status](/documentation/cloud/or3-connect) before attempting an integration.

## How data and identity fit together

An auth provider verifies identity. The selected sync backend stores canonical OR3 users, workspace memberships, and settings, even if sync transfer is disabled. A workspace is the isolation boundary: each browser workspace has its own `or3-db-${workspaceId}` database.

[Sync](/documentation/cloud/sync-layer) transfers records and [storage](/documentation/cloud/storage-layer) transfers binary assets separately. [Background execution](/documentation/cloud/background-execution) lets eligible work continue after a client detaches; [Notifications](/documentation/cloud/notifications) show relevant completion and warning events. These features have their own gates and do not become enabled merely because an account exists.

OpenRouter access is separate from Cloud login. Users connect OpenRouter or supply a key, unless an advanced host configuration provides an instance key. Signing into OR3 alone does not buy or authorize model usage.

Start with [setup and verification](/documentation/cloud/setup), rather than copying a provider configuration fragment.

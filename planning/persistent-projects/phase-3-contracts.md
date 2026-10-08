# Phase 3: permission and preservation contracts

Phase 3 first defines these contracts, as required by R7.AC2. Existing workspace sync and backup already carry project records and their file references. Dedicated project sharing, connections, larger retrieval, and project-only bundles are not enabled by this implementation.

## Permissions

A project remains inside one workspace. Workspace membership is the upper permission bound; project settings cannot grant access. A future project share must explicitly list readers/editors and narrow workspace access. Access checks must apply to knowledge originals, extracted text, revisions, explicit memories, chat passages, handoff evidence, tools, and receipts on every server read and mutation. Revocation invalidates queued jobs and generated download URLs; caches cannot outlive an authorization revision.

No collaborator may retrieve a memory or handoff whose evidence includes a chat they cannot access. A receipt must omit inaccessible identifiers and excerpts. Copying a chat into another project requires an explicit move/copy operation and a new permission evaluation; opening a different pane never transfers authority.

## Connected sources

Connections belong to a user and workspace, with project allowlists for repositories or folders. Credentials stay server-side and are never stored in settings, memories, source records, or receipts. Each imported revision records its origin, retrieval time, content hash, and permission revision. Disconnection prevents refresh and future retrieval; retaining a local copy requires an explicit policy decision shown to the user. Send/publish permissions remain separate from read access and require host execution checks.

## Larger retrieval

Keep the Context Builder as the single admission boundary. A larger index may replace lexical candidate discovery, while required context, source modes, revision identity, access checks, and actual submitted receipts remain unchanged. An indexed match grants no access: reauthorize and read the current permitted revision before including text. Incremental indexing must handle deletion, replacement, exclusion, membership loss, and failed extraction. Measure candidate quality and corpus size against the existing lexical approach before adding embeddings. If embeddings are needed, use OpenRouter exclusively, through OR3’s existing credentials and request handling; do not add another model provider, SDK, or credential system.

## Project bundles

A portable project bundle needs a versioned manifest listing its project, owned chats, native documents, settings, explicit memories, knowledge bindings, every retained original/extraction hash, and handoff evidence. Export must prove all referenced bytes are present before declaring success. Import validates schemas and checksums before mutation, maps project/thread/document IDs consistently, and defaults imported tools to disabled. Tokens, signed URLs, background jobs, live approvals, sync cursors, and recovery checkpoints are never portable authority.

Import into another workspace requires explicit permission to create the project and every underlying item. Shared originals should be content-addressed once but receive independent reference ownership. A failed import must not leave a partially enabled project or lose existing work. Existing full workspace backup remains the supported export/restore path until this contract has its own disposable lifecycle journey.

## Implementation order

1. Add project ACLs and provider capability negotiation; qualify read/write/revocation on SQLite and Convex.
2. Add one connected-source adapter with provenance and permission-aware refresh.
3. Measure larger corpus retrieval; add indexing only if the existing search misses the agreed quality/latency target.
4. Add project bundles with checksum validation, ID remapping, denied-access and interrupted-import qualification.

Release gates must use clean worktrees and published provider versions. These review branches require qualification before any release and must not change production during user testing.

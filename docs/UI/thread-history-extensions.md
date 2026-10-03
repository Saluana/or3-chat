# Source thread history actions

Thread and document history registrations share their lifecycle and handler
pattern. The maintained guide is
[Document and thread history actions](document-history-extensions.md).

The current thread handler receives `{ document: thread }`, matching the
shared registry contract and sidebar caller. It does not receive a guaranteed
`thread` property.

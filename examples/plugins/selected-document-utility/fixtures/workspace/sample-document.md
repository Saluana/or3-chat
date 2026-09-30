The portable client profile keeps plugin code inside an isolated worker. It forbids server routes, native modules, and runtime dependencies on other plugins. An unaware host rejects the package instead of running it in an unsupported mode.

Selected-document utilities only need two host operations. documents.read supplies the current selection, and documents.write carries the derived result back to the editor. Everything else runs locally and deterministically.

This utility is deliberately small. It counts the selection, outlines one leading sentence per paragraph, and renders a short markdown digest. No API key, network call, or background job is involved.

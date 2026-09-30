# Thread tools in chat

Chat can search, read, and post into other conversation threads in the active workspace. The chat registry advertises three client tools:

- `search_threads` queries the existing command palette chat index by title and message text. It returns thread IDs, titles, and matching snippets (plus a message count when known), and it excludes the current chat from results.
- `read_thread` reads the most recent user and assistant messages of a thread by ID. Results are bounded by message count and total characters, keeping the newest turns when the character limit is reached; system and tool messages and deleted messages are omitted. Content is read-only.
- `send_message_to_thread` appends a message to another thread by ID. The message is recorded as a `user` turn by default so the thread can be continued later; pass `role: "assistant"` to leave an assistant note instead. Sending does not generate a reply and cannot target the current chat.

All three tools start enabled in Chat settings, and a saved user choice to disable a tool still takes precedence. Models known not to support tool calls do not receive them. Enabling any client tool makes the chat use foreground streaming for that turn.

Every call is gated to the active workspace: a workspace switch during search, read, or send is refused rather than allowed to cross databases. `send_message_to_thread` re-checks the origin database immediately before writing, and refuses a deleted or missing target thread.

# Delegate a task to another chat

**Goal:** Ask another model to work in a separate, saved chat, wait for its reply, and summarize the outcome. Example: “Ask GPT 6.1 Sol with medium reasoning to review this, then tell me what it found.”

## Behavior

- Add one default-enabled tool accepting a task, optional model and reasoning effort, and optional target thread ID. Create a new chat when no target is supplied; otherwise send a follow-up. Keep the existing append-only tool.
- Resolve model names against the existing catalog; report missing or ambiguous matches. Without a model, inherit the parent request's model and, unless overridden, its reasoning; with a different model and no effort, use that model's default. Validate explicit efforts and report unsupported or unavailable choices without silent substitution.
- Wait for the terminal reply and return its text, actual model/settings, and chat link or ID. The parent summarizes it; the user can open and continue the chat. Label truncated output, and report failures, cancellation, timeouts, and unknown outcomes without presenting partial work as complete.
- While waiting, show a small chat icon and one compact activity line with the model and elapsed time, such as **GPT 6.1 Sol working for 38s**. When the child finishes, freeze the duration and change the line to **GPT 6.1 Sol worked for 1h30m**. Use compact durations (`38s`, `1m22s`, `1h22m`). Once the child exists, the whole line opens it in a new pane, including after completion. Use the parent's existing **Stop** control; show a concise error only if action is needed.

## Implementation

- [x] Register the tool in `app/utils/chat/thread-chat-tools.ts`. Capture parent model/reasoning at request admission, including the background client-tool path. Resolve the model before sending and save it using the existing per-chat preference.
- [x] Create in the captured workspace and originating project. Recheck existing targets, project policy, busy state, and account/workspace authority before writes. Retain a stable execution-to-thread receipt; never automatically repeat an interrupted create or send.
- [x] Reuse native admission, persistence, model requests, tool policy, and terminal results through an independently owned, setup-safe child controller. Do not call `useChat()` from a tool callback or overwrite a composer. Run the child in the originating browser to avoid competing with a parked parent job; disable delegation in child requests to prevent recursion.
- [x] Extend the existing tool activity with a request-scoped child receipt, native status, and elapsed time, and connect the child pane to its live controller. Use an existing themed chat icon and subtle hover/focus states; make the whole line a keyboard-accessible button with an open-chat label once the child exists. Opening it must not stop the parent; clean up timers and observers on completion or cancellation.
- [x] Link cancellation to the parent. Extend the client registry's 10-second limit for this host tool only, and align the background bridge's 30-second claim and parent job lifetime with the wait. Preserve authorization, claim fencing, and at-most-once recovery. Keep the chat on interruption and report uncertainty; normal provider and job limits still apply.
- [x] Update the built-in tool and background execution guides and docmap. Explain the originating browser must remain available. No new queue, migration, or orchestration UI.

## Verification

- [x] Extend canonical chat-tool and send suites for creation, follow-ups, model/effort selection, invalid choices, persisted selection, elapsed time and its completed state, accessible child-pane navigation, failures, cancellation, workspace/project changes, and interrupted or duplicate calls.
- [x] With controlled timers, exercise replies over 30 seconds in foreground and through the background bridge, including claim expiry and result delivery. Verify the parent resumes after a real result and the child remains inspectable. Run targeted Bun/Vitest suites, type checks, and documentation checks.

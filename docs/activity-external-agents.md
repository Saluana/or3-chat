# Activity and external agents

The maintained [Activity and external-agent guide](../public/_documentation/architecture/activity-external-agents.md)
defines subsystem ownership, transport and credential boundaries, connection
setup, transcript behavior, and extension flow.
OpenClaw-specific setup is maintained in the [bridge package](../packages/openclaw-or3/README.md).

## Installed package capabilities

External Agents 0.2 uses the public trusted SDK 2.1 UI, pane, Connect, profile, scoped storage/secret and governed transport clients. The package owns agent staging protocols. Saved origins require one host-owned access prompt. The legacy connection/vault migration is retired after the Cloud 0.1.77 cutover; installations with 0.1.1 data must activate External Agents 0.2.0 on Cloud 0.1.77 before upgrading beyond that cutover. Disable resets Agent panes and retains workspace connection data. Sign-out clears device-local plugin credentials.

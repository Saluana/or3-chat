# Activity and external agents

The maintained [Activity and external-agent guide](../public/_documentation/architecture/activity-external-agents.md)
defines subsystem ownership, transport and credential boundaries, connection
setup, transcript behavior, and extension flow.
OpenClaw-specific setup is maintained in the [bridge package](../packages/openclaw-or3/README.md).

## Installed package capabilities

External Agents 0.2 uses the public trusted SDK 2.1 UI, pane, Connect, profile, scoped storage/secret and governed transport clients. The package owns agent staging protocols. During upgrade, legacy connection and encrypted-vault bytes are copied and verified before originals are removed; saved origins require one host-owned access prompt. Disable resets Agent panes and retains workspace connection data. Sign-out clears device-local plugin credentials.

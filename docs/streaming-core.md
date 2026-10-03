# Chat streaming source owners

The maintained lifecycle guide is
[Chat lifecycle and persistence](../public/_documentation/architecture/chat-lifecycle.md#streaming-stopping-and-teardown).
It covers UI accumulation, durability, cancellation, and view teardown.

Source owners are
[useStreamAccumulator](../app/composables/chat/useStreamAccumulator.ts),
[ChatContainer](../app/components/chat/ChatContainer.vue), and the imported
`or3-scroll` package. The former `VirtualMessageList.vue` and copied
scroll thresholds are not current integration contracts.

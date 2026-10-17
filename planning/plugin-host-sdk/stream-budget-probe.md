# Long-lived stream admission probe

The canonical budget cases in
`shared/plugins/isolation/__tests__/containment-policy.test.ts` exercise the
current `ContainmentBudgetLedger`: oversized messages/results/cumulative
output, call count/concurrency/activation age, and AI spend/output tokens.
`worker-runtime.test.ts` covers termination after a terminal breach. These
current portable-runtime limits apply before a stream adapter is advertised:

- the 120-second activation wall is terminal and blocks an all-day session;
- callback admission remains bounded by concurrency and call-count limits;
- output remains bounded per response and cumulatively;
- AI spend remains cumulative across any future rolling transport window;
- a spend or wall-clock breach is terminal, so revocation cannot be hidden by
  reconnecting.

The future qualified stream profile may roll transport idle/lifetime windows,
but it must retain bounded callback execution, message/output queues, call
counts, AI spend and generation revocation. The duplicate helper-only probe was
retired during the test audit. Real stream delivery, lifetime, backpressure and
revocation qualification remain pending in tasks 5.5–5.8 and 5.10.

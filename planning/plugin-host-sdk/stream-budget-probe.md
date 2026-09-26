# Long-lived stream admission probe

`shared/plugins/isolation/__tests__/long-lived-stream-probe.test.ts` runs the
current `ContainmentBudgetLedger` against an injected clock. The result is
deliberately recorded before a stream adapter is advertised:

- the 120-second activation wall is terminal and blocks an all-day session;
- callback admission remains bounded by concurrency and call-count limits;
- output remains bounded per response and cumulatively;
- AI spend remains cumulative across any future rolling transport window;
- a spend or wall-clock breach is terminal, so revocation cannot be hidden by
  reconnecting.

The future qualified stream profile may roll transport idle/lifetime windows,
but it must retain bounded callback execution, message/output queues, call
counts, AI spend and generation revocation. The probe is the regression gate
for changing those limits; it does not silently relax the current portable
profile.

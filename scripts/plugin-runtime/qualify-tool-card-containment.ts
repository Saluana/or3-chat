import { spawnSync } from "node:child_process";
const engineIndex = process.argv.indexOf("--engine");
const engine = engineIndex < 0 ? "chromium" : process.argv[engineIndex + 1];
const grepIndex = process.argv.indexOf("--grep");
const grep = grepIndex < 0 ? undefined : process.argv[grepIndex + 1];
if (grepIndex >= 0 && !grep) throw new Error("--grep requires a probe pattern");
if (!["chromium", "firefox", "webkit", "mobile-safari"].includes(engine ?? ""))
  throw new Error("Unknown engine");
if (process.argv.includes("--dry-run")) {
  console.log(
    "Tool-card frame probes: " +
      engine +
      "; exact runtime bindings; failed or inconclusive evidence stays gated",
  );
} else {
  const result = spawnSync(
    "bunx",
    [
      "playwright",
      "test",
      "--config",
      "playwright.containment.config.ts",
      "--project",
      engine!,
      ...(grep ? ["--grep", grep] : []),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        OR3_CARD_PROBE_RUN_ID: crypto.randomUUID(),
        OR3_CONTAINMENT_TARGET: "tool-card-frame",
        ...(grep ? { OR3_CARD_PROBE_GREP: grep } : {}),
        OR3_TOOL_CARDS_TEST_HARNESS: "true",
        OR3_PLUGIN_CONTRIBUTION_V2_SURFACES: "chat-tool-cards",
      },
    },
  );
  process.exitCode = result.status ?? 1;
}

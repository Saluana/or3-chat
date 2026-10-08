import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { packV2Package } from "../../packages/plugin-sdk/src/cli/pack";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  CONTAINED_VIEW_RELAY_SOURCE,
  CONTAINED_VIEW_SCRIPT_HASH,
} from "../../shared/plugins/isolation/contained-view-document";
import { containedViewCsp } from "../../shared/plugins/isolation/contained-view-policy";
const channels = [
  "parent.access",
  "top.access",
  "storage.local",
  "storage.session",
  "storage.cookie",
  "storage.indexedDB",
  "network.fetch",
  "network.xhr",
  "network.websocket",
  "network.eventsource",
  "network.beacon",
  "network.webrtc",
  "workers.nested",
  "imports.remote",
  "embed.image",
  "embed.frame",
  "realm.about-blank",
  "navigation.location",
  "navigation.anchor",
  "navigation.meta",
  "navigation.document-open",
  "forms.submit",
  "popups.open",
  "hints.prefetch",
  "hints.preload",
  "hints.dns",
  "activation.send",
  "protocol.flood",
  "activation.openLink",
];
const source = readFileSync(
  "tests/plugin-runtime/fixtures/tool-card-probes/probe.mjs",
  "utf8",
);
const hits = new Map<string, number>();
let udpHits = 0;
let target = "";
let stun = "";
const runId = (process.env.OR3_CARD_PROBE_RUN_ID ?? randomUUID()).replace(
  /[^a-zA-Z0-9_-]/g,
  "_",
);
let journal = "";
let receiptPath = "";
let probeArtifact: Awaited<ReturnType<typeof packV2Package>>;
const probeRoot = "tests/plugin-runtime/fixtures/tool-card-probes";
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const key =
    url.searchParams.get("context") + ":" + url.searchParams.get("probe");
  hits.set(key, (hits.get(key) ?? 0) + 1);
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.searchParams.get("probe") === "network.eventsource") {
    res.setHeader("Content-Type", "text/event-stream");
    res.end("data: probe\n\n");
  } else if (url.searchParams.get("probe") === "embed.image") {
    res.setHeader("Content-Type", "image/gif");
    res.end(
      Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    );
  } else {
    res.setHeader("Content-Type", "text/javascript");
    res.end("export default 1;");
  }
});
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const key =
    url.searchParams.get("context") + ":" + url.searchParams.get("probe");
  hits.set(key, (hits.get(key) ?? 0) + 1);
  const accept = createHash("sha1")
    .update(
      String(req.headers["sec-websocket-key"]) +
        "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n",
  );
  setTimeout(() => socket.destroy(), 200);
});
const udp = createSocket("udp4");
udp.on("message", () => udpHits++);
test.beforeAll(async ({}, info) => {
  const project = info.project.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  const output = join("test-results/tool-card-containment", runId, project);
  mkdirSync(output, { recursive: true });
  journal = join(output, "probes.jsonl");
  receiptPath = join(
    "tests/plugin-runtime/evidence/tool-card-frame",
    runId,
    project + ".json",
  );
  probeArtifact = await packV2Package(probeRoot, {
    outputDirectory: join(output, "package"),
    archivePath: join(output, "probes.zip"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  target = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  stun = "stun:127.0.0.1:" + udp.address().port;
  expect(CONTAINED_VIEW_SCRIPT_HASH).toBe(
    "sha256-" +
      createHash("sha256").update(CONTAINED_VIEW_RELAY_SOURCE).digest("base64"),
  );
});
test.afterAll(async ({ browser, browserName }, info) => {
  mkdirSync(join("tests/plugin-runtime/evidence/tool-card-frame", runId), {
    recursive: true,
  });
  writeFileSync(
    receiptPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        project: info.project.name,
        profile: "or3-contained-view-v1",
        feature: "or3-tool-card-frame-v1",
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        hostCommit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        runtimeVersion: "or3-contained-view-v1",
        runtimeSha256: createHash("sha256")
          .update(CONTAINED_VIEW_RELAY_SOURCE)
          .digest("hex"),
        policy: containedViewCsp(),
        probeTreeSha256:
          "sha256-" + createHash("sha256").update(source).digest("hex"),
        archiveSha256:
          "sha256-" +
          createHash("sha256")
            .update(readFileSync(probeArtifact.archivePath!))
            .digest("hex"),
        archivePath: probeArtifact.archivePath,
        packageTreeDigest: probeArtifact.verification.digest,
        runtimeFiles: Object.fromEntries(
          [
            "shared/plugins/isolation/contained-view-document.ts",
            "shared/plugins/isolation/contained-view-policy.ts",
            "shared/plugins/isolation/tool-card-protocol.ts",
            "app/components/chat/tool-cards/ToolCardFrameHost.vue",
            "app/components/chat/tool-cards/ToolCardSlot.vue",
          ].map((path) => [
            path,
            "sha256-" +
              createHash("sha256").update(readFileSync(path)).digest("hex"),
          ]),
        ),
        browser: browserName,
        browserVersion: browser.version(),
        device: {
          userAgent: info.project.use.userAgent ?? null,
          viewport: info.project.use.viewport ?? null,
          deviceScaleFactor: info.project.use.deviceScaleFactor ?? null,
          isMobile: info.project.use.isMobile ?? false,
          hasTouch: info.project.use.hasTouch ?? false,
        },
        platform: process.platform,
        command:
          "bun run plugin-runtime:containment:qualify --target tool-card-frame --engine " +
          info.project.name +
          (process.env.OR3_CARD_PROBE_GREP
            ? " --grep '" +
              process.env.OR3_CARD_PROBE_GREP.replace(/'/g, "'\\''") +
              "'"
            : ""),
        timestamp: new Date().toISOString(),
        qualification: "blocked",
        probeSelection: {
          expected: channels.length,
          grep: process.env.OR3_CARD_PROBE_GREP ?? null,
        },
        bindingGaps: [
          "The exact packed adversarial archive is bound, but it is injected through the development fixture rather than production admission. Card grants remain unqualified.",
          "DNS hints require observable DNS evidence; HTTP request absence alone is inconclusive.",
        ],
        probes: existsSync(journal)
          ? readFileSync(journal, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [],
      },
      null,
      2,
    ) + "\n",
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  udp.close();
});
for (const channel of channels)
  test(channel, async ({ page, browserName }, info) => {
    test.setTimeout(30000);
    await page.route("**openrouter.ai/**", (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.goto("/__or3-tool-cards-test?scenario=quiz");
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    // The same publisher module is executable in an uncontained, host-origin negative control.
    const beforeUdp = udpHits;
    await page.evaluate(
      ({ source, args }) => {
        const frame = document.createElement("iframe");
        frame.id = "control";
        document.body.append(frame);
        const realm = frame.contentWindow!;
        const mount = realm.Function(
          source.replace("export default", "const module =") +
            ";return module;",
        )();
        const card = {
          args,
          signal: new AbortController().signal,
          setState: async () => ({ ok: true }),
          send: async () => ({ ok: true }),
          openLink: async () => ({ ok: true }),
        };
        mount.mount(frame.contentDocument!.body, card);
      },
      { source, args: { channel, target, stun, context: "control" } },
    );
    const control = page.frameLocator("#control");
    if (!channel.startsWith("activation."))
      await control.getByRole("button", { name: "Run probe" }).click();
    await page.waitForTimeout(channel.startsWith("activation.") ? 8000 : 1600);
    const network =
      /^(network\.(fetch|xhr|websocket|eventsource|beacon)|imports\.remote|embed\.|navigation\.|forms\.|popups\.|hints\.)/.test(
        channel,
      );
    const rtc = channel === "network.webrtc" || channel === "realm.about-blank";
    const controlOutput = await control
      .locator("[data-probe-result]")
      .textContent({ timeout: 500 })
      .catch(() => null);
    const reachable = rtc
      ? udpHits > beforeUdp
      : network
        ? (hits.get("control:" + channel) ?? 0) > 0
        : controlOutput?.includes('"resolved":true') === true;
    const containedUdp = udpHits;
    await page.route(
      "**/api/plugins/packages/or3.tool-card-fixture/**",
      (route) =>
        route.fulfill({ contentType: "text/javascript", body: source }),
    );
    await page.goto(
      "/__or3-tool-cards-test?scenario=probe&" +
        new URLSearchParams({ channel, target, stun }),
    );
    const frame = page.frameLocator('iframe[title="Frame fixture"]');
    await frame.getByRole("button", { name: "Run probe" }).waitFor();
    if (!channel.startsWith("activation."))
      await frame.getByRole("button", { name: "Run probe" }).click();
    await page.waitForTimeout(channel.startsWith("activation.") ? 8000 : 1600);
    const output = await frame
      .locator("[data-probe-result]")
      .textContent({ timeout: 500 })
      .catch(() => null);
    const escaped = rtc
      ? udpHits > containedUdp
      : network
        ? (hits.get("contained:" + channel) ?? 0) > 0
        : channel.startsWith("activation.")
          ? output?.includes('"action":true') === true
          : output?.includes('"resolved":true') === true;
    const outcome =
      !reachable || channel === "hints.dns"
        ? "inconclusive"
        : escaped
          ? "reachable"
          : "blocked";
    const result = {
      runId,
      project: info.project.name,
      browser: browserName,
      channel,
      control: reachable ? "reachable" : "inconclusive",
      outcome,
      output,
      context:
        "production ToolCardFrameHost with the exact contained-view document",
      outputPath: join(info.outputDir, "probe.json"),
      targetHits: hits.get("contained:" + channel) ?? 0,
      udpHits: udpHits - containedUdp,
    };
    mkdirSync(info.outputDir, { recursive: true });
    writeFileSync(result.outputPath, JSON.stringify(result, null, 2) + "\n");
    appendFileSync(journal, JSON.stringify(result) + "\n");
    expect(
      outcome,
      channel +
        " must have a reachable control and a denied contained operation",
    ).toBe("blocked");
  });

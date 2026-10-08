import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
test.setTimeout(90000);
const evidence = "test-results/tool-cards";
const results: unknown[] = [];
const sse = (delta: unknown, finish: string | null = null) =>
  "data: " +
  JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }) +
  "\n\n";
async function scripted(page: Page) {
  await page.route("**openrouter.ai/**", async (route) => {
    if (!route.request().url().includes("/chat/completions")) {
      await route.fulfill({ json: { data: [] } });
      return;
    }
    const body = route.request().postDataJSON();
    expect(JSON.stringify(body)).not.toContain("card_origin");
    expect(JSON.stringify(body)).not.toContain("tool_cards");
    const messages = body.messages ?? [];
    const last = messages.at(-1);
    const text =
      typeof last?.content === "string"
        ? last.content
        : JSON.stringify(last?.content);
    let data: string;
    if (last?.role !== "tool" && text?.includes("Quiz please"))
      data =
        sse({ role: "assistant", content: "Question before card. " }) +
        sse({
          tool_calls: [
            {
              index: 0,
              id: "quiz-live",
              type: "function",
              function: {
                name: "quiz_ask",
                arguments: JSON.stringify({
                  question: "Capital of France?",
                  choices: ["Paris", "Rome"],
                }),
              },
            },
          ],
        }) +
        sse({}, "tool_calls");
    else
      data =
        sse({
          role: "assistant",
          content: text?.includes("My answer:")
            ? "Correct! Paris is the capital."
            : "Pick an answer above.",
        }) + sse({}, "stop");
    await route.fulfill({
      contentType: "text/event-stream",
      body: data + "data: [DONE]\n\n",
    });
  });
  await page.route("**www.openstreetmap.org/export/embed.html**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Interactive map fixture</p>",
    }),
  );
}
async function open(page: Page, scenario: string) {
  await scripted(page);
  await page.goto("/__or3-tool-cards-test?scenario=" + scenario);
  await expect(
    page.getByRole("textbox", { name: "Message input" }),
  ).toBeVisible({
    timeout: 60000,
  });
}
test.afterEach(async ({ page }, info) => {
  results.push({
    case: info.title,
    status: info.status,
    durationMs: info.duration,
    mounts: await page
      .locator("[data-card-mount-ms]")
      .evaluateAll((elements) =>
        elements.map((el) => ({
          tool: el.getAttribute("data-tool-card"),
          durationMs: Number(el.getAttribute("data-card-mount-ms")),
        })),
      )
      .catch(() => []),
    browser: page.context().browser()?.version(),
  });
});
test.afterAll(() => {
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    evidence + "/receipt.json",
    JSON.stringify(
      {
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        command: "bun run test:e2e:tool-cards",
        timestamp: new Date().toISOString(),
        cases: results,
      },
      null,
      2,
    ),
  );
});
test("quiz executes inline, sends an attributed answer, and persists the locked state across reload", async ({
  page,
}) => {
  await open(page, "quiz");
  await page
    .getByRole("textbox", { name: "Message input" })
    .fill("Quiz please");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const card = page.getByRole("group", { name: "Quiz", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Capital of France?");
  await expect(
    page.getByText("Pick an answer above.", { exact: false }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Paris", exact: true }).click();
  await expect(page.locator("[data-card-origin]")).toHaveText("via Quiz");
  await expect(
    page
      .locator("[data-msg-id]")
      .filter({ hasText: "Correct! Paris is the capital." }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Paris", exact: true }),
  ).toBeDisabled();
  await expect(card.getByRole("status")).toHaveText("Answer saved");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(
    card.getByRole("button", { name: "Paris", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page
      .getByRole("group", { name: "Quiz", exact: true })
      .getByRole("button", { name: "Paris", exact: true }),
  ).toBeDisabled({ timeout: 60000 });
});
test("quiz weather and map rehydrate in light and dark mode and fit 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await open(page, "examples");
  for (const label of ["Quiz", "Weather", "Map"])
    await expect(
      page.getByRole("group", { name: label, exact: true }),
    ).toBeVisible();
  await expect(page.locator('[data-tool-card="weather_show"]')).toHaveAttribute(
    "data-card-chrome",
    "none",
  );
  await page
    .locator('[data-tool-card="weather_show"]')
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("list", { name: "Seven day forecast" }).locator("li"),
  ).toHaveCount(7);
  for (const mode of ["light", "dark"]) {
    if (mode === "dark")
      await page.getByRole("button", { name: "Toggle theme" }).click();
    for (const label of ["Quiz", "Weather", "Map"]) {
      const card = page.getByRole("group", { name: label, exact: true });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: evidence + "/" + label.toLowerCase() + "-" + mode + ".png",
        animations: "disabled",
        style:
          '.chat-input-wrapper, button[aria-label="Scroll to bottom"], nuxt-devtools-frame, #nuxt-devtools-container { visibility: hidden !important; }',
      });
    }
    await page.screenshot({
      path: evidence + "/examples-" + mode + ".png",
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("saved card state survives virtualization and receives persisted updates", async ({
  page,
}) => {
  await open(page, "scroll");
  const card = page.locator('[data-msg-id="scroll-0"]').first();
  await page.locator(".chat-message-list").hover();
  await page.mouse.wheel(0, -20000);
  await card.getByRole("button", { name: "A", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Answer saved");
  await page.locator(".chat-message-list").hover();
  await page.mouse.wheel(0, 20000);
  await expect(card).toHaveCount(0);
  await page.mouse.wheel(0, -20000);
  await expect(
    card.getByRole("button", { name: "A", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reset saved quiz" }).click();
  await expect(
    card.getByRole("button", { name: "A", exact: true }),
  ).toBeEnabled();
});

test("card saves stay ordered across panes while preparation is delayed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await scripted(page);
  await page.goto("/__or3-tool-cards-test?scenario=state-cross-pane");
  const first = page.locator('[data-state-pane="primary"]');
  const second = page.locator('[data-state-pane="secondary"]');
  await first.getByRole("button", { name: "Save earlier" }).click();
  await expect(page.locator("[data-save-barrier]")).toHaveText("blocked");
  await second.getByRole("button", { name: "Save later" }).click();
  // Let the second pane's debounce expire while the first write is blocked.
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Release state save" }).click();
  await expect(first.locator('[data-state-save="earlier"]')).toHaveText(
    "saved",
  );
  await expect(second.locator('[data-state-save="later"]')).toHaveText("saved");
  await expect(page.locator("[data-saved-state]")).toHaveText('"later"');
  await expect(first.locator("[data-current-state]")).toHaveText('"later"');
  await expect(second.locator("[data-current-state]")).toHaveText('"later"');
  await page.screenshot({ path: evidence + "/state-cross-pane.png" });
});

for (const source of ["remote", "normalized"]) {
  test(`card save completion preserves ${source} persisted state`, async ({
    page,
  }) => {
    await open(page, "state-" + source);
    const card = page.getByRole("group", { name: "State persistence" });
    await card.getByRole("button", { name: "Save earlier" }).click();
    await expect(page.locator("[data-save-barrier]")).toHaveText("blocked");
    if (source === "remote")
      await page.getByRole("button", { name: "Apply persisted state" }).click();
    await expect(page.locator("[data-saved-state]")).toHaveText(
      JSON.stringify(source),
    );
    // Allow the mounted slot to observe the same committed Dexie update.
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Release state save" }).click();
    await expect(card.locator('[data-state-save="earlier"]')).toHaveText(
      "saved",
    );
    await expect(card.locator("[data-current-state]")).toHaveText(
      JSON.stringify(source),
    );
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(card.locator("[data-current-state]")).toHaveText(
      JSON.stringify(source),
    );
    await page.screenshot({ path: evidence + "/state-" + source + ".png" });
  });
}

test("offscreen preloads preserve visible frames and resume when capacity frees", async ({
  page,
}) => {
  await scripted(page);
  await page.route(
    "**/api/plugins/packages/or3.tool-card-fixture/**",
    async (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: (await page.locator("[data-frame-module]").textContent()) || "",
      }),
  );
  await page.goto("/__or3-tool-cards-test?scenario=frame-budget");
  await expect(page.locator('iframe[title="Budget 12"]')).toHaveCount(1);
  await expect(page.locator('iframe[title="Budget 1"]')).toHaveCount(1);
  await expect(page.locator('iframe[title="Budget 13"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Release first frame" }).click();
  await expect(page.locator('iframe[title="Budget 13"]')).toHaveCount(1);
  await expect(page.locator("iframe")).toHaveCount(12);
});
test("legacy placement, crashing card fallback and timer sends stay isolated", async ({
  page,
}) => {
  await open(page, "layout");
  await expect(
    page.getByRole("group", { name: "End card", exact: true }),
  ).toContainText("End placed card");
  await expect(
    page.getByText("Broken plugin card unavailable (mount-error)", {
      exact: true,
    }),
  ).toBeVisible();
  await page.waitForTimeout(7500);
  await expect(page.locator("[data-guard-result]")).toContainText(
    "no-user-activation",
  );
  await expect(page.locator("[data-card-origin]")).toHaveCount(0);
  const ordered = await page
    .locator("[data-msg-id]")
    .first()
    .evaluate((el) => {
      const text = el.textContent ?? "";
      return (
        text.indexOf("Message body after tools.") <
        text.indexOf("End placed card")
      );
    });
  expect(ordered).toBe(true);
});
test("always cards receive persisted status updates", async ({ page }) => {
  await open(page, "always");
  await expect(
    page.getByRole("group", { name: "Always card", exact: true }),
  ).toContainText("Status: running");
  await page.getByRole("button", { name: "Complete fixture call" }).click();
  await expect(
    page.getByRole("group", { name: "Always card", exact: true }),
  ).toContainText("Status: complete");
});
test("trusted Vue card uses the SDK adapter and is removed on activation teardown", async ({
  page,
}) => {
  await open(page, "trusted");
  await expect(
    page.getByRole("group", { name: "Trusted weather", exact: true }),
  ).toContainText("Paris, France");
  await expect(
    page.getByRole("button", { name: "Trusted kit answer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update fixture plugin" }).click();
  await expect(
    page.getByRole("button", { name: "Trusted kit answer", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-trusted-cleanups]")).toHaveText("1");
  await page.getByRole("button", { name: "Disable fixture plugin" }).click();
  await expect(page.locator("[data-trusted-cleanups]")).toHaveText("2");
  await expect(page.locator('[data-tool-card="fixture_trusted"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-msg-id="fixture-message"]').first(),
  ).toContainText("Message body after tools.");
});
test("lazy cards mount during scrolling without rerunning their tools", async ({
  page,
}) => {
  await open(page, "scroll");
  await expect(
    page.locator('[data-tool-card="quiz_ask"]').first(),
  ).toBeVisible();
  const count = await page.locator("[data-card-receipt]").textContent();
  expect(JSON.parse(count || "[]").length).toBeLessThan(30);
  const scrollStart = performance.now();
  await page.locator(".chat-message-list").hover();
  await page.mouse.wheel(0, -10000);
  await expect(page.getByText("Question 0", { exact: true })).toBeVisible();
  results.push({
    case: "30-card scroll",
    durationMs: performance.now() - scrollStart,
    initialMounted: JSON.parse(count || "[]").length,
    finalMounted: JSON.parse(
      (await page.locator("[data-card-receipt]").textContent()) || "[]",
    ).length,
  });
});
test("verified frame mounts, resizes and receives live theme changes", async ({
  page,
}) => {
  await scripted(page);
  let source = "";
  await page.route(
    "**/api/plugins/packages/or3.tool-card-fixture/**",
    async (route) => {
      source = (await page.locator("[data-frame-module]").textContent()) ?? "";
      await route.fulfill({
        contentType: "text/javascript",
        body: source,
      });
    },
  );
  await page.goto("/__or3-tool-cards-test?scenario=frame");
  const frame = page.frameLocator('iframe[title="Frame fixture"]');
  await expect(frame.getByRole("button", { name: "Frame answer" })).toBeVisible(
    {
      timeout: 60000,
    },
  );
  await expect(frame.getByText("light", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(frame.getByText("dark", { exact: true })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(
    frame.getByRole("button", { name: "Frame answer" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Frame answer" }).click();
  await expect(page.locator("[data-card-origin]")).toHaveText(
    "via Frame fixture",
  );
  await frame.getByRole("button", { name: "Navigate frame" }).click();
  await expect(
    page.getByText("Frame fixture card unavailable (frame-navigated)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('iframe[title="Frame fixture"]')).toHaveCount(0);
});

test("SDK vanilla, Vue and React helpers update, record actions and clean up once", async ({
  page,
}) => {
  await open(page, "helpers");
  for (const kind of ["vanilla", "vue", "react"])
    await expect(
      page.locator('[data-helper="' + kind + '"]').first(),
    ).toHaveText("initial");
  await page.getByRole("button", { name: "Update SDK harness" }).click();
  for (const kind of ["vanilla", "vue", "react"])
    await expect(
      page.locator('[data-helper="' + kind + '"]').first(),
    ).toHaveText("updated");
  await page.getByRole("button", { name: "Dispose SDK harness" }).click();
  await expect(page.locator("[data-helper-receipt]")).toContainText(
    '"cleanups":[1,1,1]',
  );
  await expect(page.locator("[data-helper-receipt]")).toContainText(
    '"aborted":[true,true,true]',
  );
  await expect(page.locator("[data-helper-receipt]")).toContainText(
    '"send":["answer"]',
  );
});

test("card actions reject invalid state, text and links and enforce send cooldown", async ({
  page,
}) => {
  await open(page, "layout");
  const card = page.getByRole("group", { name: "Guards", exact: true });
  const output = card.locator("[data-guard-result]");
  for (const [label, code] of [
    ["Oversized state", "quota-exceeded"],
    ["Invalid state", "invalid-input"],
    ["Send empty", "invalid-input"],
    ["Invalid link", "invalid-input"],
  ]) {
    await card.getByRole("button", { name: label, exact: true }).click();
    await expect(output).toContainText('"code":"' + code + '"');
  }
  await expect(page.locator("[data-card-origin]")).toHaveCount(0);
  await card.getByRole("button", { name: "Send twice", exact: true }).click();
  await expect(output).toContainText('"ok":true');
  await expect(output).toContainText('"code":"quota-exceeded"');
  await expect(page.locator("[data-card-origin]")).toHaveCount(1);
});

test("busy chat refuses a card send before reserving its cooldown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await open(page, "layout");
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/chat/completions", async (route) => {
    await pending;
    await route
      .fulfill({
        contentType: "text/event-stream",
        body:
          sse({ role: "assistant", content: "Busy stream finished" }, "stop") +
          "data: [DONE]\n\n",
      })
      .catch(() => {});
  });
  try {
    await page
      .getByRole("textbox", { name: "Message input" })
      .fill("Busy stream");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop", exact: false }).first(),
    ).toBeVisible();
    const card = page.getByRole("group", { name: "Guards", exact: true });
    await card.getByRole("button", { name: "Send twice", exact: true }).click();
    await expect(card.locator("[data-guard-result]")).toContainText(
      "chat-busy",
    );
    await expect(page.locator("[data-card-origin]")).toHaveCount(0);
  } finally {
    release();
  }
});

test("30 frame cards obey the per-pane cap and resume as the chat scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 3000 });
  await scripted(page);
  await page.route(
    "**/api/plugins/packages/or3.tool-card-fixture/**",
    async (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: (await page.locator("[data-frame-module]").textContent()) || "",
      }),
  );
  await page.goto("/__or3-tool-cards-test?scenario=frame-scroll");
  await expect(
    page.locator('[data-card-frame-mounted="true"]').first(),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  const initial = await page.locator('iframe[title="Frame fixture"]').count();
  expect(initial).toBeLessThanOrEqual(12);
  await page.locator(".chat-message-list").hover();
  await page.mouse.wheel(0, -10000);
  await expect(
    page
      .locator('[data-msg-id="scroll-0"]')
      .first()
      .frameLocator("iframe")
      .getByRole("button", { name: "Frame answer" }),
  ).toBeVisible();
  const final = await page.locator('iframe[title="Frame fixture"]').count();
  expect(final).toBeLessThanOrEqual(12);
  results.push({
    case: "30-frame scroll",
    initialFrames: initial,
    finalFrames: final,
    cap: 12,
  });
});

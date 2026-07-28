import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputDir = resolve("output/playwright/agents-after");
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await mkdir(outputDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    console.error(`[agent-visual pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[agent-visual console] ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    console.error(
      `[agent-visual requestfailed] ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
});

async function openHarness(page: Page, url: string) {
  await page.goto(url);
  try {
    await expect(page.getByTestId("ready")).toHaveText("ready", {
      timeout: 15_000,
    });
  } catch {
    await page.reload();
    await expect(page.getByTestId("ready")).toHaveText("ready", {
      timeout: 30_000,
    });
  }
}

for (const state of [
  "empty",
  "new",
  "running",
  "approval",
  "completed",
  "failed",
] as const) {
  test(`captures ${state} agent state`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await openHarness(page, `/__or3-agent-visual-test?state=${state}`);
      await expect(page.locator(".agent-visual-shell")).toHaveCSS(
        "display",
        "grid",
      );
      expect(
        await page.locator(".agent-visual-shell").evaluate((element) => ({
          columns: getComputedStyle(element).gridTemplateColumns,
          width: element.getBoundingClientRect().width,
        })),
      ).toMatchObject({ columns: "352px 1088px", width: 1440 });
      await expect(page.getByRole("main").first()).toBeVisible();
    await page.screenshot({
      path: resolve(outputDir, `agents-${state}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("captures narrow completed conversation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHarness(page, "/__or3-agent-visual-test?state=completed");
  await page.screenshot({
    path: resolve(outputDir, "agents-mobile-completed.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("captures dark completed conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await openHarness(
    page,
    "/__or3-agent-visual-test?state=completed&theme=dark",
  );
  await page.screenshot({
    path: resolve(outputDir, "agents-dark-completed.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("does not expose provider transport details", async ({ page }) => {
  await openHarness(page, "/__or3-agent-visual-test?state=failed");
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("provider.example");
  expect(body).not.toContain("responseHeaders");
  expect(body).not.toContain("set-cookie");
  expect(body).not.toContain("session_id");
  expect(body).not.toContain("job_id");
});

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { skipOnboarding } from "./helpers";

test.use({ serviceWorkers: "allow" });

async function waitForShellCached(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<{ cached: number; total: number }>((resolve) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = (e) => resolve(e.data);
              navigator.serviceWorker.controller?.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
            }),
        ),
      { timeout: 30_000 },
    )
    .toMatchObject({ cached: expect.any(Number) });
  const status = await page.evaluate(
    () =>
      new Promise<{ cached: number; total: number }>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(e.data);
        navigator.serviceWorker.controller?.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
      }),
  );
  expect(status.total).toBeGreaterThan(10);
  expect(status.cached).toBe(status.total);
}

test("offline launch after the app shell has been cached", async ({ page, context }) => {
  await skipOnboarding(page);
  await page.goto("/");
  await waitForShellCached(page);
  await expect(page.getByText("Ready offline")).toBeVisible();

  await context.setOffline(true);
  await page.goto("/studio/?instrument=particle-bloom");
  await expect(page.getByRole("heading", { name: /particle bloom studio/i })).toBeAttached();
  await expect(page.locator("main canvas")).toBeVisible();

  // Client-side navigation works offline too.
  await page.goto("/instruments/");
  await page.getByRole("link", { name: "Cosmic Garden" }).click();
  await expect(page.getByRole("heading", { name: /cosmic garden studio/i })).toBeAttached();

  // Camera tracking honestly reports that it isn't available offline yet.
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText(/not available offline yet|couldn't download/i)).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});

test("application update waits for consent and keeps unsaved work", async ({ page }) => {
  const manifestPath = join(process.cwd(), "out", "sw-manifest.js");
  const original = readFileSync(manifestPath, "utf8");
  try {
    await skipOnboarding(page);
    await page.goto("/studio/?instrument=inkflow");
    await waitForShellCached(page);

    // Publish a "new version" and let the page discover it.
    writeFileSync(manifestPath, original.replace(/"version":"([^"]+)"/, '"version":"$1-next"'));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(page.getByText("A new version of Aura is ready.")).toBeVisible({ timeout: 30_000 });

    // Make some unsaved work, then accept the update.
    const stage = page.getByLabel(/canvas\. drag to play/i);
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 260, { steps: 20 });
    await page.mouse.up();

    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Update" }).click()]);
    const version = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(e.data.version);
          navigator.serviceWorker.controller?.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
        }),
    );
    expect(version).toMatch(/-next$/);
    // The unsaved session was preserved as a recovery draft.
    await page.goto("/studio/");
    await expect(page.getByRole("heading", { name: /pick up where you left off/i })).toBeVisible();
  } finally {
    writeFileSync(manifestPath, original);
  }
});

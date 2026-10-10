import { expect, test } from "@playwright/test";
import { skipOnboarding } from "./helpers";

/**
 * Runs the real camera + MediaPipe pipeline with Chromium's fake camera.
 * Requires network access to download the model (skip with AURA_E2E_OFFLINE=1).
 * The fake feed contains no hands, so we assert the pipeline reaches the
 * running state and reports "Show your hands", and that stopping releases
 * the camera.
 */
test.skip(!!process.env.AURA_E2E_OFFLINE, "needs network to download the hand model");

test("hand tracking starts, runs and releases the camera", async ({ page }) => {
  test.setTimeout(180_000);
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=aurora&debug=1");
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText("Show your hands", { exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("button", { name: "Camera on" })).toHaveAttribute("aria-pressed", "true");
  // Inference must run in the worker so rendering isn't blocked.
  await expect(page.getByText(/inference \d+(\.\d)? ms \(worker\)/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  const fps = Number((await page.getByText(/\d+ fps/).textContent())?.split(" ")[0]);
  expect(fps).toBeGreaterThan(20);

  const liveTracks = () => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.getVideoTracks().filter((t) => t.readyState === "live").length ?? 0);
  expect(await liveTracks()).toBe(1);

  await page.getByRole("button", { name: "Camera on" }).click();
  await expect(page.getByText("Show your hands", { exact: true })).toHaveCount(0);
  expect(await liveTracks()).toBe(0);
});

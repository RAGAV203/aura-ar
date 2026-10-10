import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/welcome/", "/instruments/", "/creations/", "/settings/", "/privacy/", "/studio/?instrument=cosmic-garden"];

/** Collects React hydration / recoverable errors reported to the console. */
function watchHydration(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /hydrat|didn't match|did not match|Minified React error #(418|423|425)/i.test(text)) problems.push(text.slice(0, 300));
  });
  page.on("pageerror", (error) => {
    if (/hydrat|#418|#423|#425/i.test(error.message)) problems.push(error.message.slice(0, 300));
  });
  return problems;
}

for (const returning of [false, true]) {
  test(`prerendered pages hydrate without mismatches (${returning ? "returning" : "first"} visit)`, async ({ page }) => {
    if (returning) {
      // Saved preferences change client output; the server never sees them.
      await page.addInitScript(() =>
        localStorage.setItem("aura.settings.v1", JSON.stringify({ onboardingComplete: true, touchOnly: true, reducedMotion: "on", lastInstrument: "inkflow" })),
      );
    }
    const problems = watchHydration(page);
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
    }
    expect(problems).toEqual([]);
  });
}

test("instrument cards show live 3D previews, not the fallback, where WebGL works", async ({ page }) => {
  await page.goto("/instruments/");
  const card = page.getByRole("article").filter({ hasText: "Cosmic Garden" });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("3D preview unavailable on this device")).toHaveCount(0);
  await expect(card.locator("canvas")).toBeAttached();
});

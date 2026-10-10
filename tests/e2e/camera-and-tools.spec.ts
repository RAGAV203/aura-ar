import { expect, test, type Locator, type Page } from "@playwright/test";
import { canvasBrightness, drawStroke, skipOnboarding } from "./helpers";

/** Segmented options are labelled radios; people click the visible label. */
async function pick(scope: Locator, label: string) {
  await scope.locator("label").filter({ hasText: new RegExp(`^${label}$`) }).click();
  await expect(scope.getByRole("radio", { name: label })).toBeChecked();
}

async function openTools(page: Page) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  return page.getByRole("dialog", { name: "Tools" });
}

test.describe("camera backdrop", () => {
  test.skip(!!process.env.AURA_E2E_OFFLINE, "needs network to download the hand model");
  // The first camera start downloads ~18 MB of model data; allow for slow networks.
  test.setTimeout(180_000);

  test("the live camera fills the view behind the artwork, with the skeleton overlay", async ({ page }) => {
    await skipOnboarding(page);
    await page.goto("/studio/?instrument=string-harp");
    await page.getByRole("button", { name: "Camera", exact: true }).click();
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(page.getByText("Show your hands", { exact: true })).toBeVisible({ timeout: 150_000 });

    const video = page.locator("video");
    const viewport = page.viewportSize()!;
    await expect.poll(async () => (await video.boundingBox())?.width ?? 0).toBeGreaterThan(viewport.width * 0.95);
    const style = await video.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform, z: getComputedStyle(el).zIndex }));
    expect(Number(style.opacity)).toBeCloseTo(0.6, 1);
    expect(style.transform).toContain("matrix(-1"); // mirrored like a mirror
    // The artwork layer is transparent so the camera shows through.
    const stageBackground = await page.getByRole("img", { name: /string harp artwork/i }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(stageBackground).toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator("canvas[aria-hidden='true']")).toBeAttached(); // hand skeleton layer

    // Turning the backdrop off returns to the small self-view.
    const tools = await openTools(page);
    await tools.getByRole("switch", { name: "Show camera behind artwork" }).click();
    await tools.getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await video.boundingBox())?.width ?? 0).toBeLessThan(150);

    // Exports offer the camera only as an explicit opt-in, off by default.
    const reopened = await openTools(page);
    await reopened.getByRole("switch", { name: "Show camera behind artwork" }).click();
    await reopened.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("switch", { name: /include camera/i })).toHaveAttribute("aria-checked", "false");
  });
});

test("undo, eraser and symmetry on a drawing instrument @mobile", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=inkflow");
  await expect(page.locator("main canvas")).toBeVisible();

  // Undo removes the last stroke.
  await drawStroke(page, [0.2, 0.5], [0.8, 0.5]);
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeGreaterThan(30);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeLessThan(10);

  // The eraser clears marks it passes over.
  await drawStroke(page, [0.2, 0.5], [0.8, 0.5]);
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeGreaterThan(30);
  let tools = await openTools(page);
  await pick(tools, "Erase");
  await tools.getByRole("button", { name: "Close" }).click();
  await drawStroke(page, [0.45, 0.5], [0.55, 0.5]);
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeLessThan(10);
  expect(await canvasBrightness(page, 0.25, 0.5)).toBeGreaterThan(30);

  // Mirror symmetry repeats a stroke on the other side.
  tools = await openTools(page);
  await pick(tools, "Draw");
  await pick(tools, "Mirror");
  await tools.getByRole("button", { name: "Close" }).click();
  const mirroredBefore = await canvasBrightness(page, 0.8, 0.25);
  await drawStroke(page, [0.15, 0.25], [0.25, 0.25]);
  await expect.poll(() => canvasBrightness(page, 0.8, 0.25)).toBeGreaterThan(mirroredBefore + 25);
});

test("hide interface keeps only the artwork until restored", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=ripple-pond");
  const tools = await openTools(page);
  await tools.getByRole("button", { name: "Hide interface" }).click();
  await expect(page.getByRole("navigation", { name: "Studio tools" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Exit studio" })).toBeHidden();
  // Still playable while hidden.
  await drawStroke(page, [0.3, 0.4], [0.7, 0.6], 10);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Studio tools" })).toBeVisible();
  await (await openTools(page)).getByRole("button", { name: "Hide interface" }).click();
  await page.getByRole("button", { name: "Show controls" }).click();
  await expect(page.getByRole("button", { name: "Exit studio" })).toBeVisible();
});

test("new instruments react to touch", async ({ page }) => {
  await skipOnboarding(page);
  const pixels = () => page.evaluate(() => (document.querySelector("main canvas") as HTMLCanvasElement).toDataURL());
  for (const id of ["string-harp", "ripple-pond", "magnetic-field", "piano", "flute", "trumpet", "orchestra", "drum-kit", "freestyle-drums", "guitar", "veena", "sitar", "violin", "theremin", "handpan", "marimba", "tabla", "kalimba"]) {
    await page.goto(`/studio/?instrument=${id}`);
    await expect(page.locator("main canvas")).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const idle = await pixels();
    await page.getByRole("button", { name: "Resume", exact: true }).first().click();
    await drawStroke(page, [0.1, 0.5], [0.9, 0.55], 20);
    // Tap-only instruments (handpan, drums) respond to taps on their playing surface.
    const box = (await page.getByLabel(/canvas\. drag to play/i).boundingBox())!;
    for (const fx of [0.3, 0.5, 0.72]) await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.56);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect(await pixels(), id).not.toBe(idle);
  }
});

test("melodic instruments and drums play with sound on, without errors", async ({ page }) => {
  const errors: string[] = [];
  let current = "";
  page.on("pageerror", (error) => errors.push(`${current}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${current}: ${message.text()}`);
  });
  await skipOnboarding(page);
  for (const id of ["piano", "flute", "trumpet", "orchestra", "drum-kit", "freestyle-drums", "guitar", "veena", "sitar", "violin", "theremin", "handpan", "marimba", "tabla", "kalimba"]) {
    current = id;
    await page.goto(`/studio/?instrument=${id}`);
    const discard = page.getByRole("button", { name: "Discard" });
    if (await discard.isVisible({ timeout: 1000 }).catch(() => false)) await discard.click();
    await page.getByRole("button", { name: "Turn sound on" }).click();
    await expect(page.getByRole("button", { name: "Mute sound" })).toBeVisible();
    // Press-hold-slide (piano keys, wind lanes), taps (drums, beats) and a downward stroke (conducting).
    await drawStroke(page, [0.2, 0.7], [0.6, 0.7], 16);
    const box = (await page.getByLabel(/canvas\. drag to play/i).boundingBox())!;
    for (const [x, y] of [[0.38, 0.62], [0.58, 0.76], [0.22, 0.52], [0.5, 0.75]]) {
      await page.mouse.click(box.x + box.width * x!, box.y + box.height * y!);
      await page.waitForTimeout(120);
    }
    await drawStroke(page, [0.5, 0.3], [0.5, 0.7], 10);
  }
  expect(errors).toEqual([]);
});

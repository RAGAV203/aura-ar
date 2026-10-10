import { expect, test } from "@playwright/test";
import { cameraRequests, canvasBrightness, drawStroke, skipOnboarding, trackCameraRequests } from "./helpers";

test("first visit without granting camera permission @mobile", async ({ page }) => {
  await trackCameraRequests(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /move your hands/i })).toBeVisible();
  await page.getByRole("link", { name: "Enter the Garden" }).click();

  await expect(page).toHaveURL(/\/welcome\/$/);
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByRole("heading", { name: /try it with your finger/i })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /continue without camera/i }).click();
  await page.getByRole("button", { name: /stay silent/i }).click();
  await page.getByRole("button", { name: /aurora/i }).click();

  await expect(page).toHaveURL(/\/studio\/\?instrument=aurora/);
  await expect(page.getByRole("heading", { name: /aurora studio/i })).toBeAttached();
  await expect(page.locator("main canvas")).toBeVisible();
  expect(await cameraRequests(page)).toBe(0);

  // Returning visitors go straight to the studio.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Enter the Garden" })).toHaveAttribute("href", /\/studio\/\?instrument=aurora/);
});

test("touch-only creative session draws marks @mobile", async ({ page }) => {
  await skipOnboarding(page, { touchOnly: true });
  await page.goto("/studio/?instrument=inkflow");
  await expect(page.locator("main canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Camera" })).toBeDisabled();

  const before = await canvasBrightness(page, 0.5, 0.5);
  await drawStroke(page, [0.2, 0.5], [0.8, 0.5]);
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeGreaterThan(before + 20);
});

test("camera-denied recovery keeps the instrument playable", async ({ page }) => {
  await skipOnboarding(page);
  await trackCameraRequests(page, "deny");
  await page.goto("/studio/?instrument=aurora");
  // Camera is only requested after the person chooses it.
  expect(await cameraRequests(page)).toBe(0);
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(page.getByText(/never uploaded, recorded or stored/i)).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText("Camera access is blocked")).toBeVisible();
  expect(await cameraRequests(page)).toBe(1);
  await page.getByRole("button", { name: /continue with touch/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await drawStroke(page, [0.3, 0.3], [0.6, 0.6]);
  await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeEnabled();
});

test("camera already in use shows a specific message", async ({ page }) => {
  await skipOnboarding(page);
  await trackCameraRequests(page, "busy");
  await page.goto("/studio/?instrument=aurora");
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText("Camera is busy")).toBeVisible();
});

test("switching between every instrument", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=aurora");
  for (const name of ["InkFlow", "Light Trails", "Particle Bloom", "Cosmic Garden", "String Harp", "Ripple Pond", "Magnetic Field", "Piano", "Flute", "Trumpet", "Orchestra", "Drum Kit", "Freestyle Drums", "Guitar", "Veena", "Sitar", "Violin & Cello", "Theremin", "Handpan", "Marimba", "Tabla", "Kalimba", "Pitch Grid", "Aurora"]) {
    await page.getByRole("button", { name: "Instruments", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click();
    // Playing in the previous instrument left unsaved work; discard it.
    const confirm = page.getByRole("dialog", { name: /switch instrument/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`${name} studio`, "i") })).toBeAttached();
    await expect(page.locator("main canvas")).toBeVisible();
    await drawStroke(page, [0.3, 0.4], [0.7, 0.6], 10);
  }
});

test("switching with unsaved work asks first", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=inkflow");
  await drawStroke(page, [0.2, 0.5], [0.8, 0.5]);
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /particle bloom/i }).click();
  await expect(page.getByRole("dialog", { name: /switch instrument/i })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: /particle bloom studio/i })).toBeAttached();
});

test("saving and reopening a creation", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=inkflow");
  await drawStroke(page, [0.2, 0.3], [0.8, 0.7]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("Evening Ink");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved “Evening Ink”")).toBeVisible();
  await expect(page).toHaveURL(/creation=/);

  await page.goto("/creations/");
  await expect(page.getByRole("heading", { name: "Evening Ink" })).toBeVisible();
  await expect(page.locator("img").first()).toBeVisible();
  await page.getByRole("link", { name: "Open Evening Ink" }).click();
  await expect(page.getByRole("heading", { name: /inkflow studio — evening ink/i })).toBeAttached();
  // The saved snapshot is painted back onto the persistent canvas.
  await expect.poll(() => canvasBrightness(page, 0.5, 0.5)).toBeGreaterThan(40);
});

test("exporting and importing a project file", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=light-trails");
  await drawStroke(page, [0.2, 0.2], [0.8, 0.8]);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export project file/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.aura\.json$/);
  const path = await download.path();

  await page.goto("/creations/");
  await expect(page.getByRole("heading", { name: /nothing saved yet/i })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByText(/imported “light trails study”/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Light Trails Study" })).toBeVisible();

  // A corrupted file is rejected without touching the library.
  await page.locator('input[type="file"]').setInputFiles({ name: "broken.aura.json", mimeType: "application/json", buffer: Buffer.from('{"format":"aura-project","formatVersion":1,"creation":{"id":"x"}}') });
  await expect(page.getByText("That file can't be opened")).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveCount(1);
});

test("PNG export downloads an image", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=particle-bloom");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /export image/i }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.png$/);
});

test("recovery from a failed model load", async ({ page }) => {
  await skipOnboarding(page);
  await page.route("**/storage.googleapis.com/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/studio/?instrument=aurora");
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText(/hand tracking couldn't download/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  await page.getByRole("button", { name: /continue with touch/i }).click();
  await drawStroke(page, [0.3, 0.5], [0.7, 0.5]);
});

test("pause stops animation and sound immediately", async ({ page }) => {
  await skipOnboarding(page);
  await page.goto("/studio/?instrument=aurora");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText(/paused — animation and sound stopped/i)).toBeVisible();
  const pixels = () => page.evaluate(() => (document.querySelector("main canvas") as HTMLCanvasElement).toDataURL());
  const a = await pixels();
  await page.waitForTimeout(500);
  expect(await pixels()).toBe(a);
  await page.getByRole("button", { name: "Resume" }).first().click();
  await expect(page.getByText(/paused — animation and sound stopped/i)).toHaveCount(0);
});

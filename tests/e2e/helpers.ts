import type { Page } from "@playwright/test";

/** Marks onboarding complete so tests can open the studio directly. */
export async function skipOnboarding(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((settings) => {
    if (!window.localStorage.getItem("aura.settings.v1")) {
      window.localStorage.setItem("aura.settings.v1", JSON.stringify({ onboardingComplete: true, ...settings }));
    }
  }, extra);
}

/** Records every getUserMedia call so tests can assert when the camera was requested. */
export async function trackCameraRequests(page: Page, behaviour: "allow" | "deny" | "busy" = "allow"): Promise<void> {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __cameraRequests: number };
    w.__cameraRequests = 0;
    const devices = navigator.mediaDevices;
    if (!devices) return;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      w.__cameraRequests++;
      if (mode === "deny") throw new DOMException("Permission denied", "NotAllowedError");
      if (mode === "busy") throw new DOMException("Could not start video source", "NotReadableError");
      return original(constraints);
    };
  }, behaviour);
}

export const cameraRequests = (page: Page) => page.evaluate(() => (window as unknown as { __cameraRequests: number }).__cameraRequests);

/** Average brightness of a small square of the studio canvas. */
export async function canvasBrightness(page: Page, fx: number, fy: number): Promise<number> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector("main canvas") as HTMLCanvasElement | null;
      if (!canvas) return -1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return -1;
      const px = Math.floor(canvas.width * x);
      const py = Math.floor(canvas.height * y);
      const data = ctx.getImageData(px - 4, py - 4, 8, 8).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      return sum / (data.length / 4);
    },
    [fx, fy] as const,
  );
}

/** Drags across the artwork surface like a finger or mouse. */
export async function drawStroke(page: Page, from: [number, number], to: [number, number], steps = 25): Promise<void> {
  const stage = page.getByLabel(/canvas\. drag to play/i);
  const box = await stage.boundingBox();
  if (!box) throw new Error("stage not visible");
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(box.x + box.width * (from[0] + (to[0] - from[0]) * t), box.y + box.height * (from[1] + (to[1] - from[1]) * t));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

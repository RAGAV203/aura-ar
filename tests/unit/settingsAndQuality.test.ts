import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, settingsStore } from "@/features/settings/settingsStore";
import { QualityController } from "@/lib/performance/qualityController";

describe("settings", () => {
  it("falls back to defaults for malformed values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const parsed = parseSettings({ volume: 9, handedness: "both-ish", performanceMode: "turbo", muted: "true", touchOnly: true });
    expect(parsed.volume).toBe(1);
    expect(parsed.handedness).toBe("both");
    expect(parsed.performanceMode).toBe("auto");
    expect(parsed.muted).toBe(false);
    expect(parsed.touchOnly).toBe(true);
  });

  it("debounces persistence to localStorage", () => {
    vi.useFakeTimers();
    settingsStore._reload();
    settingsStore.update({ volume: 0.3 });
    settingsStore.update({ muted: true });
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    vi.advanceTimersByTime(350);
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}");
    expect(stored).toMatchObject({ volume: 0.3, muted: true });
    settingsStore._reload();
    expect(settingsStore.get().volume).toBe(0.3);
    settingsStore.reset();
    vi.useRealTimers();
  });
});

describe("settings flush on unload", () => {
  it("writes a pending change immediately when the page is hidden or unloaded", () => {
    vi.useFakeTimers();
    settingsStore._reload();
    settingsStore.update({ onboardingComplete: true });
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}")).toMatchObject({ onboardingComplete: true });
    settingsStore.reset();
    vi.useRealTimers();
  });
});

describe("QualityController", () => {
  const feed = (controller: QualityController, fps: number, seconds: number, start = 0) => {
    const step = 1000 / fps;
    let t = start;
    for (; t < start + seconds * 1000; t += step) controller.tick(t);
    return t;
  };

  it("steps down after sustained frame drops in auto mode", () => {
    const controller = new QualityController("auto", "high");
    const changes: string[] = [];
    controller.onChange((q) => changes.push(q));
    let t = feed(controller, 60, 3);
    expect(controller.getQuality()).toBe("high");
    t = feed(controller, 20, 4, t);
    expect(controller.getQuality()).toBe("balanced");
    feed(controller, 20, 4, t);
    expect(controller.getQuality()).toBe("battery");
    expect(changes).toEqual(["balanced", "battery"]);
  });

  it("never exceeds the device ceiling and respects manual modes", () => {
    const controller = new QualityController("auto", "balanced");
    feed(controller, 60, 20);
    expect(controller.getQuality()).toBe("balanced");
    controller.setMode("battery");
    feed(controller, 60, 20, 30_000);
    expect(controller.getQuality()).toBe("battery");
    expect(controller.getFps()).toBeGreaterThan(55);
  });
});

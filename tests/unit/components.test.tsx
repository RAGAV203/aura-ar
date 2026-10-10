import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
import { CreationsLibrary } from "@/features/creations/CreationsLibrary";
import { clearAllCreations, listCreations, saveCreation } from "@/features/creations/repository";
import { getInstrument } from "@/features/instruments/registry";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { settingsStore } from "@/features/settings/settingsStore";
import { CameraPanel } from "@/features/studio/components/CameraPanel";
import { ControlsSheet } from "@/features/studio/components/ControlsSheet";
import { InstrumentSwitcher } from "@/features/studio/components/InstrumentSwitcher";
import { SaveDialog } from "@/features/studio/components/SaveDialog";
import { TouchInput } from "@/features/studio/input/touchInput";
import { AppError } from "@/lib/errors/appErrors";
import { sampleCreation } from "./creationFixtures";

// Canvas rendering isn't available in jsdom; the engines are covered by unit tests.
vi.mock("@/features/studio/InstrumentStage", () => ({
  InstrumentStage: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));
vi.mock("@/features/instruments/InstrumentPreview", () => ({
  InstrumentPreview: () => <div data-testid="preview" />,
}));

const wrap = (ui: ReactNode) => render(<FeedbackProvider>{ui}</FeedbackProvider>);

beforeEach(() => {
  settingsStore.reset();
});

describe("Onboarding", () => {
  it("walks through every step without requesting the camera", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    wrap(<Onboarding />);

    expect(screen.getByRole("heading", { name: /movement becomes light and sound/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Begin" }));
    expect(screen.getByRole("heading", { name: /try it with your finger/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /interactive aurora preview/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: /play with your hands/i })).toBeInTheDocument();
    expect(screen.getByText(/never uploaded, recorded or stored/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue without camera/i }));
    expect(screen.getByRole("heading", { name: /turn on sound/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay silent/i }));
    expect(screen.getByRole("heading", { name: /choose your first instrument/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /aurora|inkflow|light trails|particle bloom|cosmic garden/i })).toHaveLength(5);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(settingsStore.get()).toMatchObject({ cameraEnabled: false, muted: true });

    await user.click(screen.getByRole("button", { name: /inkflow/i }));
    expect(settingsStore.get()).toMatchObject({ onboardingComplete: true, lastInstrument: "inkflow" });
  });

  it("can be skipped at any point", async () => {
    const user = userEvent.setup();
    wrap(<Onboarding />);
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(settingsStore.get().onboardingComplete).toBe(true);
  });
});

describe("Camera permission states", () => {
  const base = { tracking: "inactive" as const, getInferenceMs: () => 0, getInferenceMode: () => null, start: vi.fn(), stop: vi.fn() };

  it("explains camera use before asking", async () => {
    const onStart = vi.fn();
    wrap(<CameraPanel open onClose={vi.fn()} onStart={onStart} vision={{ ...base, phase: "idle", progress: 0, error: null }} handsPack={null} poseEnabled={false} instrumentSupportsPose={false} />);
    expect(screen.getByText(/never uploaded, recorded or stored/i)).toBeInTheDocument();
    expect(screen.getByText(/microphone is never requested/i)).toBeInTheDocument();
    expect(screen.getByText(/downloads about/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start camera/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("shows download progress", () => {
    wrap(<CameraPanel open onClose={vi.fn()} onStart={vi.fn()} vision={{ ...base, phase: "downloading", progress: 0.42, error: null }} handsPack={null} poseEnabled={false} instrumentSupportsPose={false} />);
    expect(screen.getByText(/downloading hand tracking… 42%/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("offers recovery when permission is denied", async () => {
    const onClose = vi.fn();
    const onStart = vi.fn();
    wrap(
      <CameraPanel
        open
        onClose={onClose}
        onStart={onStart}
        vision={{ ...base, phase: "error", progress: 0, error: new AppError("camera-denied") }}
        handsPack={null}
        poseEnabled={false}
        instrumentSupportsPose={false}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Camera access is blocked")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /continue with touch/i }));
    expect(onClose).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("explains a failed model download", () => {
    wrap(<CameraPanel open onClose={vi.fn()} onStart={vi.fn()} vision={{ ...base, phase: "error", progress: 0, error: new AppError("model-download-failed") }} handsPack={null} poseEnabled={false} instrumentSupportsPose={false} />);
    expect(screen.getByText(/hand tracking couldn't download/i)).toBeInTheDocument();
    expect(screen.getByText(/touch controls keep working/i)).toBeInTheDocument();
  });
});

describe("Studio controls", () => {
  it("switches instruments", async () => {
    const onSelect = vi.fn();
    wrap(<InstrumentSwitcher open current="aurora" onClose={vi.fn()} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /aurora/i })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: /light trails/i }));
    expect(onSelect).toHaveBeenCalledWith("light-trails");
  });

  it("applies presets and parameter changes", async () => {
    const onPreset = vi.fn();
    const onParameterChange = vi.fn();
    const definition = getInstrument("inkflow");
    wrap(
      <ControlsSheet
        open
        onClose={vi.fn()}
        definition={definition}
        parameters={definition.presets[0]!.parameters}
        presetId="sumi"
        onParameterChange={onParameterChange}
        onPreset={onPreset}
        volume={0.7}
        muted={false}
        onVolume={vi.fn()}
        onMuted={vi.fn()}
        intensity={1}
        onIntensity={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Sumi Bloom" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Tidepool" }));
    expect(onPreset).toHaveBeenCalledWith("tidepool");
    // jsdom has no native range-input keyboard behaviour, so dispatch the change directly.
    fireEvent.change(screen.getByRole("slider", { name: "Brush size" }), { target: { value: "15" } });
    expect(onParameterChange).toHaveBeenCalledWith("size", 15);
    expect(screen.getByRole("switch", { name: "Mute" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves with a name and offers export when storage fails", async () => {
    const onSave = vi.fn();
    const onExportInstead = vi.fn();
    const { rerender } = wrap(<SaveDialog open initialName="Aurora Study" isExisting={false} saving={false} error={null} onClose={vi.fn()} onSave={onSave} onExportInstead={onExportInstead} />);
    const input = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Night Sky");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Night Sky", false);

    rerender(
      <FeedbackProvider>
        <SaveDialog open initialName="Aurora Study" isExisting saving={false} error={new AppError("storage-quota-exceeded")} onClose={vi.fn()} onSave={onSave} onExportInstead={onExportInstead} />
      </FeedbackProvider>,
    );
    expect(screen.getByText("Storage is full")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /export file instead/i }));
    expect(onExportInstead).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /save as new/i }));
    expect(onSave).toHaveBeenLastCalledWith(expect.any(String), true);
  });
});

describe("Creations library", () => {
  beforeEach(async () => {
    await clearAllCreations();
  });

  it("shows an inviting empty state", async () => {
    wrap(<CreationsLibrary />);
    expect(await screen.findByRole("heading", { name: /nothing saved yet/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the studio/i })).toHaveAttribute("href", expect.stringMatching(/^\/studio\/?$/));
  });

  it("deletes only after explicit confirmation", async () => {
    const user = userEvent.setup();
    await saveCreation(sampleCreation({ name: "Keep Me" }));
    wrap(<CreationsLibrary />);
    expect(await screen.findByRole("heading", { name: "Keep Me" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Keep Me" }));
    const dialog = screen.getByRole("dialog", { name: /delete this creation/i });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect((await listCreations()).creations).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Delete Keep Me" }));
    await user.click(within(screen.getByRole("dialog", { name: /delete this creation/i })).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await listCreations()).creations).toHaveLength(0));
    expect(await screen.findByRole("heading", { name: /nothing saved yet/i })).toBeInTheDocument();
  });

  it("renames and duplicates", async () => {
    const user = userEvent.setup();
    await saveCreation(sampleCreation({ name: "Draft" }));
    wrap(<CreationsLibrary />);
    await user.click(await screen.findByRole("button", { name: "Rename Draft" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Final{Enter}");
    expect(await screen.findByRole("heading", { name: "Final" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicate Final" }));
    expect(await screen.findByRole("heading", { name: "Final copy" })).toBeInTheDocument();
  });

  it("rejects an invalid import with a clear message", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container } = wrap(<CreationsLibrary />);
    await screen.findByRole("heading", { name: /nothing saved yet/i });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["{\"format\":\"evil\"}"], "bad.aura.json", { type: "application/json" }));
    expect(await screen.findByText("That file can't be opened")).toBeInTheDocument();
    expect((await listCreations()).creations).toHaveLength(0);
  });
});

describe("Settings", () => {
  it("persists preference changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    wrap(<SettingsScreen />);
    await user.click(screen.getByRole("switch", { name: "Touch-only mode" }));
    expect(settingsStore.get().touchOnly).toBe(true);
    expect(screen.getByRole("switch", { name: "Start camera automatically" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Battery" }));
    expect(settingsStore.get().performanceMode).toBe("battery");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(JSON.parse(window.localStorage.getItem("aura.settings.v1") ?? "{}")).toMatchObject({ touchOnly: true, performanceMode: "battery" });
    vi.useRealTimers();
  });

  it("requires confirmation before clearing all data", async () => {
    const user = userEvent.setup();
    wrap(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /clear all local data/i }));
    expect(screen.getByRole("dialog", { name: /clear all local data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete everything/i })).toBeInTheDocument();
  });
});

describe("Touch input", () => {
  function pointer(type: string, init: { id?: number; x: number; y: number; t: number; pointerType?: string }) {
    const event = new MouseEvent(type, { clientX: init.x, clientY: init.y, bubbles: true, button: 0 });
    Object.defineProperties(event, {
      pointerId: { value: init.id ?? 1 },
      pointerType: { value: init.pointerType ?? "touch" },
      pressure: { value: 0.5 },
      timeStamp: { value: init.t },
    });
    return event;
  }

  it("produces control points, spread, taps and double-taps", () => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    element.setPointerCapture = () => {};
    const input = new TouchInput();
    const detach = input.attach(element);

    element.dispatchEvent(pointer("pointerdown", { x: 50, y: 50, t: 0 }));
    expect(input.points[0]).toMatchObject({ source: "touch", engaged: true, position: { x: 0.25, y: 0.5 } });
    expect(input.points[0]?.id).toMatch(/^touch-1-\d+$/);
    element.dispatchEvent(pointer("pointerdown", { id: 2, x: 150, y: 50, t: 5 }));
    expect(input.spread).toBeCloseTo(0.5);
    element.dispatchEvent(pointer("pointermove", { id: 2, x: 190, y: 50, t: 50 }));
    expect(input.points[1]!.speed).toBeGreaterThan(0);
    element.dispatchEvent(pointer("pointerup", { id: 2, x: 190, y: 50, t: 600 }));
    element.dispatchEvent(pointer("pointerup", { x: 50, y: 50, t: 100 }));
    expect(input.drainEvents()).toEqual([{ type: "tap", position: { x: 0.25, y: 0.5 }, source: "touch" }]);
    input.collectPoints(); // a frame passes

    element.dispatchEvent(pointer("pointerdown", { x: 52, y: 50, t: 200 }));
    element.dispatchEvent(pointer("pointerup", { x: 52, y: 50, t: 260 }));
    expect(input.drainEvents()[0]?.type).toBe("accent");
    // A tap released before any frame saw it is still delivered once, then dropped.
    expect(input.collectPoints()).toHaveLength(1);
    expect(input.collectPoints()).toHaveLength(0);
    detach();
  });
});

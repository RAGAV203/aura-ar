"use client";

import { useCallback, useEffect, useState } from "react";
import { toAppError, type AppError } from "@/lib/errors/appErrors";
import { getAudioEngine, type AudioEngineState } from "./audioEngine";

export function useAudio(volume: number, muted: boolean) {
  const [state, setState] = useState<AudioEngineState>("locked");
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => getAudioEngine().onState(setState), []);

  useEffect(() => {
    getAudioEngine().setVolume(volume);
  }, [volume]);

  useEffect(() => {
    getAudioEngine().setMuted(muted);
  }, [muted]);

  /** Call from a click/tap handler. */
  const activate = useCallback(async () => {
    try {
      setError(null);
      await getAudioEngine().activate();
      return true;
    } catch (e) {
      setError(toAppError(e, "audio-activation-failed"));
      return false;
    }
  }, []);

  return { state, error, activate };
}

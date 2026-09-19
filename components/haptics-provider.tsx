"use client";

import { useEffect, type ReactNode } from "react";
import { useWebHaptics } from "web-haptics/react";
import { HAPTIC_CUE_MAP, isHapticCue } from "@/lib/haptic-cues";

export function HapticsProvider({ children }: { children: ReactNode }) {
  const { trigger } = useWebHaptics({
    debug: true,
    showSwitch: false,
  });

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest?.("[data-haptic]");
      if (!el) return;
      const raw = el.getAttribute("data-haptic");
      if (!raw || !isHapticCue(raw)) return;
      void trigger(HAPTIC_CUE_MAP[raw]);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [trigger]);

  return children;
}

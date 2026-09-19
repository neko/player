import type { HapticInput } from "web-haptics";

/** semantic cues → inputs accepted by `web-haptics` `trigger()` (see `defaultPatterns` in the lib). */
export const HAPTIC_CUE_MAP = {
  select: "selection",
  expand: "medium",
} as const satisfies Record<string, HapticInput>;

export type HapticCue = keyof typeof HAPTIC_CUE_MAP;

export function isHapticCue(v: string): v is HapticCue {
  return v in HAPTIC_CUE_MAP;
}

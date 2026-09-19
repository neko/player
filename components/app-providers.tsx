"use client";

import type { ReactNode } from "react";
import { HapticsProvider } from "@/components/haptics-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <HapticsProvider>{children}</HapticsProvider>;
}

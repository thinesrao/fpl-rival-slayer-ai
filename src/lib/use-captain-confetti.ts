"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

interface Args {
  /** Captain's current points (with multiplier already applied). */
  captainPoints: number | undefined;
  /** Pass `true` only when there's at least one captain element to track. */
  enabled?: boolean;
}

/** Fires a small confetti burst when the captain's points jump upward.
 *  - Skips the first observed value (initial mount shouldn't celebrate).
 *  - Skips if the user prefers reduced motion.
 *  - Lightly debounces — at most one burst per 4 seconds.
 */
export function useCaptainConfetti({ captainPoints, enabled = true }: Args) {
  const lastSeen = useRef<number | null>(null);
  const lastBurstAt = useRef<number>(0);

  useEffect(() => {
    if (!enabled || captainPoints == null) return;
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      lastSeen.current = captainPoints;
      return;
    }
    if (lastSeen.current == null) {
      lastSeen.current = captainPoints;
      return;
    }
    if (captainPoints > lastSeen.current) {
      const now = Date.now();
      if (now - lastBurstAt.current > 4000) {
        lastBurstAt.current = now;
        confetti({
          particleCount: 60,
          spread: 70,
          startVelocity: 38,
          ticks: 180,
          origin: { x: 0.5, y: 0.35 },
          colors: ["#fbbf24", "#10b981", "#3b82f6", "#f87171"],
          scalar: 0.8,
          disableForReducedMotion: true,
        });
      }
    }
    lastSeen.current = captainPoints;
  }, [captainPoints, enabled]);
}

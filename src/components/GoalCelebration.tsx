"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Props {
  /** When this value increases, the celebration fires. */
  triggerValue: number | undefined;
  /** Subtitle inside the overlay (e.g., "Haaland · ×2"). */
  subtitle?: string;
  /** Optional headline override (default: "GOAL!"). */
  headline?: string;
}

/** Full-card swoosh that plays for ~1.9s whenever `triggerValue` jumps
 *  upward. Skips the first observed value (mount shouldn't celebrate)
 *  and respects prefers-reduced-motion. */
export function GoalCelebration({ triggerValue, subtitle, headline = "GOAL!" }: Props) {
  const [show, setShow] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);

  useEffect(() => {
    if (triggerValue == null) return;
    if (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLastSeen(triggerValue);
      return;
    }
    if (lastSeen == null) {
      setLastSeen(triggerValue);
      return;
    }
    if (triggerValue > lastSeen) {
      setShow(true);
      const t = setTimeout(() => setShow(false), 1900);
      setLastSeen(triggerValue);
      return () => clearTimeout(t);
    }
    setLastSeen(triggerValue);
  }, [triggerValue, lastSeen]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
          aria-live="polite"
        >
          <motion.div
            initial={{ x: "-100%", skewX: -22 }}
            animate={{ x: 0, skewX: -22 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            className="absolute inset-0 bg-emerald-500"
            style={{ opacity: 0.95 }}
          />
          <motion.div
            initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: -4, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 12 }}
            className="relative text-center"
          >
            <div className="text-7xl font-black tracking-tight text-white drop-shadow-lg sm:text-8xl">
              {headline}
            </div>
            {subtitle && (
              <div className="mt-1 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-950">
                {subtitle}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

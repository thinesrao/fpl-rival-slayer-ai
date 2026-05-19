"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface Props {
  /** The player's current live points (raw, before multiplier). */
  livePoints: number;
  /** Skip bubbles on initial mount. */
  enabled?: boolean;
}

interface Bubble {
  id: number;
  delta: number;
}

/** Tracks the wrapped player's live points; when they increase between
 *  renders, emits a small "+N" bubble that floats upward and fades.
 *  - Skips the first observed value (no welcome celebration).
 *  - Respects prefers-reduced-motion.
 *  - Caps at 3 visible bubbles to avoid spam under big bonus revisions. */
export function PointBubble({ livePoints, enabled = true }: Props) {
  const lastRef = useRef<number | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      lastRef.current = livePoints;
      return;
    }
    if (lastRef.current == null) {
      lastRef.current = livePoints;
      return;
    }
    if (livePoints > lastRef.current) {
      const delta = livePoints - lastRef.current;
      const id = ++idRef.current;
      setBubbles((b) => [...b.slice(-2), { id, delta }]);
      setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 1400);
    }
    lastRef.current = livePoints;
  }, [livePoints, enabled]);

  return (
    <AnimatePresence>
      {bubbles.map((b) => (
        <motion.div
          key={b.id}
          initial={{ y: 0, opacity: 1, scale: 0.7 }}
          animate={{ y: -42, opacity: 0, scale: 1.05 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: [0.2, 0.8, 0.3, 1] }}
          className="pointer-events-none absolute left-1/2 -top-1 z-20 -translate-x-1/2 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[10px] font-bold text-emerald-950 shadow"
        >
          +{b.delta}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

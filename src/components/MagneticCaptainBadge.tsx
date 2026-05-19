"use client";

import { motion, type PanInfo } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

interface SlotRef {
  /** Player ID at this slot. */
  id: number;
  /** Center of the slot in viewport coords (computed at drag start). */
  cx: number;
  cy: number;
}

interface Props {
  /** Map of player IDs → DOM nodes for the player avatars. We use these
   *  to compute snap targets at drag start. */
  getAnchors: () => Array<{ id: number; el: HTMLElement }>;
  /** Tag rendered in the badge ('C' or 'V'). */
  label: string;
  /** Color theme. */
  variant: "captain" | "vice";
  /** Called when the user drops the badge close to an anchor (≤ snapRadius). */
  onAssign: (id: number) => void;
  /** Snap radius in CSS pixels. Default 64. */
  snapRadius?: number;
}

/** Floating, draggable C / V badge. On drag start we snapshot the
 *  position of every potential target anchor; while dragging we tell
 *  the parent which target is currently inside the snap radius (so the
 *  parent can highlight it). On drop we either snap-assign or rubber-
 *  band back to the home position. */
export function MagneticCaptainBadge({ getAnchors, label, variant, onAssign, snapRadius = 64 }: Props) {
  const slotsRef = useRef<SlotRef[]>([]);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const styles = useMemo(() => {
    if (variant === "captain") {
      return {
        background: "linear-gradient(120deg,#fde68a 0%,#f59e0b 35%,#fbbf24 60%,#f59e0b 100%)",
        text: "text-amber-950",
        glow: "0 0 12px #f59e0b88",
      };
    }
    return {
      background: "linear-gradient(120deg,#e2e8f0,#cbd5e1)",
      text: "text-slate-900",
      glow: "0 0 8px #cbd5e166",
    };
  }, [variant]);

  // Publish the active hover-id via a custom event the parent can listen
  // to without prop drilling into every slot.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ev = new CustomEvent("magnetic-hover", { detail: { id: hoverId, label } });
    window.dispatchEvent(ev);
  }, [hoverId, label]);

  const onDragStart = () => {
    slotsRef.current = getAnchors().map(({ id, el }) => {
      const r = el.getBoundingClientRect();
      return { id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
  };

  const onDrag = (_: unknown, info: PanInfo) => {
    let best: { id: number; d: number } | null = null;
    for (const s of slotsRef.current) {
      const d = Math.hypot(s.cx - info.point.x, s.cy - info.point.y);
      if (!best || d < best.d) best = { id: s.id, d };
    }
    setHoverId(best && best.d <= snapRadius ? best.id : null);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    let best: { id: number; d: number } | null = null;
    for (const s of slotsRef.current) {
      const d = Math.hypot(s.cx - info.point.x, s.cy - info.point.y);
      if (!best || d < best.d) best = { id: s.id, d };
    }
    if (best && best.d <= snapRadius) {
      onAssign(best.id);
    }
    setHoverId(null);
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.2}
      dragSnapToOrigin
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.2, cursor: "grabbing" }}
      style={{ background: styles.background, boxShadow: styles.glow }}
      className={`relative z-10 flex h-7 w-7 cursor-grab touch-none select-none items-center justify-center rounded-full text-xs font-bold shadow ${styles.text}`}
      aria-label={`Drag ${label} badge onto a player to assign`}
    >
      {label}
    </motion.div>
  );
}
